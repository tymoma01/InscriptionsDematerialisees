const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const dossierRepository = require('../dossier/dossierRepository');
const rendezvousRepository = require('../rendezvous/rendezvousRepository');
const evaluationRepository = require('./evaluationRepository');
const workflowEngine = require('../workflow/workflowEngine');
const smartOfService = require('../../integrations/smartof/smartOfService');
const evaluationEngine = require('./evaluationEngine');

const ENTITE_ACCECIT = { id: 1, code: 'accecit' };

// postes_selectionnes non vide : évite un appel réel à evaluationRepository.trouverPostesDossier
// (non mocké ici, voir resoudrePosteCode) tout en satisfaisant la validation "au moins un poste
// résolu" ajoutée à enregistrerEvaluation — la valeur exacte du poste n'a pas d'importance pour ces
// tests, qui portent sur la logique de verdict/orientation, pas sur la résolution de poste.
const RENDEZVOUS_TEST = {
  id: 10,
  dossier_id: 62,
  type_rdv: 'test',
  formateur_id: 5,
  postes_selectionnes: ['nettoyage'],
};

const QUESTIONNAIRE = { id: 1 };
// Une seule question grille_qcu à un item, suffisante pour satisfaire
// resoudreEtValiderReponses (privée, jamais testée directement) sans complexité inutile.
const QUESTIONS = [
  {
    id: 100,
    code: 'savoir_etre',
    libelle: 'Savoir-être',
    type_question: 'grille_qcu',
    obligatoire: true,
    items: [{ id: 200, code: 'ponctualite', libelle: 'Ponctualité' }],
  },
];

const TRX_FACTICE = { estUnTrx: true };

// Même patron que planificationRendezvousService.test.js (mockerTransaction) : bd.transaction
// appelle directement le callback avec un trx factice, suffisant au niveau unitaire.
function mockerKnex(t) {
  t.mock.method(db, 'obtenirKnex', async () => ({ transaction: async (callback) => callback(TRX_FACTICE) }));
}

// statut_code 'test_realise' par défaut : reproduit le cas déjà confirmé séparément par l'agent
// avant d'évaluer (comportement historique de tous les tests ci-dessous, qui n'exercent pas la
// confirmation implicite) — voir le test dédié plus bas pour 'test_planifie'.
function mockerDependances(t, overrides = {}) {
  t.mock.method(rendezvousRepository, 'trouverRendezvousParId', async () => RENDEZVOUS_TEST);
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', overrides.trouverDossierAvecStatutParId ?? (async () => ({ statut_code: 'test_realise' })));
  t.mock.method(evaluationRepository, 'trouverEvaluationParRendezvous', async () => undefined);
  t.mock.method(evaluationRepository, 'trouverQuestionnairePourPoste', async () => QUESTIONNAIRE);
  t.mock.method(evaluationRepository, 'listerQuestionsAvecItems', async () => QUESTIONS);
  t.mock.method(evaluationRepository, 'enregistrerReponses', async () => {});
  t.mock.method(evaluationRepository, 'enregistrerPostesEvaluation', async () => {});
  t.mock.method(workflowEngine, 'appliquerTransition', async () => ({ statutDestinationId: 42 }));
  const enregistrerMock = t.mock.method(evaluationRepository, 'enregistrerEvaluation', overrides.enregistrerEvaluation ?? (async () => 1));
  const mettreAJourStatutRendezvousMock = t.mock.method(rendezvousRepository, 'mettreAJourStatutRendezvous', async () => ({}));
  return { enregistrerMock, mettreAJourStatutRendezvousMock };
}

const BLOC_REPONSES = { posteCode: 'nettoyage', reponses: [{ questionCode: 'savoir_etre', questionItemCode: 'ponctualite', valeur: 'excellent' }] };

test("enregistrerEvaluation accepte un verdict positif d'Inspecteur sans orientation, la persiste à NULL, et déclenche valider_pret_embauche", async (t) => {
  mockerKnex(t);
  const { enregistrerMock, mettreAJourStatutRendezvousMock } = mockerDependances(t);
  const appliquerTransitionMock = t.mock.method(workflowEngine, 'appliquerTransition', async () => ({ statutDestinationId: 42 }));

  const resultat = await evaluationEngine.enregistrerEvaluation(ENTITE_ACCECIT, {
    rendezvousId: 10,
    formateurId: 5,
    roleCode: 'inspecteur',
    resultatGlobal: 'valide',
    orientation: undefined,
    commentaire: 'Bon candidat.',
    blocs: [BLOC_REPONSES],
  });

  assert.deepEqual(resultat, { evaluationId: 1 });
  assert.equal(enregistrerMock.mock.calls[0].arguments[1].orientation, null);
  assert.equal(appliquerTransitionMock.mock.calls[0].arguments[1].codeAction, 'valider_pret_embauche');

  // Régression (audit 2026-08-20, dossiers #89/#91/#85/#74/#69) : un verdict positif doit aussi
  // marquer le rendez-vous "honore", pas seulement faire avancer le dossier.
  assert.equal(mettreAJourStatutRendezvousMock.mock.calls.length, 1);
  assert.equal(mettreAJourStatutRendezvousMock.mock.calls[0].arguments[1], 10);
  assert.deepEqual(mettreAJourStatutRendezvousMock.mock.calls[0].arguments[2], { statut: 'honore', motifId: null });
});

