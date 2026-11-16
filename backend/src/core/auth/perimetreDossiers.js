// Périmètre de dossiers restreint par rôle (2026-10-01, rôle Inspecteur Hôtellerie) — appliqué côté
// SERVEUR : liste des dossiers (dossierRepository.listerDossiers), statuts proposés, indicateurs du
// tableau de bord, et TOUTE route d'un dossier précis via verifierPerimetreDossier (monté dans app.js
// sur /api/dossiers/:dossierId, donc aussi sur les routes futures). Hors périmètre : 404, comme un
// dossier d'une autre entité — jamais la confirmation que le dossier existe.
//
// Codes de statut ACCECIT (Hôtellerie = typePoste 'hotel' du bloc disponibilites) : ce rôle et son
// périmètre sont propres à ACCECIT, comme le rôle Planning (voir rbac.js).
const db = require('../../db/knex');
const { ROLES } = require('./rbac');

// `statutsCodes` : statuts du périmètre ; absent = tous les statuts (Planning Tertiaire, limité au seul
// secteur). `refus` : message du refus 403 (sinon 404 comme pour un dossier d'une autre entité).
const PERIMETRE_PAR_ROLE = Object.freeze({
  [ROLES.PLANNING_TERTIAIRE]: Object.freeze({
    typePoste: 'bureau',
    refus: "Ce dossier concerne l'entité Hôtellerie : il est traité par le Planning Hôtellerie.",
    // Données hors dossier précis (listes, historiques, exports, indicateurs).
    refusDonnees: "Ces données concernent l'entité Hôtellerie : elles sont traitées par le Planning Hôtellerie.",
  }),
  [ROLES.INSPECTEUR_HOTELLERIE]: Object.freeze({
    typePoste: 'hotel',
    statutsCodes: Object.freeze(['test_planifie', 'valide_envoi_formation', 'valide_pret_embauche', 'embauche', 'invalide']),
  }),
});

const CODE_STATUT_BLACKLISTE = 'blackliste';

// Restreint une requête portant sur `statuts` et `dossiers` au périmètre : statut dans la liste, ou
// blacklisté depuis un statut de cette liste (un dossier blacklisté reste dans le périmètre de
// celui qui le suivait, il apparaît sous son filtre « Refus définitif »).
function restreindreAuxStatutsDuPerimetre(requete, bd, perimetre) {
  if (!perimetre.statutsCodes) return requete;
  return requete.where(function statutsDuPerimetre() {
    this.whereIn('statuts.code', perimetre.statutsCodes).orWhere(function blacklisteDuPerimetre() {
      this.where('statuts.code', CODE_STATUT_BLACKLISTE).whereIn(
        'dossiers.statut_avant_blacklist_id',
        bd('statuts as statuts_avant').select('statuts_avant.id').whereIn('statuts_avant.code', perimetre.statutsCodes),
      );
    });
  });
}

// null = aucune restriction (tous les autres rôles, comportement inchangé).
function perimetreDossiersPourRole(roleCode) {
  return PERIMETRE_PAR_ROLE[roleCode] ?? null;
}

// Périmètre d'une requête de LISTE (2026-10-01, onglet Admin « Vue Inspecteur Hôtellerie ») : le
// périmètre propre du rôle s'il en a un (jamais contournable) ; sinon, pour l'ADMIN UNIQUEMENT, celui
// du rôle demandé par le paramètre `vue` (ex. 'inspecteur_hotellerie') ; ignoré pour tout autre rôle.
function perimetreDossiersPourRequete(roleCode, vueDemandee) {
  const propre = perimetreDossiersPourRole(roleCode);
  if (propre) return propre;
  if (roleCode === ROLES.ADMIN && vueDemandee) return perimetreDossiersPourRole(vueDemandee);
  return null;
}

// Requête « ce dossier est-il dans le périmètre ? » (construite à part pour être vérifiable en test).
function requeteDossierDansPerimetre(bd, entiteId, dossierId, perimetre) {
  return bd('dossiers')
    .join('statuts', 'statuts.id', 'dossiers.statut_id')
    .join('dossier_donnees_formulaire as bloc_disponibilites', function jointure() {
      this.on('bloc_disponibilites.dossier_id', '=', 'dossiers.id').andOn('bloc_disponibilites.bloc_code', '=', bd.raw('?', ['disponibilites']));
    })
    .where({ 'dossiers.id': dossierId, 'dossiers.entite_id': entiteId })
    .whereRaw("bloc_disponibilites.donnees ->> 'typePoste' = ?", [perimetre.typePoste])
    .modify((requete) => restreindreAuxStatutsDuPerimetre(requete, bd, perimetre))
    .select('dossiers.id');
}

