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
  // typePoste 'bureau' par défaut (audit 2026-09-10, garde secteur verifierAssignationRendezvous) :
  // la plupart des tests ci-dessous exercent un roleCode 'inspecteur' sans tester la garde secteur
  // elle-même (voir tests dédiés plus bas) — leur donner un dossier bureau évite de les faire
  // échouer sur ce nouveau contrôle, indépendant de ce qu'ils vérifient réellement.
  t.mock.method(evaluationRepository, 'trouverPostesDossier', overrides.trouverPostesDossier ?? (async () => ({ typePoste: 'bureau', posteBureau: [], posteHotel: [] })));
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

// Dossier Hôtellerie : le parcours d'évaluation dépend désormais du SECTEUR DU
// DOSSIER (evaluationEngine.resoudreParcoursEvaluation), plus du rôle de l'évaluateur. Le dossier
// par défaut de mockerDependances est Tertiaire (typePoste 'bureau') : les tests du parcours
// Formateur (orientation, SmartOF) l'utilisent explicitement pour rester dans leur vrai contexte
// métier, un Formateur n'évaluant que des dossiers Hôtellerie.
const POSTES_DOSSIER_HOTEL = async () => ({ typePoste: 'hotel', posteBureau: [], posteHotel: [] });

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
  mockerDependances(t, { trouverPostesDossier: POSTES_DOSSIER_HOTEL });

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
  // Correctif 2026-09-26 : un verdict négatif fait AUSSI passer le rendez-vous à 'honore' — le
  // test a bien eu lieu, seule son issue diffère. Avant ce correctif, appliquerTransition (mocké
  // ci-dessus) avait déjà neutralisé ce même rendez-vous en 'remplace' côté vraie implémentation,
  // sans correction ultérieure : c'est précisément ce que ce test vérifie n'être plus le cas.
  assert.equal(mettreAJourStatutRendezvousMock.mock.calls.length, 1);
  assert.equal(mettreAJourStatutRendezvousMock.mock.calls[0].arguments[1], 10);
  assert.deepEqual(mettreAJourStatutRendezvousMock.mock.calls[0].arguments[2], { statut: 'honore', motifId: null });
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
  mockerDependances(t, { trouverPostesDossier: POSTES_DOSSIER_HOTEL });
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

// confirmerTestRealise en tant que fonction indépendante a été retirée — voir
// les tests "enregistrerEvaluation applique/n'applique pas confirmer_test_realise" ci-dessus, qui
// couvrent désormais la SEULE façon d'appliquer cette transition (dans le même geste que
// l'évaluation elle-même, jamais indépendamment).

// marquerPresenceConfirmee (audit 2026-09-09, bouton "Présent(e)") — même garde IDOR/ownership que
// listerQuestionnaire (non testée séparément, patron identique), mais n'écrit QUE
// rendezvous.date_presence_confirmee (voir rendezvousRepository.marquerPresenceConfirmee, jamais
// mocké au-delà de son appel ici : la logique COALESCE elle-même relève du test SQL dédié,
// rendezvousRepository.test.js).
test('marquerPresenceConfirmee délègue au repository pour le formateur assigné à ce rendez-vous', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(rendezvousRepository, 'trouverRendezvousParId', async () => RENDEZVOUS_TEST);
  const marquerMock = t.mock.method(rendezvousRepository, 'marquerPresenceConfirmee', async () => ({ ...RENDEZVOUS_TEST, date_presence_confirmee: '2026-09-09T09:00:00.000Z' }));

  const resultat = await evaluationEngine.marquerPresenceConfirmee(ENTITE_ACCECIT, {
    rendezvousId: 10,
    formateurId: RENDEZVOUS_TEST.formateur_id,
    roleCode: 'formateur',
  });

  assert.equal(marquerMock.mock.calls.length, 1);
  assert.equal(marquerMock.mock.calls[0].arguments[1], 10);
  assert.equal(resultat.date_presence_confirmee, '2026-09-09T09:00:00.000Z');
});

