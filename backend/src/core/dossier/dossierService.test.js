const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const dossierRepository = require('./dossierRepository');
const workflowRepository = require('../workflow/workflowRepository');
const dossierService = require('./dossierService');

// inscrireCandidat appelle `bd.transaction(...)` : `obtenirKnex` étant déstructuré dans
// dossierService.js (`const { obtenirKnex } = require(...)`), le mocker sur `db` ci-dessous
// (comme le fait déjà mockerBase pour les tests listerHistoriqueFormation, qui eux ne passent
// jamais par `.transaction()`) ne l'atteint pas : dossierService continue d'appeler la VRAIE
// implémentation, qui ouvre un pool de connexions Neon réel (dev, voir db/config.js). Sans
// fermeture explicite, ce pool garde le process node --test vivant indéfiniment après la fin des
// tests ("Promise resolution is still pending..."). `db.obtenirKnex()` ici récupère la même
// instance déjà mise en cache (promesseInstance, voir db/knex.js) — pas une nouvelle connexion.
test.after(async () => {
  const instance = await db.obtenirKnex();
  if (instance && typeof instance.destroy === 'function') {
    await instance.destroy();
  }
});

// Onglet "Formation" de la fiche dossier (audit 2026-08-28) — construireHistoriqueFormation n'est
// pas exportée (détail d'implémentation de listerHistoriqueFormation) : ces tests passent par la
// fonction publique, avec dossierRepository mockée, même patron que le reste des tests de service
// de ce projet (ex. utilisateurService.test.js).

const ENTITE = { id: 1, code: 'accecit' };

function mockerBase(t) {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(dossierRepository, 'trouverDossierParId', async () => ({ id: 42 }));
}

test("listerHistoriqueFormation renvoie une entrée 'en attente' (aucun résultat) quand valide_envoi_formation n'a encore aucune issue", async (t) => {
  mockerBase(t);
  t.mock.method(dossierRepository, 'listerHistoriqueFormation', async () => [
    {
      commentaire: 'Envoyé en formation cuisine.',
      date_changement: '2026-08-10T09:00:00.000Z',
      statut_code: 'valide_envoi_formation',
      statut_libelle: 'Validé - envoyé en formation',
      utilisateur_nom: 'Dupont',
      utilisateur_prenom: 'Marc',
      role_libelle: 'Formateur',
    },
  ]);

  const historique = await dossierService.listerHistoriqueFormation(ENTITE, 42);

  assert.equal(historique.length, 1);
  assert.deepEqual(historique[0], {
    dateEnvoi: '2026-08-10T09:00:00.000Z',
    commentaireEnvoi: 'Envoyé en formation cuisine.',
    envoyeParNom: 'Dupont',
    envoyeParPrenom: 'Marc',
    envoyeParRole: 'Formateur',
    dateResultat: null,
    resultatCode: null,
    resultatLibelle: null,
    commentaireResultat: null,
    decideParNom: null,
    decideParPrenom: null,
    decideParRole: null,
  });
});

test('listerHistoriqueFormation associe le résultat (Formation non validée) à son envoi, avec son propre commentaire/auteur', async (t) => {
  mockerBase(t);
  t.mock.method(dossierRepository, 'listerHistoriqueFormation', async () => [
    {
      commentaire: 'Envoyé en formation cuisine.',
      date_changement: '2026-08-10T09:00:00.000Z',
      statut_code: 'valide_envoi_formation',
      statut_libelle: 'Validé - envoyé en formation',
      utilisateur_nom: 'Dupont',
      utilisateur_prenom: 'Marc',
      role_libelle: 'Formateur',
    },
    {
      commentaire: 'Absences répétées, non validé par le centre de formation.',
      date_changement: '2026-08-20T14:00:00.000Z',
      statut_code: 'formation_non_validee',
      statut_libelle: 'Formation non validée',
      utilisateur_nom: 'Martin',
      utilisateur_prenom: 'Julie',
      role_libelle: 'Formateur',
    },
  ]);

  const historique = await dossierService.listerHistoriqueFormation(ENTITE, 42);

  assert.equal(historique.length, 1);
  assert.equal(historique[0].resultatCode, 'formation_non_validee');
  assert.equal(historique[0].resultatLibelle, 'Formation non validée');
  assert.equal(historique[0].dateResultat, '2026-08-20T14:00:00.000Z');
  assert.equal(historique[0].commentaireResultat, 'Absences répétées, non validé par le centre de formation.');
  assert.equal(historique[0].decideParNom, 'Martin');
  assert.equal(historique[0].decideParPrenom, 'Julie');
});

