const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
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

function mockerDependances(t, overrides = {}) {
  t.mock.method(rendezvousRepository, 'trouverRendezvousParId', async () => RENDEZVOUS_TEST);
  t.mock.method(evaluationRepository, 'trouverEvaluationParRendezvous', async () => undefined);
  t.mock.method(evaluationRepository, 'trouverQuestionnairePourPoste', async () => QUESTIONNAIRE);
  t.mock.method(evaluationRepository, 'listerQuestionsAvecItems', async () => QUESTIONS);
  t.mock.method(evaluationRepository, 'enregistrerReponses', async () => {});
  t.mock.method(evaluationRepository, 'enregistrerPostesEvaluation', async () => {});
  t.mock.method(workflowEngine, 'appliquerTransition', async () => ({ statutDestinationId: 42 }));
  const enregistrerMock = t.mock.method(evaluationRepository, 'enregistrerEvaluation', overrides.enregistrerEvaluation ?? (async () => 1));
  return { enregistrerMock };
}

const BLOC_REPONSES = { posteCode: 'nettoyage', reponses: [{ questionCode: 'savoir_etre', questionItemCode: 'ponctualite', valeur: 'excellent' }] };

test("enregistrerEvaluation accepte un verdict positif d'Inspecteur sans orientation, la persiste à NULL, et déclenche valider_pret_embauche", async (t) => {
  mockerKnex(t);
  const { enregistrerMock } = mockerDependances(t);
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
  mockerDependances(t);
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
