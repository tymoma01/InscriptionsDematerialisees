// Amorce les statuts et transitions d'une entité à partir de son workflow.config.json (voir
// architecture-technique.md §1.3 : les *.config.json servent de source de seed, jamais lus
// directement par le moteur applicatif — même principe que scripts/seedEntite.js). Remplace
// l'ancien scripts/seedStatutInitial.js, qui n'amorçait que le statut « nouveau » en attendant
// la revue de la machine à états avec le développeur senior (docs/schema-bdd-proposition.md,
// point ouvert n°1) ; ce fichier est volontairement limité aux statuts nécessaires au tableau de
// bord Accueil (voir CLAUDE.md), pas encore à la machine à états complète d'ACCECIT. Idempotent.
//
// Statuts : upsert seul, jamais de suppression (un code retiré de la config reste en base tel
// quel — un dossier existant peut encore y référer). Transitions : upsert PUIS purge des lignes
// devenues obsolètes (audit 2026-08-21, workflow v5) — une transition retirée ou déplacée d'une
// origine à une autre (ex. « planifier_test » passé de en_attente_pieces à test_non_planifie)
// restait jusqu'ici active en base indéfiniment, avec ses transition_roles toujours accordés :
// un moyen silencieux de contourner la nouvelle machine à états en rejouant l'ancienne action
// depuis l'ancien statut. Voir la purge en fin de fonction pour le détail.
//
// Usage : node scripts/seedStatuts.js <code_entite>

const path = require('path');
const { obtenirKnex } = require('../src/db/knex');

async function seedStatuts(codeEntite) {
  const config = require(path.join(__dirname, '..', 'src', 'entites', codeEntite, 'workflow.config.json'));
  const statuts = config.statuts || [];
  const transitions = config.transitions || [];

  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: codeEntite }).first();
    if (!entite) {
      throw new Error(`Entité « ${codeEntite} » introuvable — exécuter d'abord scripts/seedEntite.js`);
    }

    const idsParCode = {};
    for (const statut of statuts) {
      const existant = await bd('statuts').where({ entite_id: entite.id, code: statut.code }).first();
      if (existant) {
        await bd('statuts').where({ id: existant.id }).update({
          libelle: statut.libelle,
          ordre: statut.ordre,
          est_initial: statut.estInitial,
          est_final: statut.estFinal,
          // Défaut false si absent de workflow.config.json (migration 051) — mêmes conventions
          // que estInitial/estFinal ci-dessus.
          neutralise_rendezvous_actifs: Boolean(statut.neutraliseRendezvousActifs),
        });
        idsParCode[statut.code] = existant.id;
        console.log(`Statut « ${statut.code} » déjà présent pour « ${codeEntite} » (id=${existant.id}) — mis à jour ✔`);
        continue;
      }

      const [inseree] = await bd('statuts')
        .insert({
          entite_id: entite.id,
          code: statut.code,
          libelle: statut.libelle,
          ordre: statut.ordre,
          est_initial: statut.estInitial,
          est_final: statut.estFinal,
          neutralise_rendezvous_actifs: Boolean(statut.neutraliseRendezvousActifs),
        })
        .returning('id');
      idsParCode[statut.code] = inseree.id;
      console.log(`Statut « ${statut.code} » créé pour « ${codeEntite} » (id=${inseree.id}) ✔`);
    }

    for (const transition of transitions) {
      const statutOrigineId = idsParCode[transition.statutOrigine];
      const statutDestinationId = idsParCode[transition.statutDestination];
      if (!statutDestinationId) {
        throw new Error(
          `Transition « ${transition.codeAction} » : statut destination « ${transition.statutDestination} » introuvable dans workflow.config.json.`,
        );
      }

      const existante = await bd('transitions_statut')
        .where({
          entite_id: entite.id,
          statut_origine_id: statutOrigineId || null,
          statut_destination_id: statutDestinationId,
          code_action: transition.codeAction,
        })
        .first();
      if (existante) {
        console.log(`Transition « ${transition.codeAction} » déjà présente pour « ${codeEntite} » (id=${existante.id}) ✔`);
        continue;
      }

      const [inseree] = await bd('transitions_statut')
        .insert({
          entite_id: entite.id,
          statut_origine_id: statutOrigineId || null,
          statut_destination_id: statutDestinationId,
          code_action: transition.codeAction,
          motif_requis: Boolean(transition.motifRequis),
        })
        .returning('id');
      console.log(`Transition « ${transition.codeAction} » créée pour « ${codeEntite} » (id=${inseree.id}) ✔`);
    }

    // Purge des transitions obsolètes (voir commentaire d'en-tête) — comparaison par la même
    // triplette (statut_origine_id, statut_destination_id, code_action) que l'upsert ci-dessus,
    // pas par id : c'est cette triplette, pas l'id, qui identifie une transition du point de vue
    // de workflow.config.json. transition_roles n'a pas de ON DELETE CASCADE vers
    // transitions_statut (FK stricte) — supprimé explicitement en premier, sinon la suppression
    // de transitions_statut échouerait.
    const clesValides = new Set(
      transitions.map((transition) => {
        const statutOrigineId = idsParCode[transition.statutOrigine] || null;
        const statutDestinationId = idsParCode[transition.statutDestination];
        return `${statutOrigineId}|${statutDestinationId}|${transition.codeAction}`;
      }),
    );
    const transitionsExistantes = await bd('transitions_statut').where({ entite_id: entite.id });
    const transitionsObsoletes = transitionsExistantes.filter(
      (ligne) => !clesValides.has(`${ligne.statut_origine_id}|${ligne.statut_destination_id}|${ligne.code_action}`),
    );
    if (transitionsObsoletes.length > 0) {
      const idsObsoletes = transitionsObsoletes.map((ligne) => ligne.id);
      await bd('transition_roles').whereIn('transition_id', idsObsoletes).del();
      await bd('transitions_statut').whereIn('id', idsObsoletes).del();
      for (const ligne of transitionsObsoletes) {
        console.log(
          `Transition « ${ligne.code_action} » (id=${ligne.id}) absente de workflow.config.json pour « ${codeEntite} » — supprimée avec ses transition_roles ✘`,
        );
      }
    }
  } finally {
    await bd.destroy();
  }
}

const codeEntite = process.argv[2];
if (!codeEntite) {
  console.error('Usage : node scripts/seedStatuts.js <code_entite>');
  process.exit(1);
}

seedStatuts(codeEntite).catch((erreur) => {
  console.error('Échec du seed ✘');
  console.error(erreur.message);
  process.exit(1);
});
