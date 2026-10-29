const test = require('node:test');
const assert = require('node:assert/strict');

const informationsPiecesRepository = require('./informationsPiecesRepository');
const { verifierInformationsPiecesConfirmees, ErreurInformationsPiecesNonConfirmees } = require('./informationsPiecesService');

const ENTITE = { id: 1, code: 'accecit' };
const TRX = { estUnTrx: true };
const PLANIFIER = [{ codeAction: 'planifier_test' }];

function dossier(t, valeurs) {
  return t.mock.method(informationsPiecesRepository, 'trouverParDossierId', async () => ({
    candidatId: 5,
    pieceIdentiteType: 'carte_identite',
    ibanChiffre: Buffer.from('x'),
    ...valeurs,
  }));
}

test('planifier_test : pièce et RIB confirmés -> autorisé, lu dans la transaction de planification', async (t) => {
  const lecture = dossier(t, {});
  await verifierInformationsPiecesConfirmees(ENTITE, 62, PLANIFIER, TRX);
  assert.deepEqual(lecture.mock.calls[0].arguments, [TRX, 1, 62]);
});

test('planifier_test : pièce ou RIB non confirmés -> refus qui nomme ce qui manque', async (t) => {
  dossier(t, { pieceIdentiteType: null, ibanChiffre: null });
  await assert.rejects(verifierInformationsPiecesConfirmees(ENTITE, 62, PLANIFIER, TRX), (erreur) => {
    assert.ok(erreur instanceof ErreurInformationsPiecesNonConfirmees);
    assert.match(erreur.message, /pièce d’identité et les coordonnées bancaires/);
    return true;
  });
});

test('planifier_test : RIB seul manquant -> refus', async (t) => {
  dossier(t, { ibanChiffre: null });
  await assert.rejects(verifierInformationsPiecesConfirmees(ENTITE, 62, PLANIFIER, TRX), /confirmez d’abord les coordonnées bancaires/);
});

test('autres transitions (replanification…) : aucun contrôle', async (t) => {
  const lecture = dossier(t, { pieceIdentiteType: null, ibanChiffre: null });
  await verifierInformationsPiecesConfirmees(ENTITE, 62, [{ codeAction: 'replanifier_test' }], TRX);
  assert.equal(lecture.mock.callCount(), 0);
});
