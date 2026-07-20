const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const pieceJustificativeRepository = require('./pieceJustificativeRepository');
const dossierRepository = require('./dossierRepository');
// storageFactory('azure_onedrive') retourne toujours ce même singleton : on mocke ses méthodes
// directement plutôt que storageFactory (export de fonction brute, non mockable via t.mock.method
// une fois déstructuré/consommé — cf. commentaire en tête de azureOneDriveConnector.js).
const azureOneDriveConnector = require('../../integrations/stockage/azureOneDriveConnector');
const service = require('./pieceJustificativeService');

const ENTITE_ACCECIT = { id: 1, code: 'accecit', connecteur_stockage: 'azure_onedrive' };

function mockerKnex(t) {
  // bd n'est jamais réellement interrogé dans ces tests : trouverTypePieceParCode et les autres
  // fonctions du repository sont mockées, donc la valeur passée pour `bd` n'a pas besoin d'être
  // un vrai knex — seule sa présence (pas d'appel réseau réel à Neon) compte.
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  // Par défaut le dossier appartient bien à l'entité (voir verifierDossierAppartientEntite dans
  // pieceJustificativeService.js) — les tests qui veulent couvrir le rejet inter-entités
  // surchargent ce mock explicitement.
  t.mock.method(dossierRepository, 'trouverDossierParId', async () => ({ id: 42 }));
}

test('uploaderPieceJustificative rejette un contenu qui n\'est pas un Buffer', async () => {
  await assert.rejects(
    () => service.uploaderPieceJustificative(ENTITE_ACCECIT, {
      dossierId: 42,
      typePieceCode: 'CNI',
      nomFichier: 'cni.pdf',
      contenu: 'pas-un-buffer',
      uploadedBy: 1,
    }),
    /attend un contenu de type Buffer/,
  );
});

test('uploaderPieceJustificative rejette un type de pièce non configuré pour l\'entité', async (t) => {
  mockerKnex(t);
  t.mock.method(pieceJustificativeRepository, 'trouverTypePieceParCode', async () => undefined);

  await assert.rejects(
    () => service.uploaderPieceJustificative(ENTITE_ACCECIT, {
      dossierId: 42,
      typePieceCode: 'INCONNU',
      nomFichier: 'x.pdf',
      contenu: Buffer.from('x'),
      uploadedBy: 1,
    }),
    /Type de pièce "INCONNU" non configuré pour l'entité « accecit »/,
  );
});

test("uploaderPieceJustificative rejette si le dossier n'appartient pas à l'entité", async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'trouverDossierParId', async () => undefined);

  await assert.rejects(
    () => service.uploaderPieceJustificative(ENTITE_ACCECIT, {
      dossierId: 999,
      typePieceCode: 'CNI',
      nomFichier: 'cni.pdf',
      contenu: Buffer.from('x'),
      uploadedBy: 1,
    }),
    /Dossier "999" introuvable pour l'entité « accecit »/,
  );
});

test('uploaderPieceJustificative uploade vers le connecteur puis enregistre la référence en base', async (t) => {
  mockerKnex(t);
  t.mock.method(pieceJustificativeRepository, 'trouverTypePieceParCode', async () => ({ id: 7, code: 'CNI' }));
  const uploadMock = t.mock.method(azureOneDriveConnector, 'upload', async () => 'ref-stockage-123');
  const enregistrerMock = t.mock.method(pieceJustificativeRepository, 'enregistrerPieceJustificative', async () => 99);

  const resultat = await service.uploaderPieceJustificative(ENTITE_ACCECIT, {
    dossierId: 42,
    typePieceCode: 'CNI',
    nomFichier: 'cni.pdf',
    contenu: Buffer.from('contenu'),
    uploadedBy: 5,
  });

  assert.deepEqual(resultat, { pieceId: 99, referenceStockage: 'ref-stockage-123' });
  assert.equal(uploadMock.mock.calls.length, 1);
  assert.deepEqual(uploadMock.mock.calls[0].arguments, [42, { nom: 'cni.pdf', contenu: Buffer.from('contenu') }]);
  assert.equal(enregistrerMock.mock.calls.length, 1);
  assert.deepEqual(enregistrerMock.mock.calls[0].arguments[1], {
    dossierId: 42,
    typePieceId: 7,
    referenceStockage: 'ref-stockage-123',
    nomFichier: 'cni.pdf',
    uploadedBy: 5,
  });
});

test('telechargerPieceJustificative rejette si la pièce est introuvable en base', async (t) => {
  mockerKnex(t);
  t.mock.method(pieceJustificativeRepository, 'trouverPieceJustificativeParId', async () => undefined);

  await assert.rejects(
    () => service.telechargerPieceJustificative(ENTITE_ACCECIT, 999),
    /Pièce justificative "999" introuvable/,
  );
});

test('telechargerPieceJustificative récupère le contenu via le connecteur de l\'entité', async (t) => {
  mockerKnex(t);
  t.mock.method(pieceJustificativeRepository, 'trouverPieceJustificativeParId', async () => ({
    id: 99,
    reference_stockage: 'ref-stockage-123',
    nom_fichier: 'cni.pdf',
  }));
  t.mock.method(azureOneDriveConnector, 'download', async () => Buffer.from('contenu'));

  const resultat = await service.telechargerPieceJustificative(ENTITE_ACCECIT, 99);
  assert.deepEqual(resultat, { nomFichier: 'cni.pdf', contenu: Buffer.from('contenu') });
});

