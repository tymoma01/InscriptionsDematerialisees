// Migration ponctuelle (même patron que scripts/migrerWorkflowAccecitV3.js) — nettoyage promis
// dans l'en-tête de ce dernier : "Une fois ces 2 dossiers clos (statut valide ou rejete), une
// migration de suivi ... devra supprimer ces 2 dernières lignes obsolètes et leurs rôles
// associés, sur ce même modèle."
//
// Les 2 derniers dossiers de l'ancien circuit (id 73 "DOSSO Kader", id 76 "MAES Lucie") ont été
// supprimés (voir suppression définitive des 7 dossiers historiques du workflow v3, 2026-08-04) —
// plus aucun dossier ne dépend donc plus de en_attente_validation_recruteur ni des transitions
// valider_dossier/rejeter_dossier qui en partent.
//
// Comme scripts/migrerWorkflowAccecitV3.js : ce script supprime uniquement les lignes
// `transitions_statut` devenues obsolètes (et leurs `transition_roles`), jamais les lignes
// `statuts` elles-mêmes (en_attente_validation_recruteur/valide/rejete restent en base pour les FK
// historique_statuts des dossiers qui les ont portées avant leur suppression — voir
// journal_audit pour la trace de cette suppression). workflow.config.json a déjà été mis à jour
// séparément (retrait de ces 3 statuts et des 2 transitions) : scripts/seedStatuts.js étant
// purement additif, il ne les recréera pas pour cette entité au prochain passage.
//
// Idempotent au sens où le réexécuter ne fait plus rien une fois passé une première fois.
//
// Usage : node scripts/migrerWorkflowAccecitV4.js

const { obtenirKnex } = require('../src/db/knex');

const TRANSITIONS_OBSOLETES = [
  { codeAction: 'valider_dossier', statutOrigine: 'en_attente_validation_recruteur', statutDestination: 'valide' },
  { codeAction: 'rejeter_dossier', statutOrigine: 'en_attente_validation_recruteur', statutDestination: 'rejete' },
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

    console.log('--- Vérification préalable : aucun dossier ne doit être sur en_attente_validation_recruteur ---');
    const idEnAttenteValidation = await idStatut('en_attente_validation_recruteur');
    if (idEnAttenteValidation) {
      const nbDossiers = await bd('dossiers')
        .where({ entite_id: entite.id, statut_id: idEnAttenteValidation })
        .count('id as n')
        .first();
      if (Number(nbDossiers.n) > 0) {
        throw new Error(
          `${nbDossiers.n} dossier(s) encore sur « en_attente_validation_recruteur » — migration interrompue, traiter ces dossiers avant de retirer ces transitions.`,
        );
      }
    }

    console.log('--- Nettoyage des transitions obsolètes (dernier reliquat du workflow v3) ---');
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
  } finally {
    await bd.destroy();
  }
}

main().catch((erreur) => {
  console.error('Échec de la migration ✘');
  console.error(erreur.message);
  process.exit(1);
});
