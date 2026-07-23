// Amorce les rôles autorisés par transition (table `transition_roles`, migration 006) pour une
// entité — qui peut déclencher quelle action de la machine à états (CLAUDE.md, section Rôles :
// séparation des responsabilités entre accueil/coordination et recruteur). Sans ligne pour une
// transition donnée, celle-ci devient injouable par quiconque via l'API — voir
// core/workflow/workflowEngine.js (politique "fail closed" : refuser plutôt qu'autoriser une
// transition non configurée). Codes ci-dessous propres à ACCECIT, pas une liste figée valable
// pour toute entité (voir Modularité, CLAUDE.md). Idempotent. Prérequis : scripts/seedRoles.js et
// scripts/seedStatuts.js (qui crée les lignes transitions_statut référencées ici par code_action).
//
// Usage : node scripts/seedTransitionRoles.js <code_entite>

const { obtenirKnex } = require('../src/db/knex');
const { ROLES } = require('../src/core/auth/rbac');

const ROLES_PAR_ACTION_ACCECIT = {
  // Transition interne, jamais déclenchée via l'API par un agent (voir
  // core/dossier/dossierService.js, inscrireCandidat : écrit directement en base sans passer par
  // workflowEngine) — rôle SYSTEME listé par cohérence documentaire, concrètement injouable via
  // POST /transitions par un humain puisqu'aucun utilisateur SYSTEME ne peut se connecter (voir
  // scripts/seedUtilisateurSysteme.js, actif: false).
  inscription_soumise: [ROLES.SYSTEME],
  // Accueil/coordination confirme que les pièces sont complètes (CLAUDE.md, section Accueil :
  // "vérification des pièces").
  pieces_completes: [ROLES.ACCUEIL_COORDINATION, ROLES.ADMIN],
  // Décision finale du recruteur (CLAUDE.md, section Rôles : "décision finale (validé/refusé)").
  valider_dossier: [ROLES.RECRUTEUR, ROLES.ADMIN],
  rejeter_dossier: [ROLES.RECRUTEUR, ROLES.ADMIN],
  // Bouton "Terminer et planifier un test" (CLAUDE.md, section Accueil/Coordination :
  // "planifie les tests"). Déclenchée lors de la création du rendez-vous de test — la route de
  // création n'existe pas encore (voir core/rendezvous/rendezvousRepository.js), à raccorder
  // quand elle sera écrite.
  planifier_test: [ROLES.ACCUEIL_COORDINATION, ROLES.ADMIN],
  // Transition interne, même statut que inscription_soumise ci-dessus : pas déclenchée par un
  // agent via POST /transitions, mais par un mécanisme automatique (job planifié à écrire,
  // même patron que rappelService.js) quand la date du rendez-vous de test est atteinte.
  // ROLES.SYSTEME listé par cohérence documentaire uniquement.
  test_realise: [ROLES.SYSTEME],
  // Écrites par evaluationEngine.enregistrerEvaluation (à raccorder — voir CLAUDE.md, section
  // Rôles : "Formateur ... valide/invalide le test"), pas par POST /transitions directement pour
  // l'instant. FORMATEUR listé par cohérence avec evaluations.routes.js (ROLES_EVALUATION), au
  // cas où l'action serait un jour exposée telle quelle via l'API générique.
  soumettre_verdict_positif: [ROLES.FORMATEUR, ROLES.ADMIN],
  soumettre_verdict_negatif: [ROLES.FORMATEUR, ROLES.ADMIN],
};

async function seedTransitionRoles(codeEntite) {
  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: codeEntite }).first();
    if (!entite) {
      throw new Error(`Entité « ${codeEntite} » introuvable — exécuter d'abord scripts/seedEntite.js`);
    }

    for (const [codeAction, rolesAutorises] of Object.entries(ROLES_PAR_ACTION_ACCECIT)) {
      const transition = await bd('transitions_statut').where({ entite_id: entite.id, code_action: codeAction }).first();
      if (!transition) {
        console.log(
          `Transition « ${codeAction} » introuvable pour « ${codeEntite} » — exécuter d'abord scripts/seedStatuts.js`,
        );
        continue;
      }

      for (const codeRole of rolesAutorises) {
        const role = await bd('roles').where({ code: codeRole }).first();
        if (!role) {
          console.log(`Rôle « ${codeRole} » introuvable — exécuter d'abord scripts/seedRoles.js`);
          continue;
        }

        const existant = await bd('transition_roles').where({ transition_id: transition.id, role_id: role.id }).first();
        if (existant) {
          console.log(`Rôle « ${codeRole} » déjà autorisé pour « ${codeAction} » (« ${codeEntite} ») ✔`);
          continue;
        }

        await bd('transition_roles').insert({ transition_id: transition.id, role_id: role.id });
        console.log(`Rôle « ${codeRole} » autorisé pour « ${codeAction} » (« ${codeEntite} ») ✔`);
      }
    }
  } finally {
    await bd.destroy();
  }
}

const codeEntite = process.argv[2];
if (!codeEntite) {
  console.error('Usage : node scripts/seedTransitionRoles.js <code_entite>');
  process.exit(1);
}

seedTransitionRoles(codeEntite).catch((erreur) => {
  console.error('Échec du seed ✘');
  console.error(erreur.message);
  process.exit(1);
});
