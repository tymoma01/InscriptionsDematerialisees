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

// date_creation/candidat_nom/candidat_prenom : depuis la jointure candidats ajoutée à
// trouverDossierAvecStatutParId (voir dossierRepository.js) — sert à construire l'arborescence
// SharePoint {année}/{mois}/{NOM_PRENOM} au moment de l'upload (voir pieceJustificativeService.js).
const DATE_CREATION_DOSSIER_TEST = new Date('2026-07-20T10:00:00Z');

function mockerKnex(t) {
  // bd n'est jamais réellement interrogé dans ces tests : trouverTypePieceParCode et les autres
  // fonctions du repository sont mockées, donc la valeur passée pour `bd` n'a pas besoin d'être
  // un vrai knex — seule sa présence (pas d'appel réseau réel à Neon) compte.
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  // Par défaut le dossier appartient bien à l'entité (voir verifierDossierAppartientEntite,
  // utilisée par listerPiecesJustificatives) et, pour uploaderPieceJustificative (qui interroge
  // trouverDossierAvecStatutParId à la place, voir pieceJustificativeService.js), est dans un
  // statut où l'upload est autorisé — les tests qui veulent couvrir le rejet inter-entités ou le
  // rejet par statut surchargent le mock concerné explicitement.
  t.mock.method(dossierRepository, 'trouverDossierParId', async () => ({ id: 42 }));
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({
    id: 42,
    statut_code: 'en_attente_pieces',
    statut_libelle: 'En attente de pièces',
    date_creation: DATE_CREATION_DOSSIER_TEST,
    candidat_nom: 'Martin',
    candidat_prenom: 'Sophie',
  }));
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
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => undefined);

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

// Même un dossier définitivement tranché ('valide') peut encore recevoir une pièce jamais
// capturée (voir STATUTS_AJOUT_PIECE_MANQUANTE_EXCLUS, qui n'exclut que 'nouveau') — seul le
// remplacement d'une pièce déjà présente reste bloqué (test dédié plus haut).
test("uploaderPieceJustificative autorise l'ajout d'une pièce manquante même sur un dossier statut valide", async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({
    id: 42,
    statut_code: 'valide',
    statut_libelle: 'Validé',
    date_creation: DATE_CREATION_DOSSIER_TEST,
    candidat_nom: 'Martin',
    candidat_prenom: 'Sophie',
  }));
  t.mock.method(pieceJustificativeRepository, 'trouverTypePieceParCode', async () => ({ id: 7, code: 'CNI' }));
  t.mock.method(pieceJustificativeRepository, 'trouverPieceParDossierEtType', async () => undefined);
  t.mock.method(azureOneDriveConnector, 'upload', async () => 'ref-stockage-999');
  t.mock.method(pieceJustificativeRepository, 'enregistrerPieceJustificative', async () => 102);

  const resultat = await service.uploaderPieceJustificative(ENTITE_ACCECIT, {
    dossierId: 42,
    typePieceCode: 'CNI',
    nomFichier: 'cni.pdf',
    contenu: Buffer.from('x'),
    uploadedBy: 1,
  });

  assert.deepEqual(resultat, { pieceId: 102, referenceStockage: 'ref-stockage-999' });
});

test("uploaderPieceJustificative autorise l'upload quand le dossier est en_attente_verification (ajout tardif)", async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({
    id: 42,
    statut_code: 'en_attente_verification',
    statut_libelle: 'En attente de vérification',
    date_creation: DATE_CREATION_DOSSIER_TEST,
    candidat_nom: 'Martin',
    candidat_prenom: 'Sophie',
  }));
  t.mock.method(pieceJustificativeRepository, 'trouverTypePieceParCode', async () => ({ id: 7, code: 'CNI' }));
  t.mock.method(azureOneDriveConnector, 'upload', async () => 'ref-stockage-456');
  t.mock.method(pieceJustificativeRepository, 'enregistrerPieceJustificative', async () => 100);

  const resultat = await service.uploaderPieceJustificative(ENTITE_ACCECIT, {
    dossierId: 42,
    typePieceCode: 'CNI',
    nomFichier: 'cni.pdf',
    contenu: Buffer.from('contenu'),
    uploadedBy: 5,
  });

  assert.deepEqual(resultat, { pieceId: 100, referenceStockage: 'ref-stockage-456' });
});