test('marquerPresenceConfirmee rejette un formateur non assigné à ce rendez-vous (IDOR)', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(rendezvousRepository, 'trouverRendezvousParId', async () => RENDEZVOUS_TEST);
  const marquerMock = t.mock.method(rendezvousRepository, 'marquerPresenceConfirmee', async () => ({}));

  await assert.rejects(
    () =>
      evaluationEngine.marquerPresenceConfirmee(ENTITE_ACCECIT, {
        rendezvousId: 10,
        formateurId: 999,
        roleCode: 'formateur',
      }),
    /n'est pas assigné à ce formateur/,
  );
  assert.equal(marquerMock.mock.calls.length, 0);
});

test('marquerPresenceConfirmee autorise un Admin même non assigné à ce rendez-vous', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(rendezvousRepository, 'trouverRendezvousParId', async () => RENDEZVOUS_TEST);
  const marquerMock = t.mock.method(rendezvousRepository, 'marquerPresenceConfirmee', async () => ({}));

  await evaluationEngine.marquerPresenceConfirmee(ENTITE_ACCECIT, {
    rendezvousId: 10,
    formateurId: 999,
    roleCode: 'admin',
  });

  assert.equal(marquerMock.mock.calls.length, 1);
});

test('marquerPresenceConfirmee rejette un rendez-vous introuvable pour cette entité', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(rendezvousRepository, 'trouverRendezvousParId', async () => undefined);

  await assert.rejects(
    () =>
      evaluationEngine.marquerPresenceConfirmee(ENTITE_ACCECIT, {
        rendezvousId: 999,
        formateurId: 5,
        roleCode: 'formateur',
      }),
    /introuvable/,
  );
});

// Garde secteur pour l'Inspecteur (audit 2026-09-10, corrige l'IDOR laissé ouvert par l'exemption
// d'assignation formateur_id ci-dessus : un Inspecteur qui connaît l'ID d'un rendez-vous Hôtel
// pouvait jusqu'ici agir dessus, malgré le filtre déjà posé côté liste, voir
// verifierAssignationRendezvous). formateurId volontairement différent de RENDEZVOUS_TEST.formateur_id
// dans les deux tests ci-dessous : prouve que le rejet/l'acceptation viennent bien du secteur, pas
// d'une coïncidence avec la garde d'assignation (déjà exemptée pour ce rôle).
test('marquerPresenceConfirmee rejette un Inspecteur sur un rendez-vous secteur Hôtel, même non assigné à un formateur précis', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(rendezvousRepository, 'trouverRendezvousParId', async () => RENDEZVOUS_TEST);
  t.mock.method(evaluationRepository, 'trouverPostesDossier', async () => ({ typePoste: 'hotel', posteBureau: [], posteHotel: ['gouvernant'] }));
  const marquerMock = t.mock.method(rendezvousRepository, 'marquerPresenceConfirmee', async () => ({}));

  await assert.rejects(
    () =>
      evaluationEngine.marquerPresenceConfirmee(ENTITE_ACCECIT, {
        rendezvousId: 10,
        formateurId: 999,
        roleCode: 'inspecteur',
      }),
    /secteur Hôtel/,
  );
  assert.equal(marquerMock.mock.calls.length, 0);
});

test('marquerPresenceConfirmee autorise un Inspecteur sur un rendez-vous secteur Bureau, même non assigné à un formateur précis', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(rendezvousRepository, 'trouverRendezvousParId', async () => RENDEZVOUS_TEST);
  t.mock.method(evaluationRepository, 'trouverPostesDossier', async () => ({ typePoste: 'bureau', posteBureau: ['nettoyage'], posteHotel: [] }));
  const marquerMock = t.mock.method(rendezvousRepository, 'marquerPresenceConfirmee', async () => ({}));

  await evaluationEngine.marquerPresenceConfirmee(ENTITE_ACCECIT, {
    rendezvousId: 10,
    formateurId: 999,
    roleCode: 'inspecteur',
  });

  assert.equal(marquerMock.mock.calls.length, 1);
});

