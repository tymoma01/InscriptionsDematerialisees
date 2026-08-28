const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const dossierRepository = require('./dossierRepository');
const dossierService = require('./dossierService');

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