// Couvre le cas confirmé sur le workflow réel : replanifier_test repart de valide_envoi_formation
// vers test_planifie (voir workflow.config.json ACCECIT), donc un dossier peut être renvoyé en
// formation PLUSIEURS fois avant une décision définitive — chaque envoi doit rester une entrée
// distincte, avec son propre résultat s'il en a un, jamais mélangé avec les autres.
test('listerHistoriqueFormation distingue plusieurs envois en formation du même dossier, la plus récente entrée en premier', async (t) => {
  mockerBase(t);
  t.mock.method(dossierRepository, 'listerHistoriqueFormation', async () => [
    // 1er envoi, non validé, puis (implicitement) replanifié — pas représenté ici, seules les 3
    // lignes formation comptent pour ce module.
    {
      commentaire: 'Premier envoi.',
      date_changement: '2026-07-01T09:00:00.000Z',
      statut_code: 'valide_envoi_formation',
      statut_libelle: 'Validé - envoyé en formation',
      utilisateur_nom: 'Dupont',
      utilisateur_prenom: 'Marc',
      role_libelle: 'Formateur',
    },
    {
      commentaire: 'Non validé la première fois.',
      date_changement: '2026-07-10T09:00:00.000Z',
      statut_code: 'formation_non_validee',
      statut_libelle: 'Formation non validée',
      utilisateur_nom: 'Dupont',
      utilisateur_prenom: 'Marc',
      role_libelle: 'Formateur',
    },
    // 2e envoi, après replanification/nouveau test, validé cette fois.
    {
      commentaire: 'Second envoi après nouveau test.',
      date_changement: '2026-08-10T09:00:00.000Z',
      statut_code: 'valide_envoi_formation',
      statut_libelle: 'Validé - envoyé en formation',
      utilisateur_nom: 'Martin',
      utilisateur_prenom: 'Julie',
      role_libelle: 'Inspecteur',
    },
    {
      commentaire: 'Validé la seconde fois, très bon comportement.',
      date_changement: '2026-08-20T09:00:00.000Z',
      statut_code: 'valide_pret_embauche',
      statut_libelle: "Validé - prêt à l'embauche",
      utilisateur_nom: 'Martin',
      utilisateur_prenom: 'Julie',
      role_libelle: 'Inspecteur',
    },
  ]);

  const historique = await dossierService.listerHistoriqueFormation(ENTITE, 42);

  assert.equal(historique.length, 2);
  // Plus récent en premier.
  assert.equal(historique[0].commentaireEnvoi, 'Second envoi après nouveau test.');
  assert.equal(historique[0].resultatCode, 'valide_pret_embauche');
  assert.equal(historique[0].commentaireResultat, 'Validé la seconde fois, très bon comportement.');
  assert.equal(historique[1].commentaireEnvoi, 'Premier envoi.');
  assert.equal(historique[1].resultatCode, 'formation_non_validee');
  assert.equal(historique[1].commentaireResultat, 'Non validé la première fois.');
});

test("listerHistoriqueFormation renvoie un tableau vide (pas d'erreur) pour un dossier jamais envoyé en formation", async (t) => {
  mockerBase(t);
  t.mock.method(dossierRepository, 'listerHistoriqueFormation', async () => []);

  const historique = await dossierService.listerHistoriqueFormation(ENTITE, 42);

  assert.deepEqual(historique, []);
});

test("listerHistoriqueFormation rejette un dossier introuvable pour l'entité (garde IDOR)", async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(dossierRepository, 'trouverDossierParId', async () => undefined);
  const listerMock = t.mock.method(dossierRepository, 'listerHistoriqueFormation', async () => []);

  await assert.rejects(() => dossierService.listerHistoriqueFormation(ENTITE, 999), /introuvable/);
  assert.equal(listerMock.mock.calls.length, 0);
});

// inscrireCandidat — NIR facultatif, email TOUJOURS obligatoire (décision utilisateur,
// 2026-09-04, revenue sur une extension à tort appliquée à l'email dans un chantier précédent —
// voir donneesInscriptionSchema.email plus haut). Payload minimal valide pour
// donneesInscriptionSchema (typePoste 'bureau', pas d'expérience ni de diffusion, pour n'avoir à
// satisfaire aucun .refine() annexe qui ne concerne pas ce qui est testé ici) — `nir` absent par
// défaut (facultatif), `email` toujours valide par défaut (obligatoire), chaque test ne
// surchargeant que ce qui le concerne.
const TRX_MARQUEUR = { estUneTransaction: true };

function payloadInscriptionValide(surcharges = {}) {
  return {
    civilite: 'monsieur',
    nom: 'Dupont',
    lieuNaissance: 'Paris',
    nationalite: 'Française',
    prenom: 'Jean',
    dateNaissance: '1990-01-01',
    situationFamiliale: 'celibataire',
    adresse: '1 rue de la Paix',
    codePostal: '75001',
    ville: 'Paris',
    telephone: '0601020304',
    email: 'candidat@exemple.fr',
    contactUrgenceNom: 'Martin',
    contactUrgenceTelephone: '0601020305',
    disponibiliteImmediate: true,
    creneaux: ['6h-9h'],
    joursDisponibles: ['lundi'],
    typePoste: 'bureau',
    posteBureau: ['nettoyage'],
    experience: 'aucune',
    commentConnu: 'bouche_a_oreille',
    cas1CmuC: 'non',
    cas2Acs: 'non',
    cas3MutuelleIndividuelle: 'non',
    cas4MutuelleCollective: 'non',
    consentementDiffusion: 'refuse',
    charteMention: 'Lu et Approuvé',
    charteSignatureImage: 'data:image/png;base64,AAAA',
    ...surcharges,
  };
}

