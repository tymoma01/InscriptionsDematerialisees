// Migration ponctuelle (même patron que scripts/migrerWorkflowAccecitV2.js — pas un seed
// rejouable indéfiniment comme scripts/seedStatuts.js) pour le passage à la machine à états v3
// d'ACCECIT : simplification du parcours actée avec la responsable de projet — le formateur
// statue directement sur l'issue finale du dossier à l'évaluation du test (envoi en formation /
// prêt à l'embauche / invalidé), sans verdict intermédiaire ni passage automatique par le
// recruteur.
//
// scripts/seedStatuts.js est purement additif pour les transitions (n'efface jamais une ligne
// `transitions_statut` absente du nouveau workflow.config.json) — ce script supprime donc
// explicitement les lignes devenues obsolètes, jamais les statuts eux-mêmes (les lignes `statuts`
// restent en base, ne serait-ce que pour les FK historique_statuts des dossiers déjà
// verdict_positif/verdict_negatif via l'ancien circuit).
//
// Vérifié en base avant d'écrire ce script (2026-07-29) : aucun dossier sur verdict_positif ni
// verdict_negatif — ces deux transitions et leur retour "replanifier_test" peuvent donc être
// retirées immédiatement, sans dossier à migrer.
//
// Ne touche volontairement PAS à valider_dossier/rejeter_dossier (origine
// en_attente_validation_recruteur) : 2 dossiers (id 73 "DOSSO Kader", id 76 "MAES Lucie") sont
// encore sur ce statut au moment de cette migration — décision actée avec la responsable de
// projet : laisser le recruteur les clore une dernière fois via l'ancien circuit
// (Validation.jsx) avant de couper ces transitions. Une fois ces 2 dossiers clos (statut valide
// ou rejete), une migration de suivi (scripts/migrerWorkflowAccecitV4.js ou équivalent) devra
// supprimer ces 2 dernières lignes obsolètes et leurs rôles associés, sur ce même modèle.
//
// Idempotent au sens où le réexécuter ne fait plus rien une fois passé une première fois.
//
// Usage : node scripts/migrerWorkflowAccecitV3.js

const { obtenirKnex } = require('../src/db/knex');

const TRANSITIONS_OBSOLETES = [
  { codeAction: 'soumettre_verdict_positif', statutOrigine: 'en_attente_verdict', statutDestination: 'verdict_positif' },
  { codeAction: 'soumettre_verdict_negatif', statutOrigine: 'en_attente_verdict', statutDestination: 'verdict_negatif' },
  { codeAction: 'transmettre_recruteur', statutOrigine: 'verdict_positif', statutDestination: 'en_attente_validation_recruteur' },
  { codeAction: 'replanifier_test', statutOrigine: 'verdict_negatif', statutDestination: 'test_planifie' },
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

    console.log('--- Vérification préalable : aucun dossier ne doit être sur verdict_positif/verdict_negatif ---');
    for (const code of ['verdict_positif', 'verdict_negatif']) {
      const statutId = await idStatut(code);
      if (!statutId) continue;
      const nbDossiers = await bd('dossiers').where({ entite_id: entite.id, statut_id: statutId }).count('id as n').first();
      if (Number(nbDossiers.n) > 0) {
        throw new Error(
          `${nbDossiers.n} dossier(s) encore sur « ${code} » — migration interrompue, traiter ces dossiers avant de retirer cette transition.`,
        );
      }
    }

    console.log('--- Nettoyage des transitions obsolètes (workflow v2 -> v3) ---');
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
      '--- valider_dossier/rejeter_dossier (en_attente_validation_recruteur) volontairement conservées : ' +
        'voir en-tête de ce fichier (dossiers 73/76 en cours via l\'ancien circuit) ---',
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
