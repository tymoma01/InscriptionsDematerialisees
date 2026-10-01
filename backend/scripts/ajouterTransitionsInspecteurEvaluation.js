// Ajout des transitions d'ÉVALUATION manquantes au rôle Inspecteur (audit 2026-10-01) — constat en
// production : un Inspecteur qui clique sur « NSPP » (ListeEvaluationsAFaire.jsx) reçoit « Rôle
// "inspecteur" non autorisé pour l'action "test_non_realise" ». Audit en lecture seule (DEV et PROD,
// identiques) : l'Inspecteur avait déjà confirmer_test_realise, valider_pret_embauche et
// invalider_test, mais PAS test_non_realise.
//
// Règle métier : l'Inspecteur évalue le Tertiaire et doit pouvoir faire TOUT le parcours
// d'évaluation, SAUF les transitions de formation (aucun dossier Tertiaire en formation — voir
// scripts/retirerInspecteurTransitionsFormation.js). D'où la liste fermée CODES_ACTION_EVALUATION
// ci-dessous : jamais valider_envoi_formation, marquer_formation_validee ni invalider_formation.
//
// Ne fait QU'AJOUTER des lignes transition_roles (transition_id, rôle inspecteur) absentes : rien
// n'est supprimé ni modifié. Idempotent : relancé, il ne trouve plus rien à ajouter.
// Entité passée explicitement (pas de boucle sur toutes les entités) : les droits d'une autre
// entité (ex. Adaptel, workflow différent) ne changent jamais par surprise.
//
// Mode simulation par défaut (aucune écriture) ; --appliquer pour écrire, en une seule transaction
// (tout ou rien) — même patron que scripts/retirerInspecteurTransitionsFormation.js.
//
// Usage :
//   node scripts/ajouterTransitionsInspecteurEvaluation.js accecit               (simulation)
//   node scripts/ajouterTransitionsInspecteurEvaluation.js accecit --appliquer   (écriture réelle)

const { obtenirKnex } = require('../src/db/knex');
const { ROLES } = require('../src/core/auth/rbac');

// Transitions déclenchables depuis l'écran d'évaluation (ListeEvaluationsAFaire.jsx /
// evaluationEngine.js) pour un dossier Tertiaire : NSPP, confirmation automatique du test à la
// soumission de l'évaluation, verdict positif bureau, invalidation.
const CODES_ACTION_EVALUATION = ['test_non_realise', 'confirmer_test_realise', 'valider_pret_embauche', 'invalider_test'];

// Fonction pure (testée sans base, voir ajouterTransitionsInspecteurEvaluation.test.js) : parmi les
// transitions d'évaluation de l'entité, celles où le rôle n'est pas encore autorisé.
function calculerAjouts(transitions, idsTransitionsDejaAutorisees) {
  const deja = new Set(idsTransitionsDejaAutorisees);
  return transitions.filter((t) => CODES_ACTION_EVALUATION.includes(t.code_action) && !deja.has(t.id));
}

async function main() {
  const codeEntite = process.argv.slice(2).find((argument) => !argument.startsWith('--'));
  const appliquer = process.argv.includes('--appliquer');
  if (!codeEntite) {
    console.error('Usage : node scripts/ajouterTransitionsInspecteurEvaluation.js <code_entite> [--appliquer]');
    process.exit(1);
  }

  const bd = await obtenirKnex();
  try {
    console.log(
      appliquer
        ? '=== MODE APPLICATION — écriture réelle ==='
        : '=== MODE SIMULATION — aucune écriture (relancer avec --appliquer pour appliquer) ===',
    );

    const entite = await bd('entites').where({ code: codeEntite }).first();
    if (!entite) throw new Error(`Entité « ${codeEntite} » introuvable.`);
    const role = await bd('roles').where({ code: ROLES.INSPECTEUR }).first();
    if (!role) throw new Error(`Rôle « ${ROLES.INSPECTEUR} » introuvable.`);

    const transitions = await bd('transitions_statut as t')
      .join('statuts as so', 'so.id', 't.statut_origine_id')
      .join('statuts as sd', 'sd.id', 't.statut_destination_id')
      .where('t.entite_id', entite.id)
      .whereIn('t.code_action', CODES_ACTION_EVALUATION)
      .select('t.id', 't.code_action', 'so.code as origine', 'sd.code as destination')
      .orderBy(['t.code_action', 't.id']);
    const dejaAutorisees = await bd('transition_roles')
      .whereIn('transition_id', transitions.map((t) => t.id))
      .andWhere({ role_id: role.id })
      .pluck('transition_id');

    for (const t of transitions) {
      const statut = dejaAutorisees.includes(t.id) ? 'déjà autorisée ✔' : appliquer ? 'AJOUTÉE' : 'SERAIT AJOUTÉE';
      console.log(`  ${t.code_action} (#${t.id}, ${t.origine} → ${t.destination}) : ${statut}`);
    }
    const absents = CODES_ACTION_EVALUATION.filter((code) => !transitions.some((t) => t.code_action === code));
    if (absents.length) console.log(`  (aucune transition configurée pour : ${absents.join(', ')} — ignoré)`);

    const ajouts = calculerAjouts(transitions, dejaAutorisees);
    if (ajouts.length === 0) {
      console.log(`\nRien à ajouter : le rôle « ${ROLES.INSPECTEUR} » a déjà toutes les transitions d'évaluation de « ${codeEntite} ».`);
      return;
    }
    if (!appliquer) {
      console.log(`\nSimulation terminée : ${ajouts.length} ligne(s) seraient ajoutée(s). Relancer avec --appliquer pour écrire réellement.`);
      return;
    }

    await bd.transaction(async (trx) => {
      await trx('transition_roles').insert(ajouts.map((t) => ({ transition_id: t.id, role_id: role.id })));
    });
    console.log(`\n${ajouts.length} ligne(s) transition_roles ajoutée(s) ✔`);
  } finally {
    await bd.destroy();
  }
}

if (require.main === module) {
  main().catch((erreur) => {
    console.error('Échec ✘');
    console.error(erreur.message);
    process.exit(1);
  });
}

module.exports = { CODES_ACTION_EVALUATION, calculerAjouts };