// Audit 2026-08-26 : "Évaluer" est désormais proposé dès test_planifie côté front
// (ListeEvaluationsAFaire.jsx), sans passer par "Confirmer que le test a eu lieu" au préalable —
// enregistrerEvaluation doit donc appliquer lui-même confirmer_test_realise en premier dans ce cas,
// avant la transition de verdict, plutôt que de laisser passer un dossier "évalué" en restant
// test_planifie (invariant workflow v4).
test('enregistrerEvaluation applique confirmer_test_realise AVANT le verdict si le dossier est encore test_planifie (évaluation directe, sans confirmation préalable)', async (t) => {
  mockerKnex(t);
  mockerDependances(t, { trouverDossierAvecStatutParId: async () => ({ statut_code: 'test_planifie' }) });
  const appliquerTransitionMock = t.mock.method(workflowEngine, 'appliquerTransition', async () => ({ statutDestinationId: 42 }));

  await evaluationEngine.enregistrerEvaluation(ENTITE_ACCECIT, {
    rendezvousId: 10,
    formateurId: 5,
    roleCode: 'inspecteur',
    resultatGlobal: 'valide',
    orientation: undefined,
    commentaire: 'Bon candidat.',
    blocs: [BLOC_REPONSES],
  });

  assert.equal(appliquerTransitionMock.mock.calls.length, 2);
  assert.equal(appliquerTransitionMock.mock.calls[0].arguments[1].codeAction, 'confirmer_test_realise');
  assert.equal(appliquerTransitionMock.mock.calls[1].arguments[1].codeAction, 'valider_pret_embauche');
});

test('enregistrerEvaluation n\'appelle PAS confirmer_test_realise si le dossier est déjà test_realise (confirmé séparément au préalable)', async (t) => {
  mockerKnex(t);
  mockerDependances(t, { trouverDossierAvecStatutParId: async () => ({ statut_code: 'test_realise' }) });
  const appliquerTransitionMock = t.mock.method(workflowEngine, 'appliquerTransition', async () => ({ statutDestinationId: 42 }));

  await evaluationEngine.enregistrerEvaluation(ENTITE_ACCECIT, {
    rendezvousId: 10,
    formateurId: 5,
    roleCode: 'inspecteur',
    resultatGlobal: 'valide',
    orientation: undefined,
    commentaire: 'Bon candidat.',
    blocs: [BLOC_REPONSES],
  });

  assert.equal(appliquerTransitionMock.mock.calls.length, 1);
  assert.equal(appliquerTransitionMock.mock.calls[0].arguments[1].codeAction, 'valider_pret_embauche');
});

test("enregistrerEvaluation ignore une orientation envoyée par erreur par un Inspecteur (toujours NULL persisté, jamais de confiance dans le payload)", async (t) => {
  mockerKnex(t);
  const { enregistrerMock } = mockerDependances(t);

  await evaluationEngine.enregistrerEvaluation(ENTITE_ACCECIT, {
    rendezvousId: 10,
    formateurId: 5,
    roleCode: 'inspecteur',
    resultatGlobal: 'valide',
    orientation: 'pret_embauche',
    commentaire: 'Bon candidat.',
    blocs: [BLOC_REPONSES],
  });

  assert.equal(enregistrerMock.mock.calls[0].arguments[1].orientation, null);
});

test('enregistrerEvaluation rejette toujours un verdict positif de Formateur sans orientation valide (comportement hôtel inchangé)', async (t) => {
  mockerKnex(t);
  mockerDependances(t);

  await assert.rejects(
    () =>
      evaluationEngine.enregistrerEvaluation(ENTITE_ACCECIT, {
        rendezvousId: 10,
        formateurId: 5,
        roleCode: 'formateur',
        resultatGlobal: 'valide',
        orientation: undefined,
        commentaire: 'Bon candidat.',
        blocs: [BLOC_REPONSES],
      }),
    /Orientation "undefined" invalide/,
  );
});