// Couvre plusieurs statuts bien après en_attente_pieces (test planifié, ou même le test déjà
// passé et le dossier tranché) : dans tous les cas, une pièce encore jamais capturée reste
// ajoutable — ex. une pièce optionnelle complétée pour le second contrôle RH bien après le
// verdict du test, cas signalé sur un dossier réel (CLAUDE.md, besoin RH "télécharger/exporter
// les dossiers candidats", qui suppose de pouvoir encore les compléter).
for (const { statutCode, statutLibelle } of [
  { statutCode: 'test_planifie', statutLibelle: 'Test planifié' },
  { statutCode: 'test_non_realise', statutLibelle: 'Test non réalisé' },
  { statutCode: 'invalide', statutLibelle: 'Invalidé' },
  { statutCode: 'valide_envoi_formation', statutLibelle: 'Envoyé en formation' },
]) {
  test(`uploaderPieceJustificative autorise la capture d'une pièce encore jamais présente (statut "${statutCode}")`, async (t) => {
    mockerKnex(t);
    t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({
      id: 42,
      statut_code: statutCode,
      statut_libelle: statutLibelle,
      date_creation: DATE_CREATION_DOSSIER_TEST,
      candidat_nom: 'Martin',
      candidat_prenom: 'Sophie',
    }));
    t.mock.method(pieceJustificativeRepository, 'trouverTypePieceParCode', async () => ({ id: 9, code: 'ATTESTATION_MUTUELLE' }));
    t.mock.method(pieceJustificativeRepository, 'trouverPieceParDossierEtType', async () => undefined);
    t.mock.method(azureOneDriveConnector, 'upload', async () => 'ref-stockage-789');
    t.mock.method(pieceJustificativeRepository, 'enregistrerPieceJustificative', async () => 101);

    const resultat = await service.uploaderPieceJustificative(ENTITE_ACCECIT, {
      dossierId: 42,
      typePieceCode: 'ATTESTATION_MUTUELLE',
      nomFichier: 'attestation.pdf',
      contenu: Buffer.from('contenu'),
      uploadedBy: 5,
    });

    assert.deepEqual(resultat, { pieceId: 101, referenceStockage: 'ref-stockage-789' });
  });
}

test('uploaderPieceJustificative rejette le remplacement d\'une pièce déjà capturée une fois hors de en_attente_pieces', async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({
    id: 42,
    statut_code: 'invalide',
    statut_libelle: 'Invalidé',
    date_creation: DATE_CREATION_DOSSIER_TEST,
    candidat_nom: 'Martin',
    candidat_prenom: 'Sophie',
  }));
  t.mock.method(pieceJustificativeRepository, 'trouverTypePieceParCode', async () => ({ id: 7, code: 'CNI' }));
  t.mock.method(pieceJustificativeRepository, 'trouverPieceParDossierEtType', async () => ({ id: 55 }));
  const uploadMock = t.mock.method(azureOneDriveConnector, 'upload', async () => 'ref-stockage-ne-devrait-pas-servir');

  await assert.rejects(
    () => service.uploaderPieceJustificative(ENTITE_ACCECIT, {
      dossierId: 42,
      typePieceCode: 'CNI',
      nomFichier: 'cni.pdf',
      contenu: Buffer.from('x'),
      uploadedBy: 1,
    }),
    /Impossible de remplacer une pièce justificative déjà capturée.*n'est plus au statut "en attente de pièces"/,
  );
  assert.equal(uploadMock.mock.calls.length, 0);
});

test("uploaderPieceJustificative rejette toute pièce avant la signature de la charte (statut nouveau)", async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({
    id: 42,
    statut_code: 'nouveau',
    statut_libelle: 'Nouveau',
    date_creation: DATE_CREATION_DOSSIER_TEST,
    candidat_nom: 'Martin',
    candidat_prenom: 'Sophie',
  }));
  t.mock.method(pieceJustificativeRepository, 'trouverTypePieceParCode', async () => ({ id: 7, code: 'CNI' }));

  await assert.rejects(
    () => service.uploaderPieceJustificative(ENTITE_ACCECIT, {
      dossierId: 42,
      typePieceCode: 'CNI',
      nomFichier: 'cni.pdf',
      contenu: Buffer.from('x'),
      uploadedBy: 1,
    }),
    /Impossible d'ajouter une pièce justificative.*statut "Nouveau"/,
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
  // nom transmis au connecteur préfixé par le code du type de pièce ('CNI_cni.pdf', pas
  // 'cni.pdf' seul) : évite que deux types de pièces capturés depuis le même fichier source
  // n'atterrissent au même chemin OneDrive (voir le commentaire dans pieceJustificativeService.js).
  assert.deepEqual(uploadMock.mock.calls[0].arguments, [
    { id: 42, dateCreation: DATE_CREATION_DOSSIER_TEST, nomCandidat: 'Martin', prenomCandidat: 'Sophie' },
    { nom: 'CNI_cni.pdf', contenu: Buffer.from('contenu') },
  ]);
  assert.equal(enregistrerMock.mock.calls.length, 1);
  // nomFichier stocké en base reste le nom d'origine, SANS préfixe — c'est celui affiché à
  // l'agent et utilisé pour déduire le Content-Type de l'aperçu (voir pieces.routes.js,
  // deviserContentType) : seul le chemin de stockage change, jamais la donnée affichée.
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

test("listerPiecesJustificativesAvecContenu rejette si le dossier n'appartient pas à l'entité", async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'trouverDossierParId', async () => undefined);

  await assert.rejects(
    () => service.listerPiecesJustificativesAvecContenu(ENTITE_ACCECIT, 999),
    /Dossier "999" introuvable pour l'entité « accecit »/,
  );
});

