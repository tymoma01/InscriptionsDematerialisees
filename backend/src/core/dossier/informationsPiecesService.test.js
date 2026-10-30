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

// « Renseigner plus tard »

const journalAudit = require('../audit/journalAudit');
const db = require('../../db/knex');
const {
  reporterPieceIdentite,
  reporterRib,
  verifierInformationsPiecesConfirmeesPourEmbauche,
  ErreurInformationsPiecesDejaConfirmees,
} = require('./informationsPiecesService');

const CONTEXTE = { utilisateurId: 9, adresseIp: '10.0.0.4' };
const NON_SAISI = { pieceIdentiteType: null, ibanChiffre: null };

function mockerKnex(t) {
  t.mock.method(db, 'obtenirKnex', async () => ({ transaction: async (callback) => callback(TRX) }));
}

test('planifier_test : pièce et RIB reportés -> autorisé', async (t) => {
  dossier(t, { ...NON_SAISI, pieceIdentiteACompleter: true, ribACompleter: true });
  await verifierInformationsPiecesConfirmees(ENTITE, 62, PLANIFIER, TRX);
});

test('planifier_test : pièce reportée mais RIB ni confirmé ni reporté -> refus qui ne nomme que le RIB', async (t) => {
  dossier(t, { ...NON_SAISI, pieceIdentiteACompleter: true });
  await assert.rejects(verifierInformationsPiecesConfirmees(ENTITE, 62, PLANIFIER, TRX), (erreur) => {
    assert.ok(erreur instanceof ErreurInformationsPiecesNonConfirmees);
    assert.match(erreur.message, /confirmez d’abord les coordonnées bancaires \(/);
    return true;
  });
});

test('report : indicateur posé et trace d’audit (qui, quelle pièce) dans la même transaction', async (t) => {
  mockerKnex(t);
  dossier(t, NON_SAISI);
  const reporter = t.mock.method(informationsPiecesRepository, 'reporterPieceIdentite', async () => {});
  const audit = t.mock.method(journalAudit, 'enregistrerAction', async () => {});

  assert.equal(await reporterPieceIdentite(ENTITE, 62, CONTEXTE), true);

  assert.deepEqual(reporter.mock.calls[0].arguments, [TRX, 5]);
  assert.deepEqual(audit.mock.calls[0].arguments, [
    TRX,
    { utilisateurId: 9, entiteId: 1, action: 'piece_identite_report', tableCible: 'dossiers', cibleId: 62, adresseIp: '10.0.0.4' },
  ]);
});

test('report du RIB : tracé sous sa propre action', async (t) => {
  mockerKnex(t);
  dossier(t, NON_SAISI);
  t.mock.method(informationsPiecesRepository, 'reporterRib', async () => {});
  const audit = t.mock.method(journalAudit, 'enregistrerAction', async () => {});
  await reporterRib(ENTITE, 62, CONTEXTE);
  assert.equal(audit.mock.calls[0].arguments[1].action, 'rib_report');
});

test('report : refusé si la pièce est déjà confirmée, rien d’écrit ni de tracé', async (t) => {
  mockerKnex(t);
  dossier(t, {});
  const reporter = t.mock.method(informationsPiecesRepository, 'reporterPieceIdentite', async () => {});
  const audit = t.mock.method(journalAudit, 'enregistrerAction', async () => {});
  await assert.rejects(reporterPieceIdentite(ENTITE, 62, CONTEXTE), ErreurInformationsPiecesDejaConfirmees);
  assert.equal(reporter.mock.callCount(), 0);
  assert.equal(audit.mock.callCount(), 0);
});

test('report : dossier d’une autre entité -> false', async (t) => {
  mockerKnex(t);
  t.mock.method(informationsPiecesRepository, 'trouverParDossierId', async () => undefined);
  assert.equal(await reporterRib(ENTITE, 62, CONTEXTE), false);
});

test('prêt à l’embauche : informations seulement reportées -> refus avec message clair', async (t) => {
  dossier(t, { pieceIdentiteACompleter: true, ribACompleter: true });
  await assert.rejects(
    verifierInformationsPiecesConfirmeesPourEmbauche(ENTITE, 62, 'valide_pret_embauche', TRX),
    /Informations de la pièce d’identité et du RIB à compléter avant de valider l’embauche\./,
  );
});

test('prêt à l’embauche : seul le RIB reporté -> refus qui ne nomme que le RIB', async (t) => {
  dossier(t, { ribACompleter: true });
  await assert.rejects(
    verifierInformationsPiecesConfirmeesPourEmbauche(ENTITE, 62, 'embauche', TRX),
    /Informations du RIB à compléter avant de valider l’embauche\./,
  );
});

test('prêt à l’embauche : dossier ancien sans informations ni report -> autorisé', async (t) => {
  dossier(t, { ...NON_SAISI, pieceIdentiteACompleter: false, ribACompleter: false });
  await verifierInformationsPiecesConfirmeesPourEmbauche(ENTITE, 62, 'valide_pret_embauche', TRX);
});

test('prêt à l’embauche : informations confirmées après report (indicateurs remis à faux) -> autorisé', async (t) => {
  dossier(t, { pieceIdentiteACompleter: false, ribACompleter: false });
  await verifierInformationsPiecesConfirmeesPourEmbauche(ENTITE, 62, 'valide_pret_embauche', TRX);
});

test('autres statuts d’arrivée : aucun contrôle', async (t) => {
  const lecture = dossier(t, { ...NON_SAISI });
  await verifierInformationsPiecesConfirmeesPourEmbauche(ENTITE, 62, 'test_planifie', TRX);
  assert.equal(lecture.mock.callCount(), 0);
});