test('enregistrerEvaluation rejette un Inspecteur sur un rendez-vous secteur Hôtel (IDOR via un rendezvousId connu)', async (t) => {
  mockerKnex(t);
  mockerDependances(t, { trouverPostesDossier: async () => ({ typePoste: 'hotel', posteBureau: [], posteHotel: ['gouvernant'] }) });

  await assert.rejects(
    () =>
      evaluationEngine.enregistrerEvaluation(ENTITE_ACCECIT, {
        rendezvousId: 10,
        formateurId: 999,
        roleCode: 'inspecteur',
        resultatGlobal: 'invalide',
        commentaire: 'Insuffisant.',
        blocs: [BLOC_REPONSES],
      }),
    /secteur Hôtel/,
  );
});

// listerHistorique (audit 2026-09-17, demande utilisateur : historique partagé pour l'Inspecteur,
// même périmètre que listerRendezvousAEvaluer) — vérifie que le rôle pilote bien les paramètres
// transmis au repository, pas le comportement du repository lui-même (couvert par son propre
// commentaire d'en-tête, aucune règle métier n'y vit).
test('listerHistorique (Formateur) passe le formateurId de la session et aucun filtre secteur', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  const listerMock = t.mock.method(evaluationRepository, 'listerEvaluationsParFormateur', async () => []);

  await evaluationEngine.listerHistorique(ENTITE_ACCECIT, 5, 'formateur');

  assert.deepEqual(listerMock.mock.calls[0].arguments.slice(1), [ENTITE_ACCECIT.id, 5, null, null]);
});

test("listerHistorique (Inspecteur) ignore l'identité connectée et filtre sur le secteur bureau (vue partagée entre tous les Inspecteurs)", async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  const listerMock = t.mock.method(evaluationRepository, 'listerEvaluationsParFormateur', async () => []);

  await evaluationEngine.listerHistorique(ENTITE_ACCECIT, 5, 'inspecteur');

  assert.deepEqual(listerMock.mock.calls[0].arguments.slice(1), [ENTITE_ACCECIT.id, null, 'bureau', null]);
});

// creneau (audit 2026-09-17, filtre "Créneaux souhaités") — indépendant du rôle, transmis tel quel
// au repository en plus de formateurId/typePoste déjà résolus par rôle ci-dessus.
test('listerHistorique transmet le filtre creneau reçu, combiné au filtre secteur déjà résolu pour un Inspecteur', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  const listerMock = t.mock.method(evaluationRepository, 'listerEvaluationsParFormateur', async () => []);

  await evaluationEngine.listerHistorique(ENTITE_ACCECIT, 5, 'inspecteur', '6h-9h');

  assert.deepEqual(listerMock.mock.calls[0].arguments.slice(1), [ENTITE_ACCECIT.id, null, 'bureau', '6h-9h']);
});

// listerCreneauxDisponibles — même résolution formateurId/typePoste par rôle
// que listerHistorique ci-dessus, alimente le select "Créneaux souhaités".
test('listerCreneauxDisponibles (Formateur) passe le formateurId de la session et aucun filtre secteur', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  const listerMock = t.mock.method(evaluationRepository, 'listerCreneauxDisponibles', async () => []);

  await evaluationEngine.listerCreneauxDisponibles(ENTITE_ACCECIT, 5, 'formateur');

  assert.deepEqual(listerMock.mock.calls[0].arguments.slice(1), [ENTITE_ACCECIT.id, 5, null]);
});

test("listerCreneauxDisponibles (Inspecteur) ignore l'identité connectée et filtre sur le secteur bureau", async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  const listerMock = t.mock.method(evaluationRepository, 'listerCreneauxDisponibles', async () => []);

  await evaluationEngine.listerCreneauxDisponibles(ENTITE_ACCECIT, 5, 'inspecteur');

  assert.deepEqual(listerMock.mock.calls[0].arguments.slice(1), [ENTITE_ACCECIT.id, null, 'bureau']);
});

