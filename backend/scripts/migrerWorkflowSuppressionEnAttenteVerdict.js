// Migration ponctuelle (même patron que scripts/migrerWorkflowAccecitV3.js) pour le passage au
// workflow v4 d'ACCECIT : retrait de en_attente_verdict, décision actée avec la responsable de
// projet (Florence) le 2026-07-31. Constat de l'audit préalable : en_attente_verdict n'a jamais
// été observé comme état de repos (evaluationEngine.enregistrerEvaluation enchaînait déjà
// test_realise puis la transition finale dans la même transaction), il ne servait donc qu'à
// bloquer à tort toute replanification une fois le test réalisé — voir workflow.config.json pour
// le nouveau tracé (transition directe test_planifie -> issue finale, plus test_realise).
//
// Comme scripts/migrerWorkflowAccecitV3.js : ce script supprime uniquement les lignes
// transitions_statut devenues obsolètes (et leurs transition_roles), jamais la ligne `statuts`
// en_attente_verdict elle-même — elle reste en base pour les FK historique_statuts des dossiers
// déjà évalués via l'ancien circuit. scripts/seedStatuts.js reste purement additif (n'efface
// jamais une ligne absente du nouveau workflow.config.json), donc les nouvelles lignes
// (valider_envoi_formation/valider_pret_embauche/invalider_test depuis test_planifie,
// replanifier_test en auto-transition test_planifie -> test_planifie) doivent être créées par un
// nouveau passage de scripts/seedStatuts.js + scripts/seedTransitionRoles.js, exécuté par ce
// script juste après le nettoyage (les deux sont idempotents).
//
// Idempotent au sens où le réexécuter ne fait plus rien une fois passé une première fois.
//
// Usage : node scripts/migrerWorkflowSuppressionEnAttenteVerdict.js

const { obtenirKnex } = require('../src/db/knex');

const TRANSITIONS_OBSOLETES = [
  { codeAction: 'test_realise', statutOrigine: 'test_planifie', statutDestination: 'en_attente_verdict' },
  { codeAction: 'valider_envoi_formation', statutOrigine: 'en_attente_verdict', statutDestination: 'valide_envoi_formation' },
  { codeAction: 'valider_pret_embauche', statutOrigine: 'en_attente_verdict', statutDestination: 'valide_pret_embauche' },
  { codeAction: 'invalider_test', statutOrigine: 'en_attente_verdict', statutDestination: 'invalide' },
];

async function main() {
  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: 'accecit' }).first();
    if (!entite) {
      throw new Error('Entité « accecit » introuvable — exécuter scripts/seedEntite.js.');
    }

    const idStatut = async (code) => {
      const statut = await bd('statuts').where({ entite_id: entite.id, code }).first();
      return statut ? statut.id : null;
    };

    console.log('--- Vérification préalable : aucun dossier ne doit être sur en_attente_verdict ---');
    const idEnAttenteVerdict = await idStatut('en_attente_verdict');
    if (idEnAttenteVerdict) {
      const nbDossiers = await bd('dossiers')
        .where({ entite_id: entite.id, statut_id: idEnAttenteVerdict })
        .count('id as n')
        .first();
      if (Number(nbDossiers.n) > 0) {
        throw new Error(
          `${nbDossiers.n} dossier(s) encore sur « en_attente_verdict » — migration interrompue, traiter ces dossiers avant de retirer ce statut du parcours actif.`,
        );
      }
    }

    console.log('--- Nettoyage des transitions obsolètes (workflow v3 -> v4) ---');
    for (const { codeAction, statutOrigine, statutDestination } of TRANSITIONS_OBSOLETES) {
      const statutOrigineId = await idStatut(statutOrigine);
      const statutDestinationId = await idStatut(statutDestination);
      const transition = await bd('transitions_statut')
        .where({
          entite_id: entite.id,
          code_action: codeAction,
          statut_origine_id: statutOrigineId,
          statut_destination_id: statutDestinationId,
        })
        .first();

      if (!transition) {
        console.log(`Transition « ${codeAction} » (${statutOrigine} -> ${statutDestination}) déjà absente — rien à faire.`);
        continue;
      }

      const nbRoles = await bd('transition_roles').where({ transition_id: transition.id }).del();
      await bd('transitions_statut').where({ id: transition.id }).del();
      console.log(
        `Transition « ${codeAction} » (${statutOrigine} -> ${statutDestination}, id=${transition.id}) supprimée avec ${nbRoles} rôle(s) associé(s) ✔`,
      );
    }

    console.log(
      '--- Nettoyage terminé — lancer maintenant :\n' +
        '    node scripts/seedStatuts.js accecit\n' +
        '    node scripts/seedTransitionRoles.js accecit\n' +
        'pour créer les nouvelles lignes (valider_envoi_formation/valider_pret_embauche/invalider_test\n' +
        'depuis test_planifie, replanifier_test test_planifie -> test_planifie) et leurs rôles. ---',
    );
  } finally {
    await bd.destroy();
  }
}

main().catch((erreur) => {
  console.error('Échec de la migration ✘');
  console.error(erreur.message);
  process.exit(1);
});
