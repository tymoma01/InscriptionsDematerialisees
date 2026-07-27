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
  // Bouton "Planifier un test" (CLAUDE.md, section Accueil/Coordination : "planifie les tests") —
  // l'agent scanne les pièces, les juge visuellement conformes, et planifie directement le test
  // dans la foulée (workflow v2 : plus d'étape "en_attente_verification" séparée, la vérification
  // est inline). Même code_action réutilisé pour la replanification (voir replanifier_test
  // ci-dessous) : deux origines différentes, jamais ambiguës à l'exécution (workflowEngine filtre
  // toujours par le statut courant réel du dossier), seulement à distinguer ici pour le seed des
  // rôles — d'où la boucle sur toutes les lignes correspondantes plus bas, pas juste la première.
  planifier_test: [ROLES.ACCUEIL_COORDINATION, ROLES.ADMIN],
  // Le formateur marque le test comme réalisé — déclenchée par evaluationEngine.enregistrerEvaluation
  // (même transaction que l'évaluation elle-même), pas par un job automatique séparé : voir
  // workflow v2, plus simple que l'ancien plan (SYSTEME) qui supposait un job jamais écrit.
  test_realise: [ROLES.FORMATEUR, ROLES.ADMIN],
  // Le formateur marque le test comme non réalisé (candidat absent, etc.) — aucune évaluation
  // associée, transition seule via POST /transitions générique (voir ListeEvaluationsAFaire.jsx).
  test_non_realise: [ROLES.FORMATEUR, ROLES.ADMIN],
  // Replanification d'un nouveau créneau, depuis test_non_realise OU verdict_negatif (deux lignes
  // transitions_statut partagent ce même code_action, voir commentaire de planifier_test
  // ci-dessus) — UI de déclenchement différée à un prompt dédié (workflow v2), la transition
  // elle-même existe déjà en configuration.
  replanifier_test: [ROLES.ACCUEIL_COORDINATION, ROLES.ADMIN],
  // Écrites par evaluationEngine.enregistrerEvaluation, dans la même transaction que test_realise
  // ci-dessus (workflow v2) — pas par POST /transitions directement, mais FORMATEUR/ADMIN listés
  // par cohérence avec evaluations.routes.js (ROLES_EVALUATION), au cas où l'action serait un jour
  // exposée telle quelle via l'API générique.
  soumettre_verdict_positif: [ROLES.FORMATEUR, ROLES.ADMIN],
  soumettre_verdict_negatif: [ROLES.FORMATEUR, ROLES.ADMIN],
  // Transition automatique déclenchée par evaluationEngine.enregistrerEvaluation juste après un
  // verdict positif (workflow v2) — SYSTEME seul, jamais FORMATEUR : un formateur ne doit pas
  // pouvoir faire avancer un dossier jusqu'au recruteur via POST /transitions sans qu'une
  // évaluation réelle n'existe, seul evaluationEngine passe explicitement roleCode: ROLES.SYSTEME
  // pour cet appel précis (les deux transitions précédentes de la même chaîne gardent, elles, le
  // vrai rôle du formateur connecté).
  transmettre_recruteur: [ROLES.SYSTEME],
  // Décision finale du recruteur (CLAUDE.md, section Rôles : "décision finale (validé/refusé)") —
  // origine en_attente_validation_recruteur (workflow v2, après le verdict positif du test),
  // remplace l'ancienne origine en_attente_verification (avant tout test).
  valider_dossier: [ROLES.RECRUTEUR, ROLES.ADMIN],
  rejeter_dossier: [ROLES.RECRUTEUR, ROLES.ADMIN],
};

async function seedTransitionRoles(codeEntite) {
  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: codeEntite }).first();
    if (!entite) {
      throw new Error(`Entité « ${codeEntite} » introuvable — exécuter d'abord scripts/seedEntite.js`);
    }

    for (const [codeAction, rolesAutorises] of Object.entries(ROLES_PAR_ACTION_ACCECIT)) {
      // Toutes les lignes transitions_statut portant ce code_action, pas juste la première : un
      // même code_action peut être partagé par plusieurs origines (voir replanifier_test /
      // planifier_test ci-dessus) — un .first() ici laisserait l'une des deux lignes sans aucun
      // rôle autorisé (donc injouable par quiconque, fail closed silencieux).
      const transitions = await bd('transitions_statut').where({ entite_id: entite.id, code_action: codeAction });
      if (transitions.length === 0) {
        console.log(
          `Transition « ${codeAction} » introuvable pour « ${codeEntite} » — exécuter d'abord scripts/seedStatuts.js`,
        );
        continue;
      }

      for (const transition of transitions) {
        for (const codeRole of rolesAutorises) {
          const role = await bd('roles').where({ code: codeRole }).first();
          if (!role) {
            console.log(`Rôle « ${codeRole} » introuvable — exécuter d'abord scripts/seedRoles.js`);
            continue;
          }

          const existant = await bd('transition_roles').where({ transition_id: transition.id, role_id: role.id }).first();
          if (existant) {
            console.log(`Rôle « ${codeRole} » déjà autorisé pour « ${codeAction} » id=${transition.id} (« ${codeEntite} ») ✔`);
            continue;
          }

          await bd('transition_roles').insert({ transition_id: transition.id, role_id: role.id });
          console.log(`Rôle « ${codeRole} » autorisé pour « ${codeAction} » id=${transition.id} (« ${codeEntite} ») ✔`);
        }
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
