const db = require('../../db/knex');
const dossierRepository = require('../../core/dossier/dossierRepository');
const demandeDpaeRepository = require('../../core/dpae/demandeDpaeRepository');
const statutsDpae = require('../../core/dpae/statutsDpae');
const { libelleDivision } = require('../../core/dpae/formatsDpae');
const pieceJustificativeService = require('../../core/dossier/pieceJustificativeService');
const nirCipher = require('../../core/securite/nirCipher');
const pegaseClient = require('./pegaseClient');
const pegaseSalarieRepository = require('./pegaseSalarieRepository');
const pegaseMapper = require('./pegaseMapper');

// Salarié Pégase d'une demande DPAE, à sa validation par la RH :
// - nouvelle embauche d'une personne qui n'a jamais travaillé chez ACCECIT : création du salarié,
//   puis envoi de ses pièces justificatives ;
// - salarié « déjà employé » ou avenant : il existe déjà dans Pégase, seul son id est recherché et
//   mémorisé (rien n'est écrit dans Pégase).
//
// Module optionnel par entité (pegase_actif) qui n'échoue jamais vers son appelant : un incident
// Pégase ne doit pas bloquer la validation de la DPAE. Le résultat (créé, doublon, retrouvé, erreur)
// est enregistré dans pegase_salaries et affiché sur la fiche de la demande, d'où la RH peut relancer.
//
// Idempotent : un salarié déjà créé n'est jamais recréé ; une relance ne renvoie que les pièces
// qui n'ont pas encore été transmises.

const STATUT_CREE = 'cree';
const STATUT_DOUBLON = 'doublon';
const STATUT_RETROUVE = 'retrouve';
const STATUT_ERREUR = 'erreur';

// Une demande à la fois : une relance pendant l'envoi automatique ne doit pas créer deux salariés.
const demandesEnCours = new Set();

const estCreation = (demande) => demande.type_demande === 'nouvelle_embauche' && !demande.salarie_deja_employe;

const LIBELLE_TYPE_POSTE = { bureau: 'Bureau', hotel: 'Hôtel' };

// Base Pégase du salarié : celle du type de poste recherché à l'inscription (champ obligatoire,
// pegase_config.base_par_type_poste). Une Entité de DPAE qui le contredit arrête l'envoi plutôt que
// de trancher : un salarié créé dans la mauvaise base ne peut pas être supprimé. Une Entité vide ou
// « Autre » laisse décider le dossier. Un salarié déjà créé reste dans sa base.
function choisirBase(entite, demande, suivi, typePoste) {
  const config = entite.pegase_config ?? {};
  let code;
  if (suivi?.statut === STATUT_CREE && suivi.base) {
    code = suivi.base;
  } else {
    code = config.base_par_type_poste?.[typePoste];
    if (!code) {
      throw new pegaseClient.ErreurPegase('Type de poste recherché (Bureau / Hôtel) absent du dossier du candidat : base Pégase impossible à déterminer.');
    }
    if (config.bases?.[demande.division] && demande.division !== code) {
      throw new pegaseClient.ErreurPegase(
        `L'entité de la demande (${libelleDivision(demande.division)}) ne correspond pas au type de poste recherché par le candidat (${LIBELLE_TYPE_POSTE[typePoste] ?? typePoste}) : corriger l'un des deux, puis relancer.`,
      );
    }
  }
  const base = config.bases?.[code];
  if (!base?.secret) throw new pegaseClient.ErreurPegase(`Aucune base Pégase configurée sous le nom « ${code} ».`);
  if (!base.agence || !base.code_type_document) {
    throw new pegaseClient.ErreurPegase(`Base Pégase « ${code} » pas encore configurée (agence ou type de document manquant).`);
  }
  return { code, ...base };
}

// Base d'un salarié déjà employé : celle du type de poste de son dossier s'il en a un, sinon celle
// de l'Entité de la demande (la plupart des avenants n'ont pas de dossier candidat lié).
function choisirBaseSalarieExistant(entite, demande, typePoste) {
  const config = entite.pegase_config ?? {};
  if (config.base_par_type_poste?.[typePoste]) return choisirBase(entite, demande, null, typePoste);
  const base = config.bases?.[demande.division];
  if (!base?.secret) {
    throw new pegaseClient.ErreurPegase('Entité de la demande (Hôtellerie / Tertiaire) absente : base Pégase du salarié impossible à déterminer.');
  }
  return { code: demande.division, ...base };
}

async function dechiffrerNir(bd, entite, dossierId) {
  const { nirChiffre, nirIv } = (await dossierRepository.trouverNirChiffreParDossierId(bd, entite.id, dossierId)) ?? {};
  if (!nirChiffre || !nirIv) return '';
  return nirCipher.dechiffrer(nirChiffre, nirIv);
}