test('enregistrerEvaluation applique invalider_test pour un verdict négatif, quel que soit le rôle (formateur ou inspecteur)', async (t) => {
  mockerKnex(t);
  const { mettreAJourStatutRendezvousMock } = mockerDependances(t);
  const appliquerTransitionMock = t.mock.method(workflowEngine, 'appliquerTransition', async () => ({ statutDestinationId: 7 }));

  await evaluationEngine.enregistrerEvaluation(ENTITE_ACCECIT, {
    rendezvousId: 10,
    formateurId: 5,
    roleCode: 'inspecteur',
    resultatGlobal: 'invalide',
    orientation: undefined,
    commentaire: 'Insuffisant.',
    blocs: [BLOC_REPONSES],
  });

  assert.equal(appliquerTransitionMock.mock.calls[0].arguments[1].codeAction, 'invalider_test');
  // Un verdict négatif n'a pas d'issue positive : rendezvous.statut reste inchangé ('honore'
  // réservé aux verdicts valides, voir enregistrerEvaluation).
  assert.equal(mettreAJourStatutRendezvousMock.mock.calls.length, 0);
});

test('enregistrerEvaluation accepte les réponses grille_qcu sur l\'échelle bureau (aucune_connaissance/excellent)', async (t) => {
  mockerKnex(t);
  mockerDependances(t);

  await assert.doesNotReject(() =>
    evaluationEngine.enregistrerEvaluation(ENTITE_ACCECIT, {
      rendezvousId: 10,
      formateurId: 5,
      roleCode: 'inspecteur',
      resultatGlobal: 'invalide',
      commentaire: 'Insuffisant.',
      blocs: [
        { posteCode: 'nettoyage', reponses: [{ questionCode: 'savoir_etre', questionItemCode: 'ponctualite', valeur: 'aucune_connaissance' }] },
      ],
    }),
  );
});

// Envoi SmartOF (smartOfService.envoyerCandidatEnFormation) mocké ici : le vrai module appelle
// Key Vault + l'API SmartOF réelle, jamais souhaitable dans un test unitaire — même raison que
// workflowEngine/rendezvousRepository/evaluationRepository ci-dessus, tous mockés plutôt
// qu'exécutés réellement.
test('enregistrerEvaluation déclenche smartOfService.envoyerCandidatEnFormation pour un verdict positif de Formateur avec orientation "envoi_formation"', async (t) => {
  mockerKnex(t);
  mockerDependances(t);
  t.mock.method(workflowEngine, 'appliquerTransition', async () => ({ statutDestinationId: 18 }));
  const envoyerMock = t.mock.method(smartOfService, 'envoyerCandidatEnFormation', async () => {});

  await evaluationEngine.enregistrerEvaluation(ENTITE_ACCECIT, {
    rendezvousId: 10,
    formateurId: 5,
    roleCode: 'formateur',
    resultatGlobal: 'valide',
    orientation: 'envoi_formation',
    commentaire: 'Bon candidat.',
    blocs: [BLOC_REPONSES],
  });

  assert.equal(envoyerMock.mock.calls.length, 1);
  assert.deepEqual(envoyerMock.mock.calls[0].arguments, [ENTITE_ACCECIT, { dossierId: 62, roleCode: 'formateur' }]);
});

test('enregistrerEvaluation ne déclenche PAS smartOfService.envoyerCandidatEnFormation pour "pret_embauche" (Formateur) ni pour un verdict négatif', async (t) => {
  mockerKnex(t);
  mockerDependances(t);
  t.mock.method(workflowEngine, 'appliquerTransition', async () => ({ statutDestinationId: 42 }));
  const envoyerMock = t.mock.method(smartOfService, 'envoyerCandidatEnFormation', async () => {});

  await evaluationEngine.enregistrerEvaluation(ENTITE_ACCECIT, {
    rendezvousId: 10,
    formateurId: 5,
    roleCode: 'formateur',
    resultatGlobal: 'valide',
    orientation: 'pret_embauche',
    commentaire: 'Bon candidat.',
    blocs: [BLOC_REPONSES],
  });
  await evaluationEngine.enregistrerEvaluation(ENTITE_ACCECIT, {
    rendezvousId: 10,
    formateurId: 5,
    roleCode: 'inspecteur',
    resultatGlobal: 'invalide',
    commentaire: 'Insuffisant.',
    blocs: [BLOC_REPONSES],
  });

  assert.equal(envoyerMock.mock.calls.length, 0);
});

