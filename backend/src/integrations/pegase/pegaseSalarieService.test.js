const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const dossierRepository = require('../../core/dossier/dossierRepository');
const demandeDpaeRepository = require('../../core/dpae/demandeDpaeRepository');
const pieceJustificativeService = require('../../core/dossier/pieceJustificativeService');
const nirCipher = require('../../core/securite/nirCipher');
const pegaseClient = require('./pegaseClient');
const pegaseSalarieRepository = require('./pegaseSalarieRepository');
const pegaseSalarieService = require('./pegaseSalarieService');

const ENTITE = {
  id: 1,
  code: 'accecit',
  pegase_actif: true,
  connecteur_stockage: 'azure_onedrive',
  pegase_config: {
    base_par_type_poste: { bureau: 'tertiaire', hotel: 'hotellerie' },
    bases: {
      hotellerie: { secret: 'pegase-token', agence: '1', code_type_document: 'DS1' },
      tertiaire: { secret: 'pegase-token-tertiaire', agence: '3', code_type_document: 'DOC' },
    },
  },
};

const DEMANDE = { id: 42, statut: 'validee', type_demande: 'nouvelle_embauche', salarie_deja_employe: false, candidat_id: 7, division: 'hotellerie', date_debut: '2026-11-03' };

const INSCRIPTION = {
  candidat: { civilite: 'madame', nom: 'Martin', prenom: 'Julie', dateNaissance: '1990-05-12', situationFamiliale: 'marie' },
  blocs: { coordonnees: { adresse: '1 rue', codePostal: '75002', ville: 'Paris', telephone: '0612345678', email: 'j@exemple.fr' } },
};

// Le suivi est simulé en mémoire : chaque enregistrement remplace le précédent, comme l'upsert réel.
function preparer(t, { demande = DEMANDE, typePoste = 'hotel', suiviInitial = null, salaries = [], pieces = { fichiers: [], manquantes: [] } } = {}) {
  let suivi = suiviInitial;
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(demandeDpaeRepository, 'trouverDemandeParId', async () => demande);
  t.mock.method(pegaseSalarieRepository, 'trouverSuivi', async () => suivi);
  const enregistrer = t.mock.method(pegaseSalarieRepository, 'enregistrerSuivi', async (bd, demandeId, ligne) => {
    suivi = {
      statut: ligne.statut,
      base: ligne.base ?? null,
      pegase_personnel_id: ligne.pegasePersonnelId ?? null,
      message: ligne.message ?? null,
      avertissements: ligne.avertissements ?? [],
      pieces_envoyees: ligne.piecesEnvoyees ?? [],
      pieces_en_erreur: ligne.piecesEnErreur ?? [],
    };
  });
  t.mock.method(pegaseSalarieRepository, 'trouverDernierDossierCandidat', async () => ({ id: 99, type_poste: typePoste }));
  t.mock.method(pegaseSalarieRepository, 'libellesTypesPieces', async () => new Map([['rib', 'RIB']]));
  t.mock.method(dossierRepository, 'trouverInscriptionCompleteParDossierId', async () => INSCRIPTION);
  t.mock.method(dossierRepository, 'trouverNirChiffreParDossierId', async () => ({ nirChiffre: Buffer.from('x'), nirIv: Buffer.from('y') }));
  t.mock.method(nirCipher, 'dechiffrer', async () => '290057512345678');
  const ouvrirSession = t.mock.method(pegaseClient, 'ouvrirSession', async () => ({ sessionId: 's' }));
  t.mock.method(pegaseClient, 'listerSalaries', async () => salaries);
  const creer = t.mock.method(pegaseClient, 'creerSalarie', async () => '5000');
  const ajouterDocument = t.mock.method(pegaseClient, 'ajouterDocument', async () => {});
  t.mock.method(pieceJustificativeService, 'listerPiecesJustificativesAvecContenu', async () => pieces);
  return { enregistrer, creer, ajouterDocument, ouvrirSession, suivi: () => suivi };
}