// Identifiants parmi `dossierIds` qui sont HORS du périmètre (ou n'existent pas dans l'entité).
async function dossiersHorsPerimetre(bd, entiteId, dossierIds, perimetre) {
  const ids = [...new Set(dossierIds)];
  if (!perimetre || ids.length === 0) return [];
  const dedans = await bd('dossiers')
    .join('statuts', 'statuts.id', 'dossiers.statut_id')
    .join('dossier_donnees_formulaire as bloc_disponibilites', function jointure() {
      this.on('bloc_disponibilites.dossier_id', '=', 'dossiers.id').andOn('bloc_disponibilites.bloc_code', '=', bd.raw('?', ['disponibilites']));
    })
    .where('dossiers.entite_id', entiteId)
    .whereIn('dossiers.id', ids)
    .whereRaw("bloc_disponibilites.donnees ->> 'typePoste' = ?", [perimetre.typePoste])
    .modify((requete) => restreindreAuxStatutsDuPerimetre(requete, bd, perimetre))
    .select('dossiers.id');
  const idsDedans = new Set(dedans.map((ligne) => ligne.id));
  return ids.filter((id) => !idsDedans.has(id));
}

// Liste d'identifiants transmise par le client (historique, export groupé) : refus de TOUTE la requête dès
// qu'un dossier est hors périmètre. Renvoie le message du refus (403) ou null.
async function messageRefusListeDossiers(bd, entiteId, dossierIds, perimetre) {
  if (!perimetre) return null;
  const horsPerimetre = await module.exports.dossiersHorsPerimetre(bd, entiteId, dossierIds, perimetre);
  if (horsPerimetre.length === 0) return null;
  return perimetre.refusDonnees ?? perimetre.refus ?? 'Dossier introuvable.';
}

async function dossierDansPerimetre(bd, entiteId, dossierId, perimetre) {
  const ligne = await requeteDossierDansPerimetre(bd, entiteId, dossierId, perimetre).first();
  return Boolean(ligne);
}

// Middleware Express — monté sur '/api/dossiers/:dossierId' (app.js). Sans périmètre pour le rôle :
// passe immédiatement (aucune requête). Segment non numérique ('statuts', 'rendezvous'…) : ce n'est
// pas un identifiant de dossier, la route nommée correspondante garde sa propre garde de rôle.
// Monté AVANT les routeurs (donc avant leur requireAuth) : le rôle est lu dans la session, sous la
// même condition d'entité que requireAuth ; sans session valide, la route répond elle-même 401/403.
function utilisateurDeLaRequete(req) {
  if (req.utilisateur) return req.utilisateur;
  const utilisateur = req.session?.utilisateur;
  return utilisateur && req.entite && utilisateur.entiteId === req.entite.id ? utilisateur : null;
}

async function verifierPerimetreDossier(req, res, next) {
  try {
    const perimetre = perimetreDossiersPourRole(utilisateurDeLaRequete(req)?.roleCode);
    if (!perimetre || !/^\d+$/.test(req.params.dossierId ?? '')) return next();
    const bd = await db.obtenirKnex();
    // Via module.exports (pas la référence locale) : remplaçable en test, même patron que les services.
    if (await module.exports.dossierDansPerimetre(bd, req.entite.id, Number(req.params.dossierId), perimetre)) return next();
    return perimetre.refus ? res.status(403).json({ erreur: perimetre.refus }) : res.status(404).json({ erreur: 'Dossier introuvable.' });
  } catch (erreur) {
    return next(erreur);
  }
}

module.exports = {
  PERIMETRE_PAR_ROLE,
  perimetreDossiersPourRole,
  perimetreDossiersPourRequete,
  requeteDossierDansPerimetre,
  restreindreAuxStatutsDuPerimetre,
  dossierDansPerimetre,
  dossiersHorsPerimetre,
  messageRefusListeDossiers,
  verifierPerimetreDossier,
};