// Pièces du dossier pas encore transmises (la dernière de chaque type, comme l'export ZIP).
async function envoyerPieces(bd, entite, session, { base, personnelId, dossierId, dejaEnvoyees }) {
  const { fichiers, manquantes } = await pieceJustificativeService.listerPiecesJustificativesAvecContenu(entite, dossierId);
  const libelles = await pegaseSalarieRepository.libellesTypesPieces(bd, entite.id);
  const envoyees = [...dejaEnvoyees];
  const enErreur = manquantes.map(({ typePieceCode, erreur }) => ({ typePieceCode, erreur: `Fichier illisible dans le stockage : ${erreur}` }));

  for (const fichier of fichiers) {
    if (envoyees.includes(fichier.typePieceCode)) continue;
    try {
      await pegaseClient.ajouterDocument(session, {
        personnelId,
        nomFichier: fichier.nomFichier,
        contenu: fichier.contenu,
        libelle: libelles.get(fichier.typePieceCode) ?? fichier.typePieceCode,
        codeTypeDocument: base.code_type_document,
      });
      envoyees.push(fichier.typePieceCode);
    } catch (erreur) {
      enErreur.push({ typePieceCode: fichier.typePieceCode, erreur: erreur.message });
    }
  }
  return { piecesEnvoyees: envoyees, piecesEnErreur: enErreur };
}

async function traiter(bd, entite, demande) {
  const suivi = await pegaseSalarieRepository.trouverSuivi(bd, demande.id);
  if (suivi?.statut === STATUT_DOUBLON) return;

  if (!demande.candidat_id) {
    await pegaseSalarieRepository.enregistrerSuivi(bd, demande.id, {
      statut: STATUT_ERREUR,
      message: "Demande sans dossier candidat lié : le salarié n'a pas été créé dans Pégase, à saisir à la main.",
    });
    return;
  }
  const dossier = await pegaseSalarieRepository.trouverDernierDossierCandidat(bd, entite.id, demande.candidat_id);
  if (!dossier) throw new Error(`Aucun dossier pour le candidat n° ${demande.candidat_id}.`);

  const base = choisirBase(entite, demande, suivi, dossier.type_poste);
  const session = await pegaseClient.ouvrirSession(base);

  let personnelId = suivi?.statut === STATUT_CREE ? suivi.pegase_personnel_id : null;
  let avertissements = suivi?.avertissements ?? [];

  if (!personnelId) {
    const inscription = await dossierRepository.trouverInscriptionCompleteParDossierId(bd, entite.id, dossier.id);
    const nir = await dechiffrerNir(bd, entite, dossier.id);
    const salaries = await pegaseClient.listerSalaries(session);

    const doublon = pegaseMapper.trouverDoublon(salaries, { nir, ...inscription.candidat });
    if (doublon) {
      await pegaseSalarieRepository.enregistrerSuivi(bd, demande.id, {
        statut: STATUT_DOUBLON,
        base: base.code,
        pegasePersonnelId: String(doublon.salarie.id),
        message: `Salarié déjà présent dans Pégase (${doublon.motif}) : aucune fiche créée, pièces non envoyées.`,
      });
      return;
    }

    const construction = pegaseMapper.construireSalariePegase({
      candidat: inscription.candidat,
      coordonnees: inscription.blocs.coordonnees,
      nir,
      demande,
      agence: base.agence,
      referentiels: pegaseMapper.construireReferentiels(salaries),
    });
    avertissements = construction.avertissements;
    personnelId = await pegaseClient.creerSalarie(session, construction.salarie);
    // Enregistré avant l'envoi des pièces : si la suite échoue, une relance ne recrée pas le salarié.
    await pegaseSalarieRepository.enregistrerSuivi(bd, demande.id, { statut: STATUT_CREE, base: base.code, pegasePersonnelId: personnelId, avertissements });
  }

  const pieces = await envoyerPieces(bd, entite, session, { base, personnelId, dossierId: dossier.id, dejaEnvoyees: suivi?.pieces_envoyees ?? [] });
  await pegaseSalarieRepository.enregistrerSuivi(bd, demande.id, {
    statut: STATUT_CREE,
    base: base.code,
    pegasePersonnelId: personnelId,
    avertissements,
    message: pieces.piecesEnErreur.length > 0 ? 'Certaines pièces justificatives n’ont pas pu être envoyées : relancer l’envoi.' : null,
    ...pieces,
  });
}

