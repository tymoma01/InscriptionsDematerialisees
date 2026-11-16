// Blacklistage d'un dossier et levée du refus définitif.
//
// Le statut « Refus définitif » est une ligne de configuration (workflow.config.json, migration 094) mais
// n'a pas de transition déclarée : on peut blacklister depuis N'IMPORTE QUEL statut, et le retrait
// restitue le statut d'AVANT (mémorisé sur le dossier) — un retour dynamique qu'une transition
// statique ne peut pas exprimer. Chaque opération est atomique : changement de statut (historique),
// statut d'avant, note du dossier et journal d'audit réussissent ou échouent ensemble.
//
// Aucun rendez-vous n'est refermé ici : l'agent est prévenu (rendezvousActifs de obtenirDossier) et
// décide lui-même.
const db = require('../../db/knex');
const dossierRepository = require('./dossierRepository');
const notesDossierRepository = require('./notesDossierRepository');
const motifRepository = require('../motifs/motifRepository');
const journalAudit = require('../audit/journalAudit');
const { aPermission } = require('../auth/permissions');

const CODE_STATUT_BLACKLISTE = 'blackliste';
const CODE_STATUT_EMBAUCHE = 'embauche';
const CATEGORIE_MOTIF_BLACKLIST = 'blacklister';
const COMMENTAIRE_MIN = 10;
const COMMENTAIRE_MAX = 500;

// statutHttp : code que la route renvoie tel quel (400 donnée invalide, 403 rôle, 404 introuvable,
// 409 état du dossier incompatible).
class ErreurBlacklist extends Error {
  constructor(message, statutHttp = 400) {
    super(message);
    this.name = 'ErreurBlacklist';
    this.statutHttp = statutHttp;
  }
}

const MESSAGE_MOTIF_OBLIGATOIRE =
  `Le motif est obligatoire : choisissez une catégorie et saisissez un commentaire d'au moins ${COMMENTAIRE_MIN} caractères.`;
const MESSAGE_MOTIF_RETRAIT_OBLIGATOIRE =
  `Le motif est obligatoire : saisissez un commentaire d'au moins ${COMMENTAIRE_MIN} caractères.`;

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Paris' });

function verifierCommentaire(commentaire, message) {
  const valeur = typeof commentaire === 'string' ? commentaire.trim() : '';
  if (valeur.length < COMMENTAIRE_MIN || valeur.length > COMMENTAIRE_MAX) {
    throw new ErreurBlacklist(message);
  }
  return valeur;
}

// Texte unique, sans tiret long, de la note du dossier et du commentaire d'historique.
function formaterMotifRefus(libelleMotif, commentaire) {
  return `Refus définitif (${libelleMotif}) : ${commentaire}`;
}

function formaterMotifLevee(commentaire) {
  return `Refus définitif levé : ${commentaire}`;
}

async function messageDejaBlackliste(trx, dossierId) {
  const passage = await dossierRepository.trouverDernierPassageAuStatut(trx, dossierId, CODE_STATUT_BLACKLISTE);
  const date = passage?.date_changement ? FORMAT_DATE.format(new Date(passage.date_changement)) : null;
  const auteur = [passage?.auteur_prenom, passage?.auteur_nom].filter(Boolean).join(' ');
  return `Ce candidat fait déjà l’objet d’un refus définitif${date ? ` depuis le ${date}` : ''}${auteur ? ` par ${auteur}` : ''}.`;
}

async function chargerDossier(trx, entite, dossierId) {
  const dossier = await dossierRepository.trouverDossierAvecStatutParId(trx, entite.id, dossierId);
  if (!dossier) throw new ErreurBlacklist(`Dossier "${dossierId}" introuvable pour l'entité « ${entite.code} ».`, 404);
  return dossier;
}

