const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const dossierRepository = require('../../core/dossier/dossierRepository');
const smartOfClient = require('./smartOfClient');
const smartOfService = require('./smartOfService');

const ENTITE_ACCECIT = {
  id: 1,
  code: 'accecit',
  smartof_actif: true,
  smartof_config: { entreprises_par_role: { formateur: 'ENT-0003', inspecteur: 'ENT-0002' } },
};

const INSCRIPTION = { candidat: { nom: 'ETEST', prenom: 'TEST', civilite: 'monsieur' }, blocs: {} };

const ENTREPRISES = [
  { entrepriseUid: 'uid-tertiaire', customId: 'ENT-0002', meta: { nom: 'ACCECIT Tertiaire' } },
  { entrepriseUid: 'uid-hotellerie', customId: 'ENT-0003', meta: { nom: 'ACCECIT Hôtellerie' } },
];

// bd factice : seul `bd('smartof_sync').insert(...)` est exercé par smartOfService — les autres
// appels DB passent par dossierRepository, mocké séparément ci-dessous (même patron que
// evaluationEngine.test.js, mockerKnex).
function mockerBd(t) {
  const insertMock = t.mock.fn(async () => {});
  t.mock.method(db, 'obtenirKnex', async () => (nomTable) => ({ insert: insertMock }));
  return { insertMock };
}

test('envoyerCandidatEnFormation résout l\'entreprise par customId (pas par nom), crée l\'apprenant et journalise smartof_sync', async (t) => {
  const { insertMock } = mockerBd(t);
  t.mock.method(dossierRepository, 'trouverInscriptionCompleteParDossierId', async () => INSCRIPTION);
  t.mock.method(smartOfClient, 'listerEntreprises', async () => ENTREPRISES);
  const creerApprenantMock = t.mock.method(smartOfClient, 'creerApprenant', async () => ({ apprenantUid: 'uid-apprenant-1' }));

  await smartOfService.envoyerCandidatEnFormation(ENTITE_ACCECIT, { dossierId: 69, roleCode: 'formateur' });

  // formateur -> ENT-0003 -> uid-hotellerie (pas uid-tertiaire) : vérifie que la résolution suit
  // bien customId, pas l'ordre du tableau ni meta.nom.
  assert.equal(creerApprenantMock.mock.calls[0].arguments[0].entrepriseUids[0], 'uid-hotellerie');
  assert.equal(insertMock.mock.calls[0].arguments[0].dossier_id, 69);
  assert.equal(insertMock.mock.calls[0].arguments[0].smartof_candidat_id, 'uid-apprenant-1');
  assert.equal(insertMock.mock.calls[0].arguments[0].statut_sync, 'envoye');
});

test('envoyerCandidatEnFormation ne fait rien si smartof_actif est false', async (t) => {
  const { insertMock } = mockerBd(t);
  const listerMock = t.mock.method(smartOfClient, 'listerEntreprises', async () => ENTREPRISES);

  await smartOfService.envoyerCandidatEnFormation({ ...ENTITE_ACCECIT, smartof_actif: false }, { dossierId: 69, roleCode: 'formateur' });

  assert.equal(listerMock.mock.calls.length, 0);
  assert.equal(insertMock.mock.calls.length, 0);
});

test("envoyerCandidatEnFormation n'appelle jamais creerApprenant si aucune entreprise ne correspond au customId configuré, et n'écrit rien en base", async (t) => {
  const { insertMock } = mockerBd(t);
  t.mock.method(dossierRepository, 'trouverInscriptionCompleteParDossierId', async () => INSCRIPTION);
  t.mock.method(smartOfClient, 'listerEntreprises', async () => ENTREPRISES);
  const creerApprenantMock = t.mock.method(smartOfClient, 'creerApprenant', async () => ({ apprenantUid: 'uid-apprenant-1' }));

  await smartOfService.envoyerCandidatEnFormation(
    { ...ENTITE_ACCECIT, smartof_config: { entreprises_par_role: { formateur: 'ENT-INCONNU' } } },
    { dossierId: 69, roleCode: 'formateur' },
  );

  assert.equal(creerApprenantMock.mock.calls.length, 0);
  assert.equal(insertMock.mock.calls.length, 0);
});

test("envoyerCandidatEnFormation avale une erreur SmartOF (ex. creerApprenant en échec) sans la propager à l'appelant", async (t) => {
  mockerBd(t);
  t.mock.method(dossierRepository, 'trouverInscriptionCompleteParDossierId', async () => INSCRIPTION);
  t.mock.method(smartOfClient, 'listerEntreprises', async () => ENTREPRISES);
  t.mock.method(smartOfClient, 'creerApprenant', async () => {
    throw new Error('SmartOF indisponible');
  });

  await assert.doesNotReject(() =>
    smartOfService.envoyerCandidatEnFormation(ENTITE_ACCECIT, { dossierId: 69, roleCode: 'formateur' }),
  );
});