// Mocks communs à inscrireCandidat, au-delà de trouverCandidatParNirHash/trouverCandidatParEmail/
// insererCandidat (vérifiés explicitement par chaque test ci-dessous) : le reste de la transaction
// (création du dossier, écriture des blocs, signature de charte) n'est pas ce qui est sous test
// ici, donc réduit au minimum qui fait passer inscrireCandidat sans lever.
function mockerRestantInscription(t) {
  t.mock.method(db, 'obtenirKnex', async () => ({ transaction: async (fn) => fn(TRX_MARQUEUR) }));
  t.mock.method(dossierRepository, 'trouverStatutInitial', async () => ({ id: 1 }));
  t.mock.method(dossierRepository, 'creerDossier', async () => 42);
  t.mock.method(dossierRepository, 'enregistrerDonneesBloc', async () => {});
  t.mock.method(dossierRepository, 'trouverCharteActive', async () => ({ id: 7 }));
  t.mock.method(dossierRepository, 'enregistrerSignatureCharte', async () => {});
  t.mock.method(workflowRepository, 'trouverTransition', async () => null);
}

test('inscrireCandidat accepte un dossier sans NIR (facultatif), et enregistre nirChiffre/nirIv/nirHash à null', async (t) => {
  mockerRestantInscription(t);
  const nirHashMock = t.mock.method(dossierRepository, 'trouverCandidatParNirHash', async () => {
    throw new Error('ne doit pas être appelée : aucun NIR renseigné');
  });
  const emailMock = t.mock.method(dossierRepository, 'trouverCandidatParEmail', async () => undefined);
  const insererMock = t.mock.method(dossierRepository, 'insererCandidat', async () => 99);

  const resultat = await dossierService.inscrireCandidat(ENTITE, payloadInscriptionValide({ nir: '' }));

  assert.deepEqual(resultat, { candidatId: 99, dossierId: 42 });
  assert.equal(nirHashMock.mock.calls.length, 0);
  // L'email, lui, reste TOUJOURS vérifié (obligatoire) — contrairement au NIR.
  assert.equal(emailMock.mock.calls.length, 1);
  const donneesInserees = insererMock.mock.calls[0].arguments[1];
  assert.equal(donneesInserees.nirChiffre, null);
  assert.equal(donneesInserees.nirIv, null);
  assert.equal(donneesInserees.nirHash, null);
  assert.equal(donneesInserees.email, 'candidat@exemple.fr');
});

test('inscrireCandidat rejette une inscription sans email (obligatoire, non concerné par la facultativité du NIR)', async (t) => {
  mockerRestantInscription(t);
  t.mock.method(dossierRepository, 'insererCandidat', async () => {
    throw new Error('ne doit pas être appelée : email manquant, la validation doit échouer avant');
  });

  await assert.rejects(
    () => dossierService.inscrireCandidat(ENTITE, payloadInscriptionValide({ nir: '', email: '' })),
    (erreur) => erreur.name === 'ZodError',
  );
});

test("inscrireCandidat accepte la mention de charte recopiée sans accent ('lu et approuve')", async (t) => {
  mockerRestantInscription(t);
  t.mock.method(dossierRepository, 'trouverCandidatParEmail', async () => undefined);
  t.mock.method(dossierRepository, 'insererCandidat', async () => 100);

  const resultat = await dossierService.inscrireCandidat(
    ENTITE,
    payloadInscriptionValide({ nir: '', email: 'candidat@exemple.fr', charteMention: 'lu et approuve' }),
  );

  assert.deepEqual(resultat, { candidatId: 100, dossierId: 42 });
});

test('inscrireCandidat rejette une mention de charte qui ne correspond à aucune variante attendue', async (t) => {
  mockerRestantInscription(t);
  t.mock.method(dossierRepository, 'trouverCandidatParEmail', async () => undefined);
  t.mock.method(dossierRepository, 'insererCandidat', async () => {
    throw new Error('ne doit pas être appelée : validation de la mention attendue en échec');
  });

  await assert.rejects(
    () =>
      dossierService.inscrireCandidat(
        ENTITE,
        payloadInscriptionValide({ nir: '', email: 'candidat@exemple.fr', charteMention: 'pas d\'accord' }),
      ),
    (erreur) => erreur.name === 'ZodError',
  );
});
