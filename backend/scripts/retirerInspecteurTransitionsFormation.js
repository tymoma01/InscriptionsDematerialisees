// Retrait de l'Inspecteur des transitions de formation (audit 2026-09-26) — règle métier
// confirmée avec l'utilisateur : aucun dossier Tertiaire (le seul secteur suivi par l'Inspecteur,
// voir evaluationEngine.js/rbac.js) ne passe en formation, l'accès qu'il conservait aux transitions
// marquer_formation_validee/invalider_formation (table transition_roles) n'a donc plus lieu d'être.
// Périmètre volontairement limité à CES DEUX transitions précises : l'Inspecteur garde
// lectureFormation (formation.routes.js, historique en lecture seule de la fiche dossier)
// et gestionTransitions (transitions.routes.js, garde générique nécessaire à ses propres
// transitions d'évaluation) — ce script ne touche à AUCUN des deux, seulement aux lignes
// transition_roles ci-dessous.
//
// Boucle sur TOUTES les entités actives plutôt qu'un code d'entité fixé en dur (même patron que
// scripts/seedMotifNeutraliseParForcage.js) : Adaptel n'a aujourd'hui aucune transition
// marquer_formation_validee/invalider_formation configurée (workflow différent, vérifié en Phase A
// de cet audit) — la boucle ne trouve alors simplement aucune ligne à retirer pour cette entité,
// sans échouer ni nécessiter de cas particulier.
//
// Idempotent : une ligne déjà retirée (par ce script ou manuellement) n'est plus trouvée au run
// suivant — "aucune ligne à retirer" plutôt qu'une erreur.
//
// Mode simulation par défaut (aucune écriture) ; option --appliquer pour supprimer réellement, en
// une seule transaction (tout ou rien) — même patron que
// scripts/reparerRendezvousEvaluesRemplaces.js.
//
// Usage :
//   node scripts/retirerInspecteurTransitionsFormation.js               (simulation)
//   node scripts/retirerInspecteurTransitionsFormation.js --appliquer   (écriture réelle)

const { obtenirKnex } = require('../src/db/knex');

const CODES_ACTION_CIBLES = ['marquer_formation_validee', 'invalider_formation'];
const ROLE_CODE_CIBLE = 'inspecteur';

// transition_roles n'a pas de colonne `id` propre — clé primaire composite (transition_id,
// role_id), voir migration 006. La suppression cible donc cette paire, jamais un id de substitution.
async function trouverLignesARetirer(bd) {
  return bd('transition_roles as tr')
    .join('transitions_statut as t', 'tr.transition_id', 't.id')
    .join('entites as e', 't.entite_id', 'e.id')
    .join('roles as r', 'tr.role_id', 'r.id')
    .where('r.code', ROLE_CODE_CIBLE)
    .whereIn('t.code_action', CODES_ACTION_CIBLES)
    .select(
      'tr.transition_id',
      'tr.role_id',
      'e.code as entite_code',
      't.code_action',
    )
    .orderBy(['e.code', 't.code_action']);
}

async function main() {
  const appliquer = process.argv.includes('--appliquer');
  const bd = await obtenirKnex();

  try {
    console.log(
      appliquer
        ? '=== MODE APPLICATION — écriture réelle ==='
        : '=== MODE SIMULATION — aucune écriture (relancer avec --appliquer pour appliquer) ===',
    );

    const lignes = await trouverLignesARetirer(bd);

    if (lignes.length === 0) {
      console.log(
        `Aucune ligne transition_roles à retirer pour le rôle « ${ROLE_CODE_CIBLE} » sur ${CODES_ACTION_CIBLES.map((c) => `« ${c} »`).join('/')} — déjà retiré ou jamais présent.`,
      );
      return;
    }

    for (const ligne of lignes) {
      console.log(
        `Entité « ${ligne.entite_code} » : ${appliquer ? 'retire' : 'SERAIT retirée'} transition_roles ` +
          `(transition #${ligne.transition_id}, code_action « ${ligne.code_action} », rôle « ${ROLE_CODE_CIBLE} »).`,
      );
    }

    if (!appliquer) {
      console.log(`\nSimulation terminée : ${lignes.length} ligne(s) seraient retirée(s). Relancer avec --appliquer pour écrire réellement.`);
      return;
    }

    const nbSupprimees = await bd.transaction(async (trx) => {
      let total = 0;
      for (const ligne of lignes) {
         
        total += await trx('transition_roles').where({ transition_id: ligne.transition_id, role_id: ligne.role_id }).del();
      }
      return total;
    });
    console.log(`\n${nbSupprimees} ligne(s) transition_roles supprimée(s) ✔`);
  } finally {
    await bd.destroy();
  }
}

main().catch((erreur) => {
  console.error('Échec du retrait ✘');
  console.error(erreur.message);
  process.exit(1);
});