// obtenirDetailEvaluation (réservée au formateur/inspecteur auteur, sauf exemptions ci-dessous) —
// même garde IDOR que enregistrerEvaluation/marquerPresenceConfirmee (verifierAssignationRendezvous)
// pour l'exemption Inspecteur : jamais sans le second contrôle de secteur.
test("obtenirDetailEvaluation autorise un Formateur consultant sa propre évaluation", async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(evaluationRepository, 'trouverEvaluationParId', async () => ({
    id: 1, dossier_id: 62, formateur_id: 5, resultat_global: 'valide', orientation: 'envoi_formation', postes_codes: [],
  }));
  t.mock.method(evaluationRepository, 'listerReponsesEvaluation', async () => []);

  const resultat = await evaluationEngine.obtenirDetailEvaluation(ENTITE_ACCECIT, { evaluationId: 1, formateurId: 5, roleCode: 'formateur' });

  assert.equal(resultat.evaluation.id, 1);
});

test("obtenirDetailEvaluation rejette un Formateur consultant l'évaluation d'un autre formateur", async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(evaluationRepository, 'trouverEvaluationParId', async () => ({ id: 1, dossier_id: 62, formateur_id: 999 }));

  await assert.rejects(
    () => evaluationEngine.obtenirDetailEvaluation(ENTITE_ACCECIT, { evaluationId: 1, formateurId: 5, roleCode: 'formateur' }),
    /n'appartient pas à ce formateur/,
  );
});

test("obtenirDetailEvaluation autorise un Inspecteur consultant l'évaluation d'un autre Inspecteur sur un dossier secteur bureau", async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(evaluationRepository, 'trouverEvaluationParId', async () => ({
    id: 1, dossier_id: 62, formateur_id: 999, resultat_global: 'valide', orientation: null, postes_codes: [],
  }));
  t.mock.method(evaluationRepository, 'trouverPostesDossier', async () => ({ typePoste: 'bureau', posteBureau: [], posteHotel: [] }));
  t.mock.method(evaluationRepository, 'listerReponsesEvaluation', async () => []);

  const resultat = await evaluationEngine.obtenirDetailEvaluation(ENTITE_ACCECIT, { evaluationId: 1, formateurId: 5, roleCode: 'inspecteur' });

  assert.equal(resultat.evaluation.id, 1);
});

test("obtenirDetailEvaluation rejette un Inspecteur consultant l'évaluation d'un Formateur sur un dossier secteur Hôtel (IDOR via un evaluationId connu)", async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(evaluationRepository, 'trouverEvaluationParId', async () => ({ id: 1, dossier_id: 62, formateur_id: 999 }));
  t.mock.method(evaluationRepository, 'trouverPostesDossier', async () => ({ typePoste: 'hotel', posteBureau: [], posteHotel: ['gouvernant'] }));

  await assert.rejects(
    () => evaluationEngine.obtenirDetailEvaluation(ENTITE_ACCECIT, { evaluationId: 1, formateurId: 5, roleCode: 'inspecteur' }),
    /secteur Hôtel/,
  );
});

// obtenirDetailEvaluationDossier (demande utilisateur 2026-09-10 : rendre les critères de
// validation de test visibles depuis la fiche dossier, Validation.jsx — Accueil/Coordination et
// Admin, jamais restreint à "sa propre" évaluation contrairement à obtenirDetailEvaluation
// (réservée au formateur/inspecteur auteur, voir tests ci-dessus).
test("obtenirDetailEvaluationDossier renvoie null (pas une erreur) si aucun test n'a encore été évalué pour ce dossier", async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(evaluationRepository, 'trouverEvaluationParDossier', async () => undefined);

  const resultat = await evaluationEngine.obtenirDetailEvaluationDossier(ENTITE_ACCECIT, 62);

  assert.equal(resultat, null);
});