test('crée le salarié puis envoie ses pièces sous le type de document configuré', async (t) => {
  const { creer, ajouterDocument, suivi } = preparer(t, {
    pieces: { fichiers: [{ typePieceCode: 'rib', nomFichier: 'rib.pdf', contenu: Buffer.from('pdf') }], manquantes: [] },
  });

  await pegaseSalarieService.creerSalarieDepuisDemande(ENTITE, 42);

  assert.equal(creer.mock.calls.length, 1);
  assert.equal(creer.mock.calls[0].arguments[1].numeroSS, '2900575123456-78');
  assert.deepEqual(ajouterDocument.mock.calls[0].arguments[1], {
    personnelId: '5000',
    nomFichier: 'rib.pdf',
    contenu: Buffer.from('pdf'),
    libelle: 'RIB',
    codeTypeDocument: 'DS1',
  });
  assert.equal(suivi().statut, 'cree');
  assert.equal(suivi().pegase_personnel_id, '5000');
  assert.deepEqual(suivi().pieces_envoyees, ['rib']);
});

test('un salarié déjà dans Pégase (même NIR) n’est pas recréé', async (t) => {
  const { creer, ajouterDocument, suivi } = preparer(t, { salaries: [{ id: '12', nom: 'X', prenom: 'Y', numeroSS: '2900575123456-78' }] });

  await pegaseSalarieService.creerSalarieDepuisDemande(ENTITE, 42);

  assert.equal(creer.mock.calls.length, 0);
  assert.equal(ajouterDocument.mock.calls.length, 0);
  assert.equal(suivi().statut, 'doublon');
  assert.equal(suivi().pegase_personnel_id, '12');
});

test('ignore une entité sans Pégase', async (t) => {
  const { enregistrer, ouvrirSession } = preparer(t);
  await pegaseSalarieService.creerSalarieDepuisDemande({ ...ENTITE, pegase_actif: false }, 42);
  assert.equal(ouvrirSession.mock.calls.length, 0);
  assert.equal(enregistrer.mock.calls.length, 0);
});

const SALARIE_EXISTANT = { id: '4963', nom: 'MARTIN', prenom: 'Julie', dateNaissance: '1990-05-12', numeroSS: '2900575123456-78' };

test('un salarié déjà employé est retrouvé par son NIR, sans rien créer ni envoyer', async (t) => {
  const { creer, ajouterDocument, suivi } = preparer(t, { demande: { ...DEMANDE, salarie_deja_employe: true }, salaries: [SALARIE_EXISTANT] });

  await pegaseSalarieService.creerSalarieDepuisDemande(ENTITE, 42);

  assert.equal(creer.mock.calls.length, 0);
  assert.equal(ajouterDocument.mock.calls.length, 0);
  assert.equal(suivi().statut, 'retrouve');
  assert.equal(suivi().pegase_personnel_id, '4963');
  assert.equal(suivi().base, 'hotellerie');
  assert.match(suivi().message, /même n° de sécurité sociale/);
});

test("un avenant sans dossier candidat est retrouvé par nom et prénom, dans la base de l'Entité de la demande", async (t) => {
  const { ouvrirSession, suivi } = preparer(t, {
    demande: { ...DEMANDE, type_demande: 'prolongation', candidat_id: null, division: 'tertiaire', salarie_nom: 'martin', salarie_prenom: 'JULIE' },
    salaries: [SALARIE_EXISTANT, { id: '8', nom: 'MARTIN', prenom: 'Paul' }],
  });

  await pegaseSalarieService.creerSalarieDepuisDemande(ENTITE, 42);

  assert.equal(ouvrirSession.mock.calls[0].arguments[0].secret, 'pegase-token-tertiaire');
  assert.equal(suivi().statut, 'retrouve');
  assert.equal(suivi().pegase_personnel_id, '4963');
  assert.match(suivi().message, /mêmes nom et prénom/);
});

