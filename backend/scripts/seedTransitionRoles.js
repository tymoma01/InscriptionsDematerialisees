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
  // Le formateur marque le test comme non réalisé (candidat absent, etc.) — aucune évaluation
  // associée, transition seule via POST /transitions générique (voir ListeEvaluationsAFaire.jsx).
  // SYSTEME ajouté (audit 2026-08-20) pour la bascule automatique du même codeAction, déclenchée
  // par une tâche planifiée sans agent connecté (voir core/rendezvous/
  // basculeTestNonRealiseService.js) — même patron que inscription_soumise ci-dessus.
  test_non_realise: [ROLES.FORMATEUR, ROLES.ADMIN, ROLES.SYSTEME],
  // Replanification d'un nouveau créneau, depuis test_non_realise, invalide, OU test_planifie lui-
  // même (workflow v4 : replanifier reste possible à tout moment tant que le dossier est encore
  // test_planifie, sans restriction de délai — trois lignes transitions_statut partagent ce même
  // code_action, "invalide" remplace "verdict_negatif" depuis le workflow v3) — la boucle plus bas
  // applique ces rôles à chaque ligne partageant ce code_action, jamais juste la première.
  replanifier_test: [ROLES.ACCUEIL_COORDINATION, ROLES.ADMIN],
  // Écrites par evaluationEngine.enregistrerEvaluation (workflow v4 : transition directe depuis
  // test_planifie vers l'issue finale du dossier, plus de verdict intermédiaire ni de passage par
  // le recruteur) — pas par POST /transitions directement, mais FORMATEUR/INSPECTEUR/ADMIN listés
  // par cohérence avec evaluations.routes.js (ROLES_EVALUATION), au cas où l'action serait un jour
  // exposée telle quelle via l'API générique. valider_envoi_formation n'a pas d'équivalent bureau
  // (INSPECTEUR non listé ici) — le bureau n'a pas de notion de formation, un verdict positif y
  // passe toujours par valider_pret_embauche (voir evaluationEngine.js, codeActionFinal).
  valider_envoi_formation: [ROLES.FORMATEUR, ROLES.ADMIN],
  valider_pret_embauche: [ROLES.FORMATEUR, ROLES.INSPECTEUR, ROLES.ADMIN],
  invalider_test: [ROLES.FORMATEUR, ROLES.INSPECTEUR, ROLES.ADMIN],
  // Décision finale du recruteur — workflow hérité (v2), retiré du parcours actif pour toute
  // nouvelle évaluation depuis le workflow v3 (voir evaluationEngine.js) : conservé uniquement le
  // temps que les derniers dossiers encore en_attente_validation_recruteur soient clos par un
  // recruteur (voir backend/scripts/migrerWorkflowAccecitV3.js), qui retirera aussi ces 2 lignes.
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