test('obtenirDetailEvaluationDossier reconstruit les questions (avec items pour une grille_qcu, sans item pour un texte_libre) depuis les réponses plates', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(evaluationRepository, 'trouverEvaluationParDossier', async () => ({
    id: 900,
    resultat_global: 'valide',
    orientation: 'envoi_formation',
    postes_codes: ['nettoyage'],
    commentaire: 'Bon candidat.',
    date_evaluation: new Date('2026-09-01T10:00:00Z'),
    candidat_prenom: 'Sophie',
    candidat_nom: 'Martin',
  }));
  t.mock.method(evaluationRepository, 'listerReponsesEvaluation', async () => [
    {
      question_code: 'savoir_etre',
      question_libelle: 'Savoir-être',
      type_question: 'grille_qcu',
      item_code: 'ponctualite',
      item_libelle: 'Ponctualité',
      valeur: 'excellent',
    },
    {
      question_code: 'commentaire_libre',
      question_libelle: 'Observations',
      type_question: 'texte_libre',
      item_code: null,
      item_libelle: null,
      valeur: 'Très motivé.',
    },
  ]);

  const resultat = await evaluationEngine.obtenirDetailEvaluationDossier(ENTITE_ACCECIT, 62);

  assert.deepEqual(resultat, {
    evaluation: {
      id: 900,
      resultatGlobal: 'valide',
      orientation: 'envoi_formation',
      postesCodes: ['nettoyage'],
      commentaire: 'Bon candidat.',
      dateEvaluation: new Date('2026-09-01T10:00:00Z'),
      candidatPrenom: 'Sophie',
      candidatNom: 'Martin',
    },
    questions: [
      {
        code: 'savoir_etre',
        libelle: 'Savoir-être',
        type_question: 'grille_qcu',
        items: [{ code: 'ponctualite', libelle: 'Ponctualité', valeur: 'excellent' }],
        valeur: null,
      },
      {
        code: 'commentaire_libre',
        libelle: 'Observations',
        type_question: 'texte_libre',
        items: [],
        valeur: 'Très motivé.',
      },
    ],
  });
});

test('obtenirDetailEvaluationDossier ne vérifie aucune appartenance à un formateur (Accueil/Coordination consulte le dossier de n\'importe quel formateur)', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  const trouverMock = t.mock.method(evaluationRepository, 'trouverEvaluationParDossier', async () => ({
    id: 901,
    resultat_global: 'invalide',
    orientation: null,
    postes_codes: [],
    commentaire: 'Non concluant.',
    date_evaluation: new Date('2026-09-02T10:00:00Z'),
    candidat_prenom: 'Marc',
    candidat_nom: 'Dupont',
  }));
  t.mock.method(evaluationRepository, 'listerReponsesEvaluation', async () => []);

  const resultat = await evaluationEngine.obtenirDetailEvaluationDossier(ENTITE_ACCECIT, 62);

  assert.equal(resultat.evaluation.id, 901);
  assert.deepEqual(trouverMock.mock.calls[0].arguments.slice(1), [ENTITE_ACCECIT.id, 62]);
});

// ---------------------------------------------------------------------------------------------
// Parcours selon le SECTEUR DU DOSSIER — orientation, validation Tertiaire,
// SmartOF ne dépendent plus du rôle de l'évaluateur.
// ---------------------------------------------------------------------------------------------
const POSTES_DOSSIER_TERTIAIRE = async () => ({ typePoste: 'bureau', posteBureau: [], posteHotel: [] });

// formateurId : 5 = utilisateur assigné à RENDEZVOUS_TEST (seul un Formateur assigné peut évaluer),
// 1 = Admin (dispensé de l'assignation).
function evaluationValide(roleCode, orientation) {
  return {
    rendezvousId: 10,
    formateurId: roleCode === 'admin' ? 1 : 5,
    roleCode,
    resultatGlobal: 'valide',
    orientation,
    commentaire: 'Bon candidat.',
    blocs: [BLOC_REPONSES],
  };
}