test("des homonymes ou un salarié introuvable sont signalés à la RH sans id retenu", async (t) => {
  const demande = { ...DEMANDE, salarie_deja_employe: true, candidat_id: null, salarie_nom: 'Martin', salarie_prenom: 'Julie' };
  for (const [salaries, attendu] of [
    [[SALARIE_EXISTANT, { ...SALARIE_EXISTANT, id: '5', dateNaissance: '1970-01-01' }], /2 salariés portent ces nom et prénom/],
    [[], /Aucun salarié à ce nom/],
  ]) {
    const { suivi } = preparer(t, { demande, salaries });
    await pegaseSalarieService.creerSalarieDepuisDemande(ENTITE, 42);
    assert.equal(suivi().statut, 'erreur');
    assert.equal(suivi().pegase_personnel_id, null);
    assert.match(suivi().message, attendu);
    t.mock.restoreAll();
  }
});

test("un salarié déjà employé sans dossier ni Entité arrête la recherche sans appel à Pégase", async (t) => {
  const { ouvrirSession, suivi } = preparer(t, { demande: { ...DEMANDE, salarie_deja_employe: true, candidat_id: null, division: null } });

  await pegaseSalarieService.creerSalarieDepuisDemande(ENTITE, 42);

  assert.equal(ouvrirSession.mock.calls.length, 0);
  assert.equal(suivi().statut, 'erreur');
  assert.match(suivi().message, /Entité de la demande/);
});

test('une erreur Pégase est enregistrée sans être propagée', async (t) => {
  const { creer, suivi } = preparer(t);
  creer.mock.mockImplementation(async () => {
    throw new pegaseClient.ErreurPegase('Pégase a refusé « personnel » (HTTP 422) : agence inconnue.');
  });

  await pegaseSalarieService.creerSalarieDepuisDemande(ENTITE, 42);

  assert.equal(suivi().statut, 'erreur');
  assert.match(suivi().message, /agence inconnue/);
});

test('une relance après création ne renvoie que les pièces manquantes, sans recréer le salarié', async (t) => {
  const { creer, ajouterDocument, suivi } = preparer(t, {
    suiviInitial: { statut: 'cree', pegase_personnel_id: '5000', avertissements: [], pieces_envoyees: ['rib'], pieces_en_erreur: [{ typePieceCode: 'carte_vitale' }] },
    pieces: {
      fichiers: [
        { typePieceCode: 'rib', nomFichier: 'rib.pdf', contenu: Buffer.from('a') },
        { typePieceCode: 'carte_vitale', nomFichier: 'vitale.jpg', contenu: Buffer.from('b') },
      ],
      manquantes: [],
    },
  });

  await pegaseSalarieService.creerSalarieDepuisDemande(ENTITE, 42);

  assert.equal(creer.mock.calls.length, 0);
  assert.equal(ajouterDocument.mock.calls.length, 1);
  assert.equal(ajouterDocument.mock.calls[0].arguments[1].nomFichier, 'vitale.jpg');
  assert.deepEqual(suivi().pieces_envoyees, ['rib', 'carte_vitale']);
  assert.deepEqual(suivi().pieces_en_erreur, []);
});

test('une demande sans dossier candidat est signalée à la RH', async (t) => {
  const { creer, suivi } = preparer(t, { demande: { ...DEMANDE, candidat_id: null } });

  await pegaseSalarieService.creerSalarieDepuisDemande(ENTITE, 42);

  assert.equal(creer.mock.calls.length, 0);
  assert.equal(suivi().statut, 'erreur');
  assert.match(suivi().message, /sans dossier candidat/);
});

