const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');

const db = require('../../db/knex');
const journalAudit = require('../../core/audit/journalAudit');
const dossierService = require('../../core/dossier/dossierService');
const pieceJustificativeService = require('../../core/dossier/pieceJustificativeService');
const piecesRouter = require('./pieces.routes');

// Droits sur les pièces justificatives (2026-09-30, bug de production : export ZIP refusé à la RH).
// Aucune infrastructure de test HTTP dans ce projet : on lit la pile du routeur Express et on
// exécute la garde RÉELLEMENT montée sur chaque route (premier middleware), puis, pour l'export ZIP,
// le gestionnaire lui-même avec des dépendances simulées — jamais une copie des listes de rôles.
function couche(methode, chemin) {
  const trouvee = piecesRouter.stack.find((c) => c.route && c.route.path === chemin && c.route.methods[methode]);
  assert.ok(trouvee, `route ${methode.toUpperCase()} ${chemin} introuvable`);
  return trouvee.route.stack;
}

function executerGarde(methode, chemin, roleCode) {
  const res = { statut: null };
  res.status = (code) => {
    res.statut = code;
    return res;
  };
  res.json = () => res;
  let autorise = false;
  couche(methode, chemin)[0].handle({ utilisateur: { id: 1, roleCode } }, res, () => {
    autorise = true;
  });
  return { autorise, statut: res.statut };
}

const ROUTES_ECRITURE = {
  'ajout (POST /)': ['post', '/'],
  'modification (PATCH /:pieceId)': ['patch', '/:pieceId'],
  'suppression (DELETE /:pieceId)': ['delete', '/:pieceId'],
};
const ROUTES_CONSULTATION = {
  'liste (GET /)': ['get', '/'],
  'téléchargement d’une pièce (GET /:pieceId)': ['get', '/:pieceId'],
  'aperçu (GET /:pieceId/apercu)': ['get', '/:pieceId/apercu'],
};

test('Export ZIP (GET /export-zip) : RH désormais autorisée, avec Accueil/Coordination, Planning et Admin ; Formateur et Inspecteur toujours refusés', () => {
  for (const roleCode of ['rh', 'accueil_coordination', 'planning', 'admin']) {
    assert.equal(executerGarde('get', '/export-zip', roleCode).autorise, true, roleCode);
  }
  for (const roleCode of ['formateur', 'inspecteur']) {
    assert.equal(executerGarde('get', '/export-zip', roleCode).statut, 403, roleCode);
  }
});

test('RH peut télécharger chaque pièce individuellement (liste, téléchargement, aperçu), comme avant', () => {
  for (const [action, [methode, chemin]] of Object.entries(ROUTES_CONSULTATION)) {
    assert.equal(executerGarde(methode, chemin, 'rh').autorise, true, action);
  }
});

test("RH n'a AUCUN droit d'écriture sur les pièces : 403 sur l'ajout, la modification et la suppression", () => {
  for (const [action, [methode, chemin]] of Object.entries(ROUTES_ECRITURE)) {
    const { autorise, statut } = executerGarde(methode, chemin, 'rh');
    assert.equal(autorise, false, action);
    assert.equal(statut, 403, action);
  }
});

test('Droits des autres rôles inchangés : écriture pour Accueil/Coordination, Planning et Admin ; consultation seule pour Formateur et Inspecteur', () => {
  for (const [action, [methode, chemin]] of Object.entries(ROUTES_ECRITURE)) {
    for (const roleCode of ['accueil_coordination', 'planning', 'admin']) {
      assert.equal(executerGarde(methode, chemin, roleCode).autorise, true, `${action} ${roleCode}`);
    }
    for (const roleCode of ['formateur', 'inspecteur']) {
      assert.equal(executerGarde(methode, chemin, roleCode).statut, 403, `${action} ${roleCode}`);
    }
  }
  for (const [action, [methode, chemin]] of Object.entries(ROUTES_CONSULTATION)) {
    for (const roleCode of ['accueil_coordination', 'planning', 'admin', 'formateur', 'inspecteur']) {
      assert.equal(executerGarde(methode, chemin, roleCode).autorise, true, `${action} ${roleCode}`);
    }
  }
});

// --- Gestionnaire de l'export ZIP (après la garde) ---------------------------------------------

// Réponse Express factice, flux inscriptible (le ZIP y est « pipé » par archiver).
function creerReponse() {
  const res = new PassThrough();
  res.entetes = {};
  res.statut = 200;
  res.corpsJson = null;
  res.set = (nom, valeur) => {
    res.entetes[nom] = valeur;
    return res;
  };
  res.status = (code) => {
    res.statut = code;
    return res;
  };
  res.json = (corps) => {
    res.corpsJson = corps;
    res.end();
    return res;
  };
  const morceaux = [];
  res.on('data', (morceau) => morceaux.push(morceau));
  res.contenu = () => Buffer.concat(morceaux);
  return res;
}

const ENTITE_ACCECIT = { id: 1, code: 'accecit' };

async function appelerExport(t, { dossierDansEntite }) {
  t.mock.method(pieceJustificativeService, 'dossierAppartientEntite', async () => dossierDansEntite);
  const listerMock = t.mock.method(pieceJustificativeService, 'listerPiecesJustificativesAvecContenu', async () => ({
    fichiers: [{ typePieceCode: 'rib', nomFichier: 'rib.pdf', contenu: Buffer.from('contenu du RIB') }],
    manquantes: [],
  }));
  t.mock.method(dossierService, 'listerResumesParIds', async () => [{ candidat_nom: 'Martin', candidat_prenom: 'Léa' }]);
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  const auditMock = t.mock.method(journalAudit, 'enregistrerAction', async () => {});

  const gestionnaire = couche('get', '/export-zip')[1].handle;
  const res = creerReponse();
  const fin = new Promise((resolve) => res.on('finish', resolve));
  let erreurTransmise = null;
  await gestionnaire(
    { params: { dossierId: '42' }, entite: ENTITE_ACCECIT, utilisateur: { id: 9, roleCode: 'rh' }, ip: '127.0.0.1' },
    res,
    (erreur) => {
      erreurTransmise = erreur;
    },
  );
  await fin;
  return { res, listerMock, auditMock, erreurTransmise };
}

test("RH exporte le ZIP d'un dossier de son entité : archive ZIP produite, export tracé au nom de la RH", async (t) => {
  const { res, auditMock, erreurTransmise } = await appelerExport(t, { dossierDansEntite: true });

  assert.equal(erreurTransmise, null);
  assert.equal(res.statut, 200);
  assert.equal(res.entetes['Content-Type'], 'application/zip');
  assert.match(res.entetes['Content-Disposition'], /attachment; filename="Dossier 42 - Martin Léa\.zip"/);
  // Signature d'une archive ZIP (« PK\x03\x04 »).
  assert.deepEqual([...res.contenu().subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.equal(auditMock.mock.calls[0].arguments[1].utilisateurId, 9);
  assert.equal(auditMock.mock.calls[0].arguments[1].action, 'pieces_justificatives_export_zip');
});

test("Export ZIP d'un dossier d'une autre entité : 403 « Vous n'avez pas accès à cet export. », aucune pièce lue ni exportée", async (t) => {
  const { res, listerMock, auditMock } = await appelerExport(t, { dossierDansEntite: false });

  assert.equal(res.statut, 403);
  assert.deepEqual(res.corpsJson, { erreur: "Vous n'avez pas accès à cet export." });
  assert.equal(listerMock.mock.calls.length, 0);
  assert.equal(auditMock.mock.calls.length, 0);
});