test('Admin sur un dossier Tertiaire : "envoi en formation" refusé avec un message explicite, sans rien écrire', async (t) => {
  mockerKnex(t);
  const { enregistrerMock } = mockerDependances(t, { trouverPostesDossier: POSTES_DOSSIER_TERTIAIRE });
  const appliquerTransitionMock = t.mock.method(workflowEngine, 'appliquerTransition', async () => ({}));
  const envoyerMock = t.mock.method(smartOfService, 'envoyerCandidatEnFormation', async () => {});

  await assert.rejects(
    () => evaluationEngine.enregistrerEvaluation(ENTITE_ACCECIT, evaluationValide('admin', 'envoi_formation')),
    (erreur) =>
      erreur instanceof evaluationEngine.ErreurParcoursEvaluation && /secteur Tertiaire.*ne peut pas être orienté en formation/.test(erreur.message),
  );
  assert.equal(enregistrerMock.mock.calls.length, 0);
  assert.equal(appliquerTransitionMock.mock.calls.length, 0);
  assert.equal(envoyerMock.mock.calls.length, 0);
});

test('Formateur ou Inspecteur sur un dossier Tertiaire : "envoi en formation" refusé aussi, quel que soit l\'évaluateur', async (t) => {
  mockerKnex(t);
  mockerDependances(t, { trouverPostesDossier: POSTES_DOSSIER_TERTIAIRE });
  for (const roleCode of ['formateur', 'inspecteur']) {
    await assert.rejects(
      () => evaluationEngine.enregistrerEvaluation(ENTITE_ACCECIT, evaluationValide(roleCode, 'envoi_formation')),
      evaluationEngine.ErreurParcoursEvaluation,
      roleCode,
    );
  }
});

test('Admin sur un dossier Tertiaire : verdict positif sans orientation -> valider_pret_embauche, orientation NULL, aucun appel SmartOF', async (t) => {
  mockerKnex(t);
  const { enregistrerMock } = mockerDependances(t, { trouverPostesDossier: POSTES_DOSSIER_TERTIAIRE });
  const appliquerTransitionMock = t.mock.method(workflowEngine, 'appliquerTransition', async () => ({ statutDestinationId: 42 }));
  const envoyerMock = t.mock.method(smartOfService, 'envoyerCandidatEnFormation', async () => {});

  await evaluationEngine.enregistrerEvaluation(ENTITE_ACCECIT, evaluationValide('admin', undefined));

  assert.equal(enregistrerMock.mock.calls[0].arguments[1].orientation, null);
  assert.equal(appliquerTransitionMock.mock.calls.at(-1).arguments[1].codeAction, 'valider_pret_embauche');
  assert.equal(envoyerMock.mock.calls.length, 0);
});

test('Admin sur un dossier Hôtellerie : parcours Formateur (orientation obligatoire ; "envoi en formation" -> valider_envoi_formation + SmartOF)', async (t) => {
  mockerKnex(t);
  mockerDependances(t, { trouverPostesDossier: POSTES_DOSSIER_HOTEL });
  const appliquerTransitionMock = t.mock.method(workflowEngine, 'appliquerTransition', async () => ({ statutDestinationId: 18 }));
  const envoyerMock = t.mock.method(smartOfService, 'envoyerCandidatEnFormation', async () => {});

  await assert.rejects(
    () => evaluationEngine.enregistrerEvaluation(ENTITE_ACCECIT, evaluationValide('admin', undefined)),
    /Orientation "undefined" invalide/,
  );

  await evaluationEngine.enregistrerEvaluation(ENTITE_ACCECIT, evaluationValide('admin', 'envoi_formation'));
  assert.equal(appliquerTransitionMock.mock.calls.at(-1).arguments[1].codeAction, 'valider_envoi_formation');
  assert.deepEqual(envoyerMock.mock.calls[0].arguments, [ENTITE_ACCECIT, { dossierId: 62, roleCode: 'admin' }]);
});