test('un candidat Bureau part dans la base Tertiaire, avec son agence et son type de document', async (t) => {
  const { creer, ajouterDocument, ouvrirSession, suivi } = preparer(t, {
    demande: { ...DEMANDE, division: 'tertiaire' },
    typePoste: 'bureau',
    pieces: { fichiers: [{ typePieceCode: 'rib', nomFichier: 'rib.pdf', contenu: Buffer.from('pdf') }], manquantes: [] },
  });

  await pegaseSalarieService.creerSalarieDepuisDemande(ENTITE, 42);

  assert.equal(ouvrirSession.mock.calls[0].arguments[0].secret, 'pegase-token-tertiaire');
  assert.equal(creer.mock.calls[0].arguments[1].agence, '3');
  assert.equal(ajouterDocument.mock.calls[0].arguments[1].codeTypeDocument, 'DOC');
  assert.equal(suivi().base, 'tertiaire');
});

test('une Entité vide ou « autre » laisse le type de poste du dossier choisir la base', async (t) => {
  for (const [division, typePoste, base] of [[null, 'bureau', 'tertiaire'], ['autre', 'hotel', 'hotellerie']]) {
    await t.test(`${division} + ${typePoste}`, async (st) => {
      const { ouvrirSession, suivi } = preparer(st, { demande: { ...DEMANDE, division }, typePoste });

      await pegaseSalarieService.creerSalarieDepuisDemande(ENTITE, 42);

      assert.equal(ouvrirSession.mock.calls[0].arguments[0].secret, ENTITE.pegase_config.bases[base].secret);
      assert.equal(suivi().base, base);
    });
  }
});

test("une Entité qui contredit le type de poste du dossier arrête l'envoi sans appel à Pégase", async (t) => {
  const { ouvrirSession, creer, suivi } = preparer(t, { demande: { ...DEMANDE, division: 'tertiaire' }, typePoste: 'hotel' });

  await pegaseSalarieService.creerSalarieDepuisDemande(ENTITE, 42);

  assert.equal(ouvrirSession.mock.calls.length, 0);
  assert.equal(creer.mock.calls.length, 0);
  assert.equal(suivi().statut, 'erreur');
  assert.match(suivi().message, /entité de la demande \(Tertiaire\) ne correspond pas au type de poste recherché par le candidat \(Hôtel\)/);
});

test("un dossier sans type de poste recherché arrête l'envoi sans appel à Pégase", async (t) => {
  const { ouvrirSession, suivi } = preparer(t, { typePoste: null });

  await pegaseSalarieService.creerSalarieDepuisDemande(ENTITE, 42);

  assert.equal(ouvrirSession.mock.calls.length, 0);
  assert.equal(suivi().statut, 'erreur');
  assert.match(suivi().message, /Type de poste recherché/);
});

test('un salarié déjà créé reste dans sa base, même si le type de poste du dossier a changé', async (t) => {
  const { ouvrirSession, creer } = preparer(t, {
    typePoste: 'bureau',
    suiviInitial: { statut: 'cree', base: 'hotellerie', pegase_personnel_id: '5000', avertissements: [], pieces_envoyees: [], pieces_en_erreur: [] },
  });

  await pegaseSalarieService.creerSalarieDepuisDemande(ENTITE, 42);

  assert.equal(ouvrirSession.mock.calls[0].arguments[0].secret, 'pegase-token');
  assert.equal(creer.mock.calls.length, 0);
});

test('une base pas encore configurée est signalée sans appel à Pégase', async (t) => {
  const entite = { ...ENTITE, pegase_config: { ...ENTITE.pegase_config, bases: { ...ENTITE.pegase_config.bases, tertiaire: { secret: 'pegase-token-tertiaire', agence: null, code_type_document: null } } } };
  const { ouvrirSession, suivi } = preparer(t, { demande: { ...DEMANDE, division: 'tertiaire' }, typePoste: 'bureau' });

  await pegaseSalarieService.creerSalarieDepuisDemande(entite, 42);

  assert.equal(ouvrirSession.mock.calls.length, 0);
  assert.equal(suivi().statut, 'erreur');
  assert.match(suivi().message, /« tertiaire » pas encore configurée/);
});
