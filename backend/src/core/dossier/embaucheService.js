// Marque un dossier "Validé - prêt à l'embauche" comme effectivement embauché (audit 2026-08-31,
// nouveau statut terminal "Embauché") — compose en UNE SEULE transaction (1) la transition de
// statut normale (workflowEngine.appliquerTransition, `transitions_statut`/`transition_roles`
// respectés, contrairement à forcerStatut) et (2) l'écriture de la date d'embauche saisie sur
// `dossiers.date_embauche` (migration 057) — même patron de composition que
// clotureRendezvousAvecTransitionService.js (rendez-vous + transition), pour que les deux
// écritures réussissent ou échouent ensemble, jamais l'une sans l'autre.
//
// codeAction dédié ('marquer_embauche', jamais réutilisé ailleurs) — corrige l'erreur identifiée
// par l'audit du tableau de bord (2026-08-31) sur "Formation validée", qui réutilisait à tort le
// codeAction 'valider_pret_embauche' déjà porté par le verdict de test initial, faussant ensuite
// l'indicateur "Délai moyen test → verdict" (deux lignes historique_statuts pour le même
// test_realise). Un codeAction neuf, à statut d'origine unique (valide_pret_embauche), ne peut pas
// reproduire ce problème.

const db = require('../../db/knex');
const workflowEngine = require('../workflow/workflowEngine');
const dossierRepository = require('./dossierRepository');

const CODE_ACTION_MARQUER_EMBAUCHE = 'marquer_embauche';
const REGEX_DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;

async function marquerEmbauche(entite, { dossierId, commentaire, dateEmbauche, utilisateurId, roleCode }) {
  if (!dateEmbauche || !REGEX_DATE_ISO.test(dateEmbauche)) {
    throw new Error('Une date d’embauche valide (AAAA-MM-JJ) est obligatoire.');
  }

  const bd = await db.obtenirKnex();
  return bd.transaction(async (trx) => {
    const resultatTransition = await workflowEngine.appliquerTransition(
      entite,
      { dossierId, codeAction: CODE_ACTION_MARQUER_EMBAUCHE, commentaire, utilisateurId, roleCode },
      trx,
    );

    await dossierRepository.mettreAJourDateEmbauche(trx, { dossierId, dateEmbauche });

    return resultatTransition;
  });
}

module.exports = { marquerEmbauche, CODE_ACTION_MARQUER_EMBAUCHE };