async function blacklister(entite, { dossierId, motifCode, commentaire, utilisateurId, roleCode, adresseIp }) {
  if (!aPermission(roleCode, 'blacklister')) {
    throw new ErreurBlacklist('Ce rôle ne peut pas prononcer un refus définitif.', 403);
  }

  const bd = await db.obtenirKnex();
  return bd.transaction(async (trx) => {
    const dossier = await chargerDossier(trx, entite, dossierId);
    if (dossier.statut_code === CODE_STATUT_EMBAUCHE && !aPermission(roleCode, 'blacklisterEmbauche')) {
      throw new ErreurBlacklist('Ce candidat est embauché : seuls les rôles Planning, RH et Admin peuvent prononcer son refus définitif.', 403);
    }
    if (dossier.statut_code === CODE_STATUT_BLACKLISTE) {
      throw new ErreurBlacklist(await messageDejaBlackliste(trx, dossierId), 409);
    }
    const commentaireNettoye = verifierCommentaire(commentaire, MESSAGE_MOTIF_OBLIGATOIRE);
    const statutBlackliste = await dossierRepository.trouverStatutParCode(trx, entite.id, CODE_STATUT_BLACKLISTE);
    if (!statutBlackliste) {
      throw new ErreurBlacklist(`Statut « ${CODE_STATUT_BLACKLISTE} » non configuré pour l'entité « ${entite.code} ».`, 409);
    }
    const motif = motifCode
      ? await motifRepository.trouverMotifParCode(trx, entite.id, CATEGORIE_MOTIF_BLACKLIST, motifCode)
      : null;
    if (!motif) throw new ErreurBlacklist(MESSAGE_MOTIF_OBLIGATOIRE);

    await dossierRepository.enregistrerChangementStatut(trx, {
      dossierId,
      statutId: statutBlackliste.id,
      utilisateurId,
      motifId: motif.id,
      commentaire: formaterMotifRefus(motif.libelle, commentaireNettoye),
    });
    await dossierRepository.memoriserStatutAvantBlacklist(trx, { dossierId, statutId: dossier.statut_id });
    await notesDossierRepository.ajouterNote(trx, {
      dossierId,
      auteurId: utilisateurId,
      contenu: formaterMotifRefus(motif.libelle, commentaireNettoye),
    });
    await journalAudit.enregistrerAction(trx, {
      utilisateurId,
      entiteId: entite.id,
      action: 'dossier_blacklist',
      tableCible: 'historique_statuts',
      cibleId: dossierId,
      donnees: {
        dossierId,
        statutAvant: dossier.statut_code,
        categorie: motif.code,
        commentaire: commentaireNettoye,
        roleCode,
      },
      adresseIp,
    });

    return { statutAvantCode: dossier.statut_code, statutAvantLibelle: dossier.statut_libelle };
  });
}

async function retirerDeLaBlacklist(entite, { dossierId, commentaire, utilisateurId, roleCode, adresseIp }) {
  if (!aPermission(roleCode, 'retirerBlacklist')) {
    throw new ErreurBlacklist('Seul un administrateur peut lever le refus définitif d’un candidat.', 403);
  }
  const commentaireNettoye = verifierCommentaire(commentaire, MESSAGE_MOTIF_RETRAIT_OBLIGATOIRE);

  const bd = await db.obtenirKnex();
  return bd.transaction(async (trx) => {
    const dossier = await chargerDossier(trx, entite, dossierId);
    if (dossier.statut_code !== CODE_STATUT_BLACKLISTE) {
      throw new ErreurBlacklist('Ce dossier ne fait pas l’objet d’un refus définitif.', 409);
    }
    const statutAvant = dossier.statut_avant_blacklist_id
      ? await dossierRepository.trouverStatutParId(trx, entite.id, dossier.statut_avant_blacklist_id)
      : null;
    if (!statutAvant) {
      throw new ErreurBlacklist('Le statut d’avant le refus définitif est introuvable pour ce dossier.', 409);
    }

    await dossierRepository.enregistrerChangementStatut(trx, {
      dossierId,
      statutId: statutAvant.id,
      utilisateurId,
      commentaire: formaterMotifLevee(commentaireNettoye),
    });
    await dossierRepository.memoriserStatutAvantBlacklist(trx, { dossierId, statutId: null });
    await notesDossierRepository.ajouterNote(trx, {
      dossierId,
      auteurId: utilisateurId,
      contenu: formaterMotifLevee(commentaireNettoye),
    });
    await journalAudit.enregistrerAction(trx, {
      utilisateurId,
      entiteId: entite.id,
      action: 'dossier_blacklist_retrait',
      tableCible: 'historique_statuts',
      cibleId: dossierId,
      donnees: { dossierId, statutRetabli: statutAvant.code, commentaire: commentaireNettoye, roleCode },
      adresseIp,
    });

    return { statutRetabliCode: statutAvant.code, statutRetabliLibelle: statutAvant.libelle };
  });
}

module.exports = {
  ErreurBlacklist,
  formaterMotifRefus,
  formaterMotifLevee,
  CODE_STATUT_BLACKLISTE,
  CATEGORIE_MOTIF_BLACKLIST,
  COMMENTAIRE_MIN,
  COMMENTAIRE_MAX,
  blacklister,
  retirerDeLaBlacklist,
};