test('supprimerPieceJustificative supprime chez le connecteur puis retire la ligne en base', async (t) => {
  mockerKnex(t);
  t.mock.method(pieceJustificativeRepository, 'trouverPieceJustificativeParId', async () => ({
    id: 99,
    reference_stockage: 'ref-stockage-123',
  }));
  const supprimerConnecteurMock = t.mock.method(azureOneDriveConnector, 'supprimer', async () => {});
  const supprimerLigneMock = t.mock.method(pieceJustificativeRepository, 'supprimerPieceJustificativeParId', async () => 1);

  await service.supprimerPieceJustificative(ENTITE_ACCECIT, 99);

  assert.equal(supprimerConnecteurMock.mock.calls.length, 1);
  assert.deepEqual(supprimerConnecteurMock.mock.calls[0].arguments, ['ref-stockage-123']);
  assert.equal(supprimerLigneMock.mock.calls.length, 1);
});

test('supprimerPieceJustificative rejette si la pièce est introuvable en base', async (t) => {
  mockerKnex(t);
  t.mock.method(pieceJustificativeRepository, 'trouverPieceJustificativeParId', async () => undefined);

  await assert.rejects(
    () => service.supprimerPieceJustificative(ENTITE_ACCECIT, 999),
    /Pièce justificative "999" introuvable/,
  );
});

test('listerPiecesJustificatives délègue au repository pour le dossier donné', async (t) => {
  mockerKnex(t);
  const listerMock = t.mock.method(pieceJustificativeRepository, 'listerPiecesParDossier', async () => [
    { id: 1, dossier_id: 42, type_piece_code: 'CNI' },
  ]);

  const resultat = await service.listerPiecesJustificatives(ENTITE_ACCECIT, 42);

  assert.deepEqual(resultat, [{ id: 1, dossier_id: 42, type_piece_code: 'CNI' }]);
  assert.deepEqual(listerMock.mock.calls[0].arguments[1], 42);
});

test("listerPiecesJustificatives rejette si le dossier n'appartient pas à l'entité", async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'trouverDossierParId', async () => undefined);

  await assert.rejects(
    () => service.listerPiecesJustificatives(ENTITE_ACCECIT, 999),
    /Dossier "999" introuvable pour l'entité « accecit »/,
  );
});

test('obtenirUrlTemporairePieceJustificative rejette si la pièce est introuvable en base', async (t) => {
  mockerKnex(t);
  t.mock.method(pieceJustificativeRepository, 'trouverPieceJustificativeParId', async () => undefined);

  await assert.rejects(
    () => service.obtenirUrlTemporairePieceJustificative(ENTITE_ACCECIT, 999),
    /Pièce justificative "999" introuvable/,
  );
});

test('obtenirUrlTemporairePieceJustificative délègue au connecteur de l\'entité', async (t) => {
  mockerKnex(t);
  t.mock.method(pieceJustificativeRepository, 'trouverPieceJustificativeParId', async () => ({
    id: 99,
    reference_stockage: 'ref-stockage-123',
  }));
  t.mock.method(azureOneDriveConnector, 'obtenirUrlTemporaire', async () => 'https://exemple.test/signe');

  const url = await service.obtenirUrlTemporairePieceJustificative(ENTITE_ACCECIT, 99);
  assert.equal(url, 'https://exemple.test/signe');
});

test('mettreAJourStatutVerificationPieceJustificative rejette un statut hors valide/rejete', async () => {
  await assert.rejects(
    () => service.mettreAJourStatutVerificationPieceJustificative(ENTITE_ACCECIT, 99, 'en_attente'),
    /Statut de vérification "en_attente" invalide/,
  );
});

test('mettreAJourStatutVerificationPieceJustificative rejette si la pièce est introuvable en base', async (t) => {
  mockerKnex(t);
  t.mock.method(pieceJustificativeRepository, 'trouverPieceJustificativeParId', async () => undefined);

  await assert.rejects(
    () => service.mettreAJourStatutVerificationPieceJustificative(ENTITE_ACCECIT, 999, 'valide'),
    /Pièce justificative "999" introuvable/,
  );
});

test('mettreAJourStatutVerificationPieceJustificative met à jour le statut et pose la date de vérification', async (t) => {
  mockerKnex(t);
  t.mock.method(pieceJustificativeRepository, 'trouverPieceJustificativeParId', async () => ({ id: 99 }));
  const mettreAJourMock = t.mock.method(
    pieceJustificativeRepository,
    'mettreAJourStatutVerification',
    async () => ({ id: 99, statut_verification: 'valide' }),
  );

  const resultat = await service.mettreAJourStatutVerificationPieceJustificative(ENTITE_ACCECIT, 99, 'valide');

  assert.deepEqual(resultat, { id: 99, statut_verification: 'valide' });
  // arguments[0] = trx (bd mockée), voir mockerKnex — le repository suit toujours ce patron
  // (trx en premier argument, comme enregistrerPieceJustificative/trouverPieceJustificativeParId).
  const [, pieceIdAppel, donneesAppel] = mettreAJourMock.mock.calls[0].arguments;
  assert.equal(pieceIdAppel, 99);
  assert.equal(donneesAppel.statutVerification, 'valide');
  assert.ok(donneesAppel.dateVerification instanceof Date);
});