test("Traçabilité : quand l'Admin évalue, l'évaluation et les transitions portent l'id de l'Admin, et le rendez-vous n'est pas réassigné", async (t) => {
  mockerKnex(t);
  const { enregistrerMock, mettreAJourStatutRendezvousMock } = mockerDependances(t, { trouverPostesDossier: POSTES_DOSSIER_HOTEL });
  const appliquerTransitionMock = t.mock.method(workflowEngine, 'appliquerTransition', async () => ({ statutDestinationId: 42 }));
  const ADMIN_ID = 1; // RENDEZVOUS_TEST.formateur_id vaut 5 (formateur attribué)

  await evaluationEngine.enregistrerEvaluation(ENTITE_ACCECIT, evaluationValide('admin', 'pret_embauche'));

  assert.equal(enregistrerMock.mock.calls[0].arguments[1].formateurId, ADMIN_ID);
  for (const appel of appliquerTransitionMock.mock.calls) assert.equal(appel.arguments[1].utilisateurId, ADMIN_ID);
  // Seule écriture sur le rendez-vous : son statut ('honore'), jamais formateur_id.
  assert.deepEqual(mettreAJourStatutRendezvousMock.mock.calls[0].arguments[2], { statut: 'honore', motifId: null });
});

test('resoudreParcoursEvaluation : secteur du dossier prioritaire, repli sur le rôle seulement sans typePoste', () => {
  const { resoudreParcoursEvaluation } = evaluationEngine;
  for (const roleCode of ['admin', 'formateur', 'inspecteur']) {
    assert.equal(resoudreParcoursEvaluation({ typePosteDossier: 'bureau', roleCode }), 'tertiaire', roleCode);
    assert.equal(resoudreParcoursEvaluation({ typePosteDossier: 'hotel', roleCode }), 'hotellerie', roleCode);
  }
  assert.equal(resoudreParcoursEvaluation({ typePosteDossier: null, roleCode: 'inspecteur' }), 'tertiaire');
  assert.equal(resoudreParcoursEvaluation({ typePosteDossier: null, roleCode: 'formateur' }), 'hotellerie');
});

// ---------------------------------------------------------------------------------------------
// Vues Admin "Vue Formateur"/"Vue Inspecteur" — paramètres secteur/formateurId
// pris en compte pour l'Admin seulement.
// ---------------------------------------------------------------------------------------------
test('filtresEvaluationsParRole : Admin + secteur -> tout le secteur demandé, filtrable par formateurId', () => {
  const { filtresEvaluationsParRole } = evaluationEngine;
  for (const vue of ['a_faire', 'historique']) {
    assert.deepEqual(filtresEvaluationsParRole({ roleCode: 'admin', utilisateurId: 1, vue, secteur: 'tertiaire' }), { formateurId: null, typePoste: 'bureau' });
    assert.deepEqual(filtresEvaluationsParRole({ roleCode: 'admin', utilisateurId: 1, vue, secteur: 'hotellerie', formateurIdDemande: 5 }), { formateurId: 5, typePoste: 'hotel' });
  }
});

test('filtresEvaluationsParRole : Admin sans secteur -> comportement antérieur (à faire : tout ; historique : ses évaluations)', () => {
  const { filtresEvaluationsParRole } = evaluationEngine;
  assert.deepEqual(filtresEvaluationsParRole({ roleCode: 'admin', utilisateurId: 1, vue: 'a_faire' }), { formateurId: null, typePoste: null });
  assert.deepEqual(filtresEvaluationsParRole({ roleCode: 'admin', utilisateurId: 1, vue: 'historique' }), { formateurId: 1, typePoste: null });
});

test("filtresEvaluationsParRole : un Formateur ou un Inspecteur qui envoie secteur/formateurId n'obtient rien de plus qu'avant", () => {
  const { filtresEvaluationsParRole } = evaluationEngine;
  for (const vue of ['a_faire', 'historique']) {
    const tentative = { vue, secteur: 'hotellerie', formateurIdDemande: 99 };
    assert.deepEqual(filtresEvaluationsParRole({ roleCode: 'formateur', utilisateurId: 5, ...tentative }), { formateurId: 5, typePoste: null });
    assert.deepEqual(filtresEvaluationsParRole({ roleCode: 'inspecteur', utilisateurId: 7, ...tentative }), { formateurId: null, typePoste: 'bureau' });
  }
});