test("listerPiecesJustificativesAvecContenu retourne un tableau vide si le dossier n'a aucune pièce", async (t) => {
  mockerKnex(t);
  t.mock.method(pieceJustificativeRepository, 'listerPiecesAvecReferenceParDossier', async () => []);

  const resultat = await service.listerPiecesJustificativesAvecContenu(ENTITE_ACCECIT, 42);
  assert.deepEqual(resultat, []);
});

// Une seule pièce par type dans l'export, la plus récente (voir diagnostic pièces dupliquées) :
// le mock reflète l'ordre réel du repository (date_upload desc), la pièce id 9 (plus ancienne,
// même type que id 10) ne doit donc jamais être téléchargée ni apparaître dans le résultat.
test('listerPiecesJustificativesAvecContenu récupère le contenu de chaque pièce, une seule par type (la plus récente)', async (t) => {
  mockerKnex(t);
  t.mock.method(pieceJustificativeRepository, 'listerPiecesAvecReferenceParDossier', async () => [
    { id: 10, nom_fichier: 'cni.pdf', reference_stockage: 'ref-cni-recente', type_piece_code: 'carte_identite' },
    { id: 9, nom_fichier: 'cni-ancienne.pdf', reference_stockage: 'ref-cni-ancienne', type_piece_code: 'carte_identite' },
    { id: 11, nom_fichier: 'vitale.pdf', reference_stockage: 'ref-vitale', type_piece_code: 'carte_vitale' },
  ]);
  const downloadMock = t.mock.method(azureOneDriveConnector, 'download', async (ref) => Buffer.from(`contenu-${ref}`));

  const resultat = await service.listerPiecesJustificativesAvecContenu(ENTITE_ACCECIT, 42);

  assert.deepEqual(resultat, [
    { nomFichier: 'cni.pdf', typePieceCode: 'carte_identite', contenu: Buffer.from('contenu-ref-cni-recente') },
    { nomFichier: 'vitale.pdf', typePieceCode: 'carte_vitale', contenu: Buffer.from('contenu-ref-vitale') },
  ]);
  assert.equal(downloadMock.mock.calls.length, 2);
  assert.deepEqual(downloadMock.mock.calls.map((appel) => appel.arguments[0]).sort(), ['ref-cni-recente', 'ref-vitale']);
});

test('supprimerPieceJustificative supprime chez le connecteur puis retire la ligne en base', async (t) => {
  mockerKnex(t);
  t.mock.method(pieceJustificativeRepository, 'trouverPieceJustificativeParId', async () => ({
    id: 99,
    dossier_id: 42,
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

test("supprimerPieceJustificative rejette si le dossier a déjà un test planifié", async (t) => {
  mockerKnex(t);
  t.mock.method(pieceJustificativeRepository, 'trouverPieceJustificativeParId', async () => ({
    id: 99,
    dossier_id: 42,
    reference_stockage: 'ref-stockage-123',
  }));
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({
    id: 42,
    statut_code: 'test_planifie',
    statut_libelle: 'Test planifié',
  }));
  const supprimerConnecteurMock = t.mock.method(azureOneDriveConnector, 'supprimer', async () => {});

  await assert.rejects(
    () => service.supprimerPieceJustificative(ENTITE_ACCECIT, 99),
    /Impossible de supprimer cette pièce justificative.*statut "Test planifié"/,
  );
  assert.equal(supprimerConnecteurMock.mock.calls.length, 0);
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
