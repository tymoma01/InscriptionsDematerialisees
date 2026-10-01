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

const PERIMETRE_PAR_ROLE = Object.freeze({
  [ROLES.INSPECTEUR_HOTELLERIE]: Object.freeze({
    typePoste: 'hotel',
    statutsCodes: Object.freeze(['test_planifie', 'valide_envoi_formation', 'valide_pret_embauche', 'embauche', 'invalide']),
  }),
});

// null = aucune restriction (tous les autres rôles, comportement inchangé).
function perimetreDossiersPourRole(roleCode) {
  return PERIMETRE_PAR_ROLE[roleCode] ?? null;
}

// Requête « ce dossier est-il dans le périmètre ? » (construite à part pour être vérifiable en test).
function requeteDossierDansPerimetre(bd, entiteId, dossierId, perimetre) {
  return bd('dossiers')
    .join('statuts', 'statuts.id', 'dossiers.statut_id')
    .join('dossier_donnees_formulaire as bloc_disponibilites', function jointure() {
      this.on('bloc_disponibilites.dossier_id', '=', 'dossiers.id').andOn('bloc_disponibilites.bloc_code', '=', bd.raw('?', ['disponibilites']));
    })
    .where({ 'dossiers.id': dossierId, 'dossiers.entite_id': entiteId })
    .whereIn('statuts.code', perimetre.statutsCodes)
    .whereRaw("bloc_disponibilites.donnees ->> 'typePoste' = ?", [perimetre.typePoste])
    .select('dossiers.id');
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
    return res.status(404).json({ erreur: 'Dossier introuvable.' });
  } catch (erreur) {
    return next(erreur);
  }
}

module.exports = {
  PERIMETRE_PAR_ROLE,
  perimetreDossiersPourRole,
  requeteDossierDansPerimetre,
  dossierDansPerimetre,
  verifierPerimetreDossier,
};