// Liste "à faire" de bout en bout (moteur + base factice appliquant les mêmes critères que la
// requête SQL : formateur_id et bloc_disponibilites.typePoste, voir evaluationRepository).
const RENDEZVOUS_EN_BASE = [
  { id: 1, formateur_id: 5, donnees_disponibilites: { typePoste: 'hotel', posteHotel: ['equipier'] } },
  { id: 2, formateur_id: 6, donnees_disponibilites: { typePoste: 'hotel', posteHotel: ['cafetier'] } },
  { id: 3, formateur_id: 7, donnees_disponibilites: { typePoste: 'bureau', posteBureau: ['nettoyage'] } },
];
function mockerBaseRendezvousAEvaluer(t) {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  return t.mock.method(evaluationRepository, 'listerRendezvousAEvaluer', async (_bd, _entiteId, formateurId, typePoste) =>
    RENDEZVOUS_EN_BASE.filter(
      (rdv) => (formateurId === null || rdv.formateur_id === formateurId) && (typePoste === null || rdv.donnees_disponibilites.typePoste === typePoste),
    ),
  );
}

test("listerRendezvousAEvaluer : l'Admin ne reçoit que le secteur demandé (tous évaluateurs), filtrable par formateurId", async (t) => {
  mockerBaseRendezvousAEvaluer(t);
  const ids = async (options) => (await evaluationEngine.listerRendezvousAEvaluer(ENTITE_ACCECIT, 1, 'admin', options)).map((rdv) => rdv.id);

  assert.deepEqual(await ids({ secteur: 'hotellerie' }), [1, 2]);
  assert.deepEqual(await ids({ secteur: 'tertiaire' }), [3]);
  assert.deepEqual(await ids({ secteur: 'hotellerie', formateurIdDemande: 6 }), [2]);
  // typePoste exposé pour que GrilleEvaluation choisisse le parcours selon le secteur du dossier.
  assert.equal((await evaluationEngine.listerRendezvousAEvaluer(ENTITE_ACCECIT, 1, 'admin', { secteur: 'tertiaire' }))[0].typePoste, 'bureau');
});

test("listerRendezvousAEvaluer : Formateur et Inspecteur inchangés même s'ils envoient secteur/formateurId", async (t) => {
  mockerBaseRendezvousAEvaluer(t);
  const tentative = { secteur: 'hotellerie', formateurIdDemande: 6 };
  const ids = async (utilisateurId, roleCode, options) =>
    (await evaluationEngine.listerRendezvousAEvaluer(ENTITE_ACCECIT, utilisateurId, roleCode, options)).map((rdv) => rdv.id);

  assert.deepEqual(await ids(5, 'formateur', tentative), await ids(5, 'formateur', undefined));
  assert.deepEqual(await ids(5, 'formateur', tentative), [1]);
  assert.deepEqual(await ids(7, 'inspecteur', tentative), await ids(7, 'inspecteur', undefined));
  assert.deepEqual(await ids(7, 'inspecteur', tentative), [3]);
});

test("listerHistorique et listerCreneauxDisponibles : Admin + secteur transmis au repository, Formateur inchangé", async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  const historiqueMock = t.mock.method(evaluationRepository, 'listerEvaluationsParFormateur', async () => []);
  const creneauxMock = t.mock.method(evaluationRepository, 'listerCreneauxDisponibles', async () => []);

  await evaluationEngine.listerHistorique(ENTITE_ACCECIT, 1, 'admin', null, { secteur: 'tertiaire', formateurIdDemande: 7 });
  await evaluationEngine.listerCreneauxDisponibles(ENTITE_ACCECIT, 1, 'admin', { secteur: 'tertiaire' });
  await evaluationEngine.listerHistorique(ENTITE_ACCECIT, 5, 'formateur', null, { secteur: 'tertiaire', formateurIdDemande: 7 });

  assert.deepEqual(historiqueMock.mock.calls[0].arguments.slice(2), [7, 'bureau', null]);
  assert.deepEqual(creneauxMock.mock.calls[0].arguments.slice(2), [null, 'bureau']);
  assert.deepEqual(historiqueMock.mock.calls[1].arguments.slice(2), [5, null, null]);
});