// Salarié déjà employé : identité du dossier candidat lié (NIR, date de naissance), sinon nom et
// prénom saisis sur la demande.
async function retrouverSalarie(bd, entite, demande) {
  const suivi = await pegaseSalarieRepository.trouverSuivi(bd, demande.id);
  if (suivi?.statut === STATUT_RETROUVE) return;

  let identite = { nir: '', nom: demande.salarie_nom, prenom: demande.salarie_prenom };
  let typePoste = null;
  if (demande.candidat_id) {
    const dossier = await pegaseSalarieRepository.trouverDernierDossierCandidat(bd, entite.id, demande.candidat_id);
    if (dossier) {
      const inscription = await dossierRepository.trouverInscriptionCompleteParDossierId(bd, entite.id, dossier.id);
      identite = { nir: await dechiffrerNir(bd, entite, dossier.id), ...inscription.candidat };
      typePoste = dossier.type_poste;
    }
  }

  const base = choisirBaseSalarieExistant(entite, demande, typePoste);
  const session = await pegaseClient.ouvrirSession(base);
  const resultat = pegaseMapper.trouverSalarieExistant(await pegaseClient.listerSalaries(session), identite);
  const libelleBase = libelleDivision(base.code);

  if (resultat?.salarie) {
    await pegaseSalarieRepository.enregistrerSuivi(bd, demande.id, {
      statut: STATUT_RETROUVE,
      base: base.code,
      pegasePersonnelId: String(resultat.salarie.id),
      message: `Salarié retrouvé dans la base Pégase ${libelleBase} (${resultat.motif}).`,
    });
    return;
  }
  await pegaseSalarieRepository.enregistrerSuivi(bd, demande.id, {
    statut: STATUT_ERREUR,
    base: base.code,
    message: resultat?.homonymes
      ? `${resultat.homonymes} salariés portent ces nom et prénom dans la base Pégase ${libelleBase} : identifiant à relever dans Pégase.`
      : `Aucun salarié à ce nom dans la base Pégase ${libelleBase} : vérifier le nom, le prénom et l'Entité de la demande, puis relancer.`,
  });
}

// Appelée après la validation d'une demande DPAE (sans attendre : la RH n'a pas à patienter
// pendant l'envoi) et par la relance manuelle. Ne lève jamais d'exception.
async function creerSalarieDepuisDemande(entite, demandeId) {
  if (!entite.pegase_actif || demandesEnCours.has(demandeId)) return;
  demandesEnCours.add(demandeId);
  let bd;
  try {
    bd = await db.obtenirKnex();
    const demande = await demandeDpaeRepository.trouverDemandeParId(bd, entite.id, demandeId);
    if (!demande) return;
    await (estCreation(demande) ? traiter(bd, entite, demande) : retrouverSalarie(bd, entite, demande));
  } catch (erreur) {
    console.error(`Pégase : échec de la création du salarié pour la demande DPAE n° ${demandeId}.`, erreur);
    try {
      const suivi = await pegaseSalarieRepository.trouverSuivi(bd, demandeId);
      // Salarié déjà créé : on garde son id, seule la suite (pièces) est à relancer.
      await pegaseSalarieRepository.enregistrerSuivi(bd, demandeId, {
        statut: suivi?.statut === STATUT_CREE ? STATUT_CREE : STATUT_ERREUR,
        base: suivi?.base ?? null,
        pegasePersonnelId: suivi?.pegase_personnel_id ?? null,
        avertissements: suivi?.avertissements ?? [],
        piecesEnvoyees: suivi?.pieces_envoyees ?? [],
        piecesEnErreur: suivi?.pieces_en_erreur ?? [],
        message: erreur instanceof pegaseClient.ErreurPegase ? erreur.message : `Erreur inattendue : ${erreur.message}`,
      });
    } catch (erreurSuivi) {
      console.error(`Pégase : impossible d'enregistrer l'échec pour la demande DPAE n° ${demandeId}.`, erreurSuivi);
    }
  } finally {
    demandesEnCours.delete(demandeId);
  }
}

// Relance possible tant que la demande validée n'a pas abouti : aucun envoi enregistré (serveur
// redémarré pendant l'envoi), erreur, ou pièces non transmises.
function relancePossible(suivi) {
  if (!suivi) return true;
  return suivi.statut === STATUT_ERREUR || (suivi.statut === STATUT_CREE && suivi.pieces_en_erreur.length > 0);
}

// État de l'envoi affiché sur la fiche d'une demande validée ; null avant la validation.
// `recherche` : salarié déjà employé, dont seul l'id est recherché.
// Jamais de donnée personnelle : statut, id Pégase, messages et codes de types de pièces.
async function suiviPourDemande(entite, demande) {
  if (!entite.pegase_actif || demande.statut !== statutsDpae.STATUT_VALIDEE) return null;
  const bd = await db.obtenirKnex();
  const suivi = await pegaseSalarieRepository.trouverSuivi(bd, demande.id);
  const enCours = demandesEnCours.has(demande.id);
  return {
    recherche: !estCreation(demande),
    statut: suivi?.statut ?? null,
    base: suivi?.base ?? null,
    pegasePersonnelId: suivi?.pegase_personnel_id ?? null,
    message: suivi?.message ?? null,
    avertissements: suivi?.avertissements ?? [],
    piecesEnvoyees: suivi?.pieces_envoyees ?? [],
    piecesEnErreur: suivi?.pieces_en_erreur ?? [],
    dateTentative: suivi?.date_tentative ?? null,
    enCours,
    relancePossible: !enCours && relancePossible(suivi),
  };
}

module.exports = { creerSalarieDepuisDemande, suiviPourDemande };