// Type de question 'oui_non' (audit 2026-08-26, ex. "DEBUTANT(E)") — une seule réponse par
// question (pas par item, comme texte_libre), vocabulaire fermé oui/non contrairement au texte
// libre.
test("enregistrerEvaluation accepte une réponse 'oui'/'non' valide pour une question de type oui_non", async (t) => {
  mockerKnex(t);
  const { enregistrerMock } = mockerDependances(t, {
    trouverDossierAvecStatutParId: async () => ({ statut_code: 'test_realise' }),
  });
  t.mock.method(evaluationRepository, 'listerQuestionsAvecItems', async () => [
    ...QUESTIONS,
    { id: 101, code: 'debutant', libelle: 'DEBUTANT(E)', type_question: 'oui_non', obligatoire: true, items: [] },
  ]);

  await evaluationEngine.enregistrerEvaluation(ENTITE_ACCECIT, {
    rendezvousId: 10,
    formateurId: 5,
    roleCode: 'formateur',
    resultatGlobal: 'valide',
    orientation: 'pret_embauche',
    commentaire: 'Bon candidat.',
    blocs: [
      {
        posteCode: 'nettoyage',
        reponses: [
          { questionCode: 'savoir_etre', questionItemCode: 'ponctualite', valeur: 'excellent' },
          { questionCode: 'debutant', valeur: 'oui' },
        ],
      },
    ],
  });

  assert.equal(enregistrerMock.mock.calls.length, 1);
});

test("enregistrerEvaluation rejette une réponse invalide pour une question de type oui_non (ni 'oui' ni 'non')", async (t) => {
  mockerKnex(t);
  mockerDependances(t);
  t.mock.method(evaluationRepository, 'listerQuestionsAvecItems', async () => [
    ...QUESTIONS,
    { id: 101, code: 'debutant', libelle: 'DEBUTANT(E)', type_question: 'oui_non', obligatoire: true, items: [] },
  ]);

  await assert.rejects(
    () =>
      evaluationEngine.enregistrerEvaluation(ENTITE_ACCECIT, {
        rendezvousId: 10,
        formateurId: 5,
        roleCode: 'formateur',
        resultatGlobal: 'valide',
        orientation: 'pret_embauche',
        commentaire: 'Bon candidat.',
        blocs: [
          {
            posteCode: 'nettoyage',
            reponses: [
              { questionCode: 'savoir_etre', questionItemCode: 'ponctualite', valeur: 'excellent' },
              { questionCode: 'debutant', valeur: 'peut-etre' },
            ],
          },
        ],
      }),
    /Réponse "peut-etre" invalide pour « DEBUTANT\(E\) »/,
  );
});

test("enregistrerEvaluation rejette une question oui_non non répondue, même si obligatoire vaut false", async (t) => {
  mockerKnex(t);
  mockerDependances(t);
  t.mock.method(evaluationRepository, 'listerQuestionsAvecItems', async () => [
    ...QUESTIONS,
    { id: 101, code: 'debutant', libelle: 'DEBUTANT(E)', type_question: 'oui_non', obligatoire: false, items: [] },
  ]);

  await assert.rejects(
    () =>
      evaluationEngine.enregistrerEvaluation(ENTITE_ACCECIT, {
        rendezvousId: 10,
        formateurId: 5,
        roleCode: 'formateur',
        resultatGlobal: 'valide',
        orientation: 'pret_embauche',
        commentaire: 'Bon candidat.',
        blocs: [{ posteCode: 'nettoyage', reponses: [{ questionCode: 'savoir_etre', questionItemCode: 'ponctualite', valeur: 'excellent' }] }],
      }),
    /Réponse "undefined" invalide pour « DEBUTANT\(E\) »/,
  );
});

// Voir audit "Poste non spécifié" (tableau de bord KPI) : une évaluation sans aucun poste résolu
// (repli générique de resoudrePosteCode pour un bloc sans posteCode, jamais rejeté avant ce test)
// pouvait s'enregistrer sans jamais écrire de ligne evaluations_postes — corrigé dans
// enregistrerEvaluation, juste après la résolution des blocs.
test('enregistrerEvaluation rejette une évaluation dont aucun bloc ne résout à un poste réel (posteCode absent, plus de repli générique silencieux)', async (t) => {
  mockerKnex(t);
  mockerDependances(t);

  await assert.rejects(
    () =>
      evaluationEngine.enregistrerEvaluation(ENTITE_ACCECIT, {
        rendezvousId: 10,
        formateurId: 5,
        roleCode: 'inspecteur',
        resultatGlobal: 'invalide',
        commentaire: 'Insuffisant.',
        blocs: [
          {
            posteCode: undefined,
            reponses: [{ questionCode: 'savoir_etre', questionItemCode: 'ponctualite', valeur: 'aucune_connaissance' }],
          },
        ],
      }),
    /Au moins un poste doit être sélectionné/,
  );
});

// confirmerTestRealise en tant que fonction indépendante a été retirée (audit 2026-08-28) — voir
// les tests "enregistrerEvaluation applique/n'applique pas confirmer_test_realise" ci-dessus, qui
// couvrent désormais la SEULE façon d'appliquer cette transition (dans le même geste que
// l'évaluation elle-même, jamais indépendamment).
