const { test } = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const dossierRepository = require('../dossier/dossierRepository');
const notesDossierRepository = require('../dossier/notesDossierRepository');
const rendezvousRepository = require('./rendezvousRepository');
const motifRepository = require('../motifs/motifRepository');
const utilisateurRepository = require('../auth/utilisateurRepository');
const lieuRepository = require('../lieux/lieuRepository');
const graphCalendarService = require('../../integrations/calendrier/graphCalendarService');
const rendezvousService = require('./rendezvousService');
const { ErreurRendezvousDossierClos, ErreurPlanificationOutlook } = rendezvousService;

// Le contrôle de date passée intervient avant tout accès DB (voir creerRendezvous) — testable
// sans mock, entité/dossier fictifs compris, puisque l'exécution ne les atteint jamais.
const ENTITE_FACTICE = { id: 1, code: 'accecit' };

// Créneau largement dans le futur, fixe (pas Date.now() + délai) : évite qu'un test devienne
// flaky si l'exécution ralentit autour de la limite "date passée" vérifiée en tout premier dans
// creerRendezvous.
const DATE_HEURE_FUTURE = '2099-01-01T10:00:00.000Z';

// bd factice avec un .transaction(fn) qui exécute simplement fn(bd) (pas de vraie isolation, un
// test unitaire n'en a pas besoin) — creerRendezvous ouvre désormais sa propre transaction quand
// aucune n'est fournie (voir rendezvousService.js, neutralisation de l'ancien rendez-vous actif +
// création du nouveau dans la même transaction).
function creerBdFactice() {
  const bd = {};
  bd.transaction = async (fn) => fn(bd);
  return bd;
}

// Par défaut, aucun rendez-vous actif à neutraliser (0 ligne affectée) — les tests dédiés à la
// neutralisation (plus bas) mockent cette fonction différemment pour vérifier son appel.
function mockerNeutralisationSansEffet(t) {
  return t.mock.method(rendezvousRepository, 'neutraliserRendezvousActifsDossier', async () => 0);
}

// Aucun rendez-vous actif préexistant (rien à nettoyer côté Outlook) et création Outlook toujours
// réussie par défaut — les tests dédiés à ce comportement (plus bas, section "Intégration Outlook")
// mockent ces deux fonctions différemment pour vérifier leurs appels/échecs spécifiques.
function mockerOutlookSansEffet(t) {
  t.mock.method(rendezvousRepository, 'trouverRendezvousTestActifDossier', async () => undefined);
  return t.mock.method(graphCalendarService, 'creerEvenement', async () => ({ id: 'outlook-evenement-test' }));
}

function mockerKnexPourCapacite(t, { nombreDejaPresents }) {
  t.mock.method(db, 'obtenirKnex', async () => creerBdFactice());
  // trouverDossierAvecStatutParId (pas trouverDossierParId) : creerRendezvous s'appuie désormais
  // dessus pour lire le bloc 'disponibilites' du dossier (garde-fou secteur/rôle, voir
  // rendezvousService.js) — donnees_disponibilites absent ici (dossier sans poste connu, secteur
  // indéterminé) ne bloque jamais l'assignation, cohérent avec un formateur générique en test.
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({ id: 42 }));
  t.mock.method(utilisateurRepository, 'trouverUtilisateurParId', async () => ({
    id: 8,
    role_code: 'formateur',
    email: 'formateur@accecit.test',
    prenom: 'Formateur',
    nom: 'Test',
  }));
  t.mock.method(rendezvousRepository, 'compterRendezvousFormateurAuCreneau', async () => nombreDejaPresents);
  mockerNeutralisationSansEffet(t);
  mockerOutlookSansEffet(t);
}

test('creerRendezvous rejette une date/heure strictement antérieure à maintenant', async () => {
  const hier = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await assert.rejects(
    () => rendezvousService.creerRendezvous(ENTITE_FACTICE, { dossierId: 1, typeRdv: 'test', dateHeure: hier, formateurId: null }),
    rendezvousService.ErreurDatePassee,
  );
});

test('creerRendezvous rejette une date/heure passée même de quelques secondes seulement', async () => {
  const ilYA10Secondes = new Date(Date.now() - 10 * 1000).toISOString();
  await assert.rejects(
    () =>
      rendezvousService.creerRendezvous(ENTITE_FACTICE, {
        dossierId: 1,
        typeRdv: 'test',
        dateHeure: ilYA10Secondes,
        formateurId: null,
      }),
    rendezvousService.ErreurDatePassee,
  );
});

test('creerRendezvous accepte un formateur qui a déjà 0 candidat sur ce créneau', async (t) => {
  mockerKnexPourCapacite(t, { nombreDejaPresents: 0 });
  const creerMock = t.mock.method(rendezvousRepository, 'creerRendezvous', async () => ({ id: 1 }));

  const resultat = await rendezvousService.creerRendezvous(ENTITE_FACTICE, {
    dossierId: 42,
    typeRdv: 'test',
    dateHeure: DATE_HEURE_FUTURE,
    formateurId: 8,
  });

  assert.deepEqual(resultat, { id: 1 });
  assert.equal(creerMock.mock.calls.length, 1);
});

// Le cœur de l'ajustement métier : un formateur peut désormais évaluer jusqu'à 2 candidats sur
// un même créneau, alors qu'un seul rendez-vous existant bloquait tout auparavant.
test('creerRendezvous accepte un formateur qui a déjà 1 candidat sur ce créneau (encore 1 place)', async (t) => {
  mockerKnexPourCapacite(t, { nombreDejaPresents: 1 });
  const creerMock = t.mock.method(rendezvousRepository, 'creerRendezvous', async () => ({ id: 2 }));

  const resultat = await rendezvousService.creerRendezvous(ENTITE_FACTICE, {
    dossierId: 42,
    typeRdv: 'test',
    dateHeure: DATE_HEURE_FUTURE,
    formateurId: 8,
  });

  assert.deepEqual(resultat, { id: 2 });
  assert.equal(creerMock.mock.calls.length, 1);
});

test('creerRendezvous rejette un formateur qui a déjà 2 candidats sur ce créneau (créneau complet)', async (t) => {
  mockerKnexPourCapacite(t, { nombreDejaPresents: 2 });
  const creerMock = t.mock.method(rendezvousRepository, 'creerRendezvous', async () => ({ id: 3 }));

  await assert.rejects(
    () =>
      rendezvousService.creerRendezvous(ENTITE_FACTICE, {
        dossierId: 42,
        typeRdv: 'test',
        dateHeure: DATE_HEURE_FUTURE,
        formateurId: 8,
      }),
    rendezvousService.ErreurCreneauPris,
  );
  assert.equal(creerMock.mock.calls.length, 0);
});

test('creerRendezvous accepte un lieu actif de l\'entité et transmet son id au repository', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => creerBdFactice());
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({ id: 42 }));
  const trouverLieuMock = t.mock.method(lieuRepository, 'trouverLieuParId', async () => ({
    id: 3,
    entite_id: ENTITE_FACTICE.id,
    code: 'hotel_du_cadran',
    actif: true,
  }));
  mockerNeutralisationSansEffet(t);
  const creerMock = t.mock.method(rendezvousRepository, 'creerRendezvous', async (bd, { lieuId }) => ({ id: 4, lieuId }));

  const resultat = await rendezvousService.creerRendezvous(ENTITE_FACTICE, {
    dossierId: 42,
    typeRdv: 'test',
    dateHeure: DATE_HEURE_FUTURE,
    formateurId: null,
    lieuId: 3,
  });

  assert.equal(trouverLieuMock.mock.calls.length, 1);
  assert.deepEqual(trouverLieuMock.mock.calls[0].arguments.slice(1), [ENTITE_FACTICE.id, 3]);
  assert.equal(resultat.lieuId, 3);
  assert.equal(creerMock.mock.calls.length, 1);
});

test('creerRendezvous rejette un lieu introuvable pour cette entité', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({ id: 42 }));
  t.mock.method(lieuRepository, 'trouverLieuParId', async () => undefined);
  const creerMock = t.mock.method(rendezvousRepository, 'creerRendezvous', async () => ({ id: 5 }));

  await assert.rejects(
    () =>
      rendezvousService.creerRendezvous(ENTITE_FACTICE, {
        dossierId: 42,
        typeRdv: 'test',
        dateHeure: DATE_HEURE_FUTURE,
        formateurId: null,
        lieuId: 999,
      }),
    rendezvousService.ErreurLieuInvalide,
  );
  assert.equal(creerMock.mock.calls.length, 0);
});

test('creerRendezvous rejette un lieu désactivé', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({ id: 42 }));
  t.mock.method(lieuRepository, 'trouverLieuParId', async () => ({ id: 3, actif: false }));
  const creerMock = t.mock.method(rendezvousRepository, 'creerRendezvous', async () => ({ id: 6 }));

  await assert.rejects(
    () =>
      rendezvousService.creerRendezvous(ENTITE_FACTICE, {
        dossierId: 42,
        typeRdv: 'test',
        dateHeure: DATE_HEURE_FUTURE,
        formateurId: null,
        lieuId: 3,
      }),
    rendezvousService.ErreurLieuInvalide,
  );
  assert.equal(creerMock.mock.calls.length, 0);
});

// Garde-fou secteur/rôle (audit 2026-08-25) : un formateur ne peut plus être assigné à un dossier
// bureau, ni un inspecteur à un dossier hôtel — transforme en vraie vérification serveur une
// contrainte jusque-là seulement procédurale (voir rendezvousService.js, ModalePlanificationTest.jsx).
test('creerRendezvous rejette un formateur assigné à un dossier bureau (secteur incompatible)', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => creerBdFactice());
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({
    id: 42,
    donnees_disponibilites: { posteBureau: ['nettoyage'], posteHotel: [] },
  }));
  t.mock.method(utilisateurRepository, 'trouverUtilisateurParId', async () => ({ id: 8, role_code: 'formateur' }));
  const creerMock = t.mock.method(rendezvousRepository, 'creerRendezvous', async () => ({ id: 200 }));

  await assert.rejects(
    () =>
      rendezvousService.creerRendezvous(ENTITE_FACTICE, {
        dossierId: 42,
        typeRdv: 'test',
        dateHeure: DATE_HEURE_FUTURE,
        formateurId: 8,
      }),
    rendezvousService.ErreurFormateurInvalide,
  );
  assert.equal(creerMock.mock.calls.length, 0);
});

test('creerRendezvous rejette un inspecteur assigné à un dossier hôtel (secteur incompatible)', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => creerBdFactice());
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({
    id: 42,
    donnees_disponibilites: { posteBureau: [], posteHotel: ['femme_valet_chambre'] },
  }));
  t.mock.method(utilisateurRepository, 'trouverUtilisateurParId', async () => ({ id: 9, role_code: 'inspecteur' }));
  const creerMock = t.mock.method(rendezvousRepository, 'creerRendezvous', async () => ({ id: 201 }));

  await assert.rejects(
    () =>
      rendezvousService.creerRendezvous(ENTITE_FACTICE, {
        dossierId: 42,
        typeRdv: 'test',
        dateHeure: DATE_HEURE_FUTURE,
        formateurId: 9,
      }),
    rendezvousService.ErreurFormateurInvalide,
  );
  assert.equal(creerMock.mock.calls.length, 0);
});

test('creerRendezvous accepte un inspecteur assigné à un dossier bureau (secteur compatible)', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => creerBdFactice());
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({
    id: 42,
    donnees_disponibilites: { posteBureau: ['nettoyage'], posteHotel: [] },
  }));
  t.mock.method(utilisateurRepository, 'trouverUtilisateurParId', async () => ({
    id: 9,
    role_code: 'inspecteur',
    email: 'inspecteur@accecit.test',
    prenom: 'Inspecteur',
    nom: 'Test',
  }));
  t.mock.method(rendezvousRepository, 'compterRendezvousFormateurAuCreneau', async () => 0);
  mockerNeutralisationSansEffet(t);
  mockerOutlookSansEffet(t);
  const creerMock = t.mock.method(rendezvousRepository, 'creerRendezvous', async () => ({ id: 202 }));

  const resultat = await rendezvousService.creerRendezvous(ENTITE_FACTICE, {
    dossierId: 42,
    typeRdv: 'test',
    dateHeure: DATE_HEURE_FUTURE,
    formateurId: 9,
  });

  assert.deepEqual(resultat, { id: 202 });
  assert.equal(creerMock.mock.calls.length, 1);
});

test("creerRendezvous accepte n'importe quel rôle sur un dossier sans secteur déterminé (aucun poste déclaré)", async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => creerBdFactice());
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({
    id: 42,
    donnees_disponibilites: null,
  }));
  t.mock.method(utilisateurRepository, 'trouverUtilisateurParId', async () => ({
    id: 8,
    role_code: 'formateur',
    email: 'formateur@accecit.test',
    prenom: 'Formateur',
    nom: 'Test',
  }));
  t.mock.method(rendezvousRepository, 'compterRendezvousFormateurAuCreneau', async () => 0);
  mockerNeutralisationSansEffet(t);
  mockerOutlookSansEffet(t);
  const creerMock = t.mock.method(rendezvousRepository, 'creerRendezvous', async () => ({ id: 203 }));

  const resultat = await rendezvousService.creerRendezvous(ENTITE_FACTICE, {
    dossierId: 42,
    typeRdv: 'test',
    dateHeure: DATE_HEURE_FUTURE,
    formateurId: 8,
  });

  assert.deepEqual(resultat, { id: 203 });
  assert.equal(creerMock.mock.calls.length, 1);
});

// Intégration Outlook (audit 2026-08-26, décision utilisateur) : Outlook devient la seule source
// de vérité pour la création d'un rendez-vous de test — creerEvenement doit réussir AVANT toute
// écriture Neon, un échec ne doit rien laisser en base, et un rendez-vous replanifié doit libérer
// l'ancien créneau Outlook (DELETE) sans jamais faire échouer la nouvelle planification déjà
// confirmée si cette suppression best-effort échoue elle-même.
test("creerRendezvous crée l'événement Outlook AVANT d'écrire en Neon et transmet outlookEventId au repository", async (t) => {
  const appels = [];
  t.mock.method(db, 'obtenirKnex', async () => creerBdFactice());
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({
    id: 42,
    candidat_prenom: 'Jean',
    candidat_nom: 'Dupont',
  }));
  t.mock.method(utilisateurRepository, 'trouverUtilisateurParId', async () => ({
    id: 8,
    role_code: 'formateur',
    email: 'formateur@accecit.test',
    prenom: 'Formateur',
    nom: 'Test',
  }));
  t.mock.method(rendezvousRepository, 'compterRendezvousFormateurAuCreneau', async () => 0);
  t.mock.method(rendezvousRepository, 'trouverRendezvousTestActifDossier', async () => undefined);
  mockerNeutralisationSansEffet(t);
  const creerEvenementMock = t.mock.method(graphCalendarService, 'creerEvenement', async (emailCalendrier) => {
    appels.push(`outlook:${emailCalendrier}`);
    return { id: 'outlook-evenement-999' };
  });
  const creerRendezvousMock = t.mock.method(rendezvousRepository, 'creerRendezvous', async (trx, donnees) => {
    appels.push('neon');
    return { id: 300, ...donnees };
  });

  const resultat = await rendezvousService.creerRendezvous(ENTITE_FACTICE, {
    dossierId: 42,
    typeRdv: 'test',
    dateHeure: DATE_HEURE_FUTURE,
    formateurId: 8,
  });

  assert.deepEqual(appels, ['outlook:formation@accecit.com', 'neon'], 'Outlook doit être appelé AVANT Neon');
  assert.equal(creerEvenementMock.mock.calls.length, 1);
  assert.equal(creerEvenementMock.mock.calls[0].arguments[1].participantEmail, 'formateur@accecit.test');
  assert.equal(creerRendezvousMock.mock.calls[0].arguments[1].outlookEventId, 'outlook-evenement-999');
  assert.equal(resultat.outlookEventId, 'outlook-evenement-999');
});

test('creerRendezvous route un inspecteur vers le calendrier tertiaire2@accecit.com (pas formation@)', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => creerBdFactice());
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({ id: 42 }));
  t.mock.method(utilisateurRepository, 'trouverUtilisateurParId', async () => ({
    id: 9,
    role_code: 'inspecteur',
    email: 'inspecteur@accecit.test',
    prenom: 'Inspecteur',
    nom: 'Test',
  }));
  t.mock.method(rendezvousRepository, 'compterRendezvousFormateurAuCreneau', async () => 0);
  t.mock.method(rendezvousRepository, 'trouverRendezvousTestActifDossier', async () => undefined);
  mockerNeutralisationSansEffet(t);
  const creerEvenementMock = t.mock.method(graphCalendarService, 'creerEvenement', async () => ({ id: 'outlook-evenement-inspecteur' }));
  t.mock.method(rendezvousRepository, 'creerRendezvous', async () => ({ id: 301 }));

  await rendezvousService.creerRendezvous(ENTITE_FACTICE, {
    dossierId: 42,
    typeRdv: 'test',
    dateHeure: DATE_HEURE_FUTURE,
    formateurId: 9,
  });

  assert.equal(creerEvenementMock.mock.calls[0].arguments[0], 'tertiaire2@accecit.com');
});

test("creerRendezvous ne crée RIEN en Neon si la création de l'événement Outlook échoue", async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => creerBdFactice());
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({ id: 42 }));
  t.mock.method(utilisateurRepository, 'trouverUtilisateurParId', async () => ({
    id: 8,
    role_code: 'formateur',
    email: 'formateur@accecit.test',
    prenom: 'Formateur',
    nom: 'Test',
  }));
  t.mock.method(rendezvousRepository, 'compterRendezvousFormateurAuCreneau', async () => 0);
  t.mock.method(rendezvousRepository, 'trouverRendezvousTestActifDossier', async () => undefined);
  const neutraliserMock = t.mock.method(rendezvousRepository, 'neutraliserRendezvousActifsDossier', async () => 0);
  t.mock.method(graphCalendarService, 'creerEvenement', async () => {
    throw Object.assign(new Error('Permissions Microsoft Graph insuffisantes (test).'), { statusCode: 403 });
  });
  const creerRendezvousMock = t.mock.method(rendezvousRepository, 'creerRendezvous', async () => ({ id: 400 }));

  await assert.rejects(
    () =>
      rendezvousService.creerRendezvous(ENTITE_FACTICE, {
        dossierId: 42,
        typeRdv: 'test',
        dateHeure: DATE_HEURE_FUTURE,
        formateurId: 8,
      }),
    ErreurPlanificationOutlook,
  );
  assert.equal(creerRendezvousMock.mock.calls.length, 0, 'rien ne doit être écrit en Neon');
  assert.equal(neutraliserMock.mock.calls.length, 0, 'la neutralisation ne doit pas non plus avoir lieu');
});

test('creerRendezvous ne tente aucun appel Outlook quand aucun formateur/inspecteur n\'est assigné', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => creerBdFactice());
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({ id: 42 }));
  mockerNeutralisationSansEffet(t);
  const creerEvenementMock = t.mock.method(graphCalendarService, 'creerEvenement', async () => {
    throw new Error('ne devrait jamais être appelé');
  });
  const trouverActifMock = t.mock.method(rendezvousRepository, 'trouverRendezvousTestActifDossier', async () => {
    throw new Error('ne devrait jamais être appelé');
  });
  t.mock.method(rendezvousRepository, 'creerRendezvous', async () => ({ id: 401 }));

  await rendezvousService.creerRendezvous(ENTITE_FACTICE, {
    dossierId: 42,
    typeRdv: 'test',
    dateHeure: DATE_HEURE_FUTURE,
    formateurId: null,
  });

  assert.equal(creerEvenementMock.mock.calls.length, 0);
  assert.equal(trouverActifMock.mock.calls.length, 0);
});

test("creerRendezvous supprime l'ancien événement Outlook lors d'une replanification (libère le créneau)", async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => creerBdFactice());
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({ id: 42 }));
  // Deux formateurs distincts : celui déjà assigné à l'ancien rendez-vous actif (id 99) et le
  // nouveau qu'on assigne ici (id 8) — trouverUtilisateurParId est appelé deux fois avec des id
  // différents, la mock doit distinguer les deux réponses.
  t.mock.method(utilisateurRepository, 'trouverUtilisateurParId', async (bd, entiteId, id) =>
    id === 99
      ? { id: 99, role_code: 'formateur', email: 'ancien-formateur@accecit.test', prenom: 'Ancien', nom: 'Formateur' }
      : { id: 8, role_code: 'formateur', email: 'formateur@accecit.test', prenom: 'Formateur', nom: 'Test' },
  );
  t.mock.method(rendezvousRepository, 'compterRendezvousFormateurAuCreneau', async () => 0);
  t.mock.method(rendezvousRepository, 'trouverRendezvousTestActifDossier', async () => ({
    id: 199,
    formateur_id: 99,
    outlook_event_id: 'outlook-ancien-evenement',
  }));
  mockerNeutralisationSansEffet(t);
  t.mock.method(graphCalendarService, 'creerEvenement', async () => ({ id: 'outlook-nouvel-evenement' }));
  const supprimerMock = t.mock.method(graphCalendarService, 'supprimerEvenement', async () => {});
  t.mock.method(rendezvousRepository, 'creerRendezvous', async () => ({ id: 402 }));

  await rendezvousService.creerRendezvous(ENTITE_FACTICE, {
    dossierId: 42,
    typeRdv: 'test',
    dateHeure: DATE_HEURE_FUTURE,
    formateurId: 8,
  });

  assert.equal(supprimerMock.mock.calls.length, 1);
  assert.deepEqual(supprimerMock.mock.calls[0].arguments, ['formation@accecit.com', 'outlook-ancien-evenement']);
});

test("creerRendezvous réussit malgré tout si la suppression de l'ancien événement Outlook échoue (best-effort, non bloquant)", async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => creerBdFactice());
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({ id: 42 }));
  t.mock.method(utilisateurRepository, 'trouverUtilisateurParId', async (bd, entiteId, id) =>
    id === 99
      ? { id: 99, role_code: 'formateur', email: 'ancien-formateur@accecit.test', prenom: 'Ancien', nom: 'Formateur' }
      : { id: 8, role_code: 'formateur', email: 'formateur@accecit.test', prenom: 'Formateur', nom: 'Test' },
  );
  t.mock.method(rendezvousRepository, 'compterRendezvousFormateurAuCreneau', async () => 0);
  t.mock.method(rendezvousRepository, 'trouverRendezvousTestActifDossier', async () => ({
    id: 199,
    formateur_id: 99,
    outlook_event_id: 'outlook-ancien-evenement',
  }));
  mockerNeutralisationSansEffet(t);
  t.mock.method(graphCalendarService, 'creerEvenement', async () => ({ id: 'outlook-nouvel-evenement' }));
  t.mock.method(graphCalendarService, 'supprimerEvenement', async () => {
    throw new Error('Échec de suppression simulé.');
  });
  const creerRendezvousMock = t.mock.method(rendezvousRepository, 'creerRendezvous', async () => ({ id: 403 }));

  const resultat = await rendezvousService.creerRendezvous(ENTITE_FACTICE, {
    dossierId: 42,
    typeRdv: 'test',
    dateHeure: DATE_HEURE_FUTURE,
    formateurId: 8,
  });

  assert.deepEqual(resultat, { id: 403 });
  assert.equal(creerRendezvousMock.mock.calls.length, 1);
});

test("creerRendezvous ne tente aucune suppression Outlook si l'ancien rendez-vous actif n'a pas d'outlook_event_id (créé avant ce chantier)", async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => creerBdFactice());
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({ id: 42 }));
  t.mock.method(utilisateurRepository, 'trouverUtilisateurParId', async () => ({
    id: 8,
    role_code: 'formateur',
    email: 'formateur@accecit.test',
    prenom: 'Formateur',
    nom: 'Test',
  }));
  t.mock.method(rendezvousRepository, 'compterRendezvousFormateurAuCreneau', async () => 0);
  t.mock.method(rendezvousRepository, 'trouverRendezvousTestActifDossier', async () => ({
    id: 199,
    formateur_id: 77,
    outlook_event_id: null,
  }));
  mockerNeutralisationSansEffet(t);
  t.mock.method(graphCalendarService, 'creerEvenement', async () => ({ id: 'outlook-nouvel-evenement' }));
  const supprimerMock = t.mock.method(graphCalendarService, 'supprimerEvenement', async () => {});
  t.mock.method(rendezvousRepository, 'creerRendezvous', async () => ({ id: 404 }));

  await rendezvousService.creerRendezvous(ENTITE_FACTICE, {
    dossierId: 42,
    typeRdv: 'test',
    dateHeure: DATE_HEURE_FUTURE,
    formateurId: 8,
  });

  assert.equal(supprimerMock.mock.calls.length, 0);
});

test('obtenirDisponibilitesFormateur résout le calendrier départemental et l\'email individuel depuis formateurId, sans jamais exposer cet email au retour', async (t) => {
  t.mock.method(utilisateurRepository, 'trouverUtilisateurParId', async () => ({
    id: 8,
    role_code: 'inspecteur',
    email: 'inspecteur@accecit.test',
  }));
  const obtenirDisponibilitesMock = t.mock.method(graphCalendarService, 'obtenirDisponibilites', async () => [
    { debut: '2026-09-01T08:00:00.000Z', fin: '2026-09-01T09:00:00.000Z' },
  ]);

  const resultat = await rendezvousService.obtenirDisponibilitesFormateur(ENTITE_FACTICE, {
    formateurId: 8,
    debut: '2026-09-01T00:00:00.000Z',
    fin: '2026-09-08T00:00:00.000Z',
  });

  assert.deepEqual(obtenirDisponibilitesMock.mock.calls[0].arguments, [
    'tertiaire2@accecit.com',
    'inspecteur@accecit.test',
    '2026-09-01T00:00:00.000Z',
    '2026-09-08T00:00:00.000Z',
  ]);
  assert.deepEqual(resultat, [{ debut: '2026-09-01T08:00:00.000Z', fin: '2026-09-01T09:00:00.000Z' }]);
  assert.equal(JSON.stringify(resultat).includes('inspecteur@accecit.test'), false, "l'email individuel ne doit jamais apparaître dans la réponse renvoyée au front");
});

test("obtenirDisponibilitesFormateur rejette si formateurId ne correspond à aucun formateur/inspecteur de l'entité", async (t) => {
  t.mock.method(utilisateurRepository, 'trouverUtilisateurParId', async () => undefined);

  await assert.rejects(
    () => rendezvousService.obtenirDisponibilitesFormateur(ENTITE_FACTICE, {
      formateurId: 999,
      debut: '2026-09-01T00:00:00.000Z',
      fin: '2026-09-08T00:00:00.000Z',
    }),
    rendezvousService.ErreurFormateurInvalide,
  );
});

// Neutralisation de l'ancien rendez-vous actif (voir rendezvousService.js, STATUT_REMPLACE) —
// corrige la cause racine des doublons observés en base (audit du 2026-08-13, dossier #88,
// rendez-vous 61-65) : jusqu'ici rien ne referme l'ancien rendez-vous lors d'une replanification,
// les deux restaient 'prevu' en parallèle. Ne bloque JAMAIS la création (règle métier validée avec
// Florence) — ces tests vérifient uniquement que l'ancien est neutralisé, jamais qu'il empêche
// quoi que ce soit.
test("creerRendezvous neutralise (STATUT_REMPLACE) l'ancien rendez-vous actif du même dossier+type avant de créer le nouveau, dans la même transaction", async (t) => {
  const bd = creerBdFactice();
  t.mock.method(db, 'obtenirKnex', async () => bd);
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({ id: 42 }));
  const appels = [];
  const neutraliserMock = t.mock.method(rendezvousRepository, 'neutraliserRendezvousActifsDossier', async (trxRecu, args) => {
    appels.push('neutraliser');
    assert.equal(trxRecu, bd, 'doit recevoir la transaction ouverte par creerRendezvous, pas le bd brut');
    assert.deepEqual(args, { dossierId: 42, typeRdv: 'test', statutRemplace: rendezvousService.STATUT_REMPLACE });
    return 1;
  });
  const creerMock = t.mock.method(rendezvousRepository, 'creerRendezvous', async (trxRecu) => {
    appels.push('creer');
    assert.equal(trxRecu, bd, 'doit recevoir la même transaction que neutraliserRendezvousActifsDossier');
    return { id: 99 };
  });

  const resultat = await rendezvousService.creerRendezvous(ENTITE_FACTICE, {
    dossierId: 42,
    typeRdv: 'test',
    dateHeure: DATE_HEURE_FUTURE,
    formateurId: null,
  });

  assert.deepEqual(resultat, { id: 99 });
  assert.equal(neutraliserMock.mock.calls.length, 1);
  assert.equal(creerMock.mock.calls.length, 1);
  // Neutraliser AVANT de créer — jamais l'inverse (le nouveau ne doit pas se neutraliser lui-même).
  assert.deepEqual(appels, ['neutraliser', 'creer']);
});

test("creerRendezvous réussit sans erreur même quand un rendez-vous actif existe déjà (jamais bloquant, règle métier validée avec Florence)", async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => creerBdFactice());
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({ id: 42 }));
  t.mock.method(rendezvousRepository, 'neutraliserRendezvousActifsDossier', async () => 1);
  const creerMock = t.mock.method(rendezvousRepository, 'creerRendezvous', async () => ({ id: 100 }));

  const resultat = await rendezvousService.creerRendezvous(ENTITE_FACTICE, {
    dossierId: 42,
    typeRdv: 'test',
    dateHeure: DATE_HEURE_FUTURE,
    formateurId: null,
  });

  assert.deepEqual(resultat, { id: 100 });
  assert.equal(creerMock.mock.calls.length, 1);
});

test("creerRendezvous réutilise la transaction déjà ouverte par l'appelant (bdExistante) au lieu d'en ouvrir une seconde", async (t) => {
  // trx factice SANS méthode .transaction() : si creerRendezvous tentait d'en ouvrir une seconde
  // imbriquée par erreur, l'appel échouerait immédiatement ("trxExistante.transaction is not a
  // function") — l'absence d'erreur prouve qu'elle n'a jamais été invoquée.
  const trxExistante = {};
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({ id: 42 }));
  const neutraliserMock = t.mock.method(rendezvousRepository, 'neutraliserRendezvousActifsDossier', async (trxRecu) => {
    assert.equal(trxRecu, trxExistante);
    return 1;
  });
  const creerMock = t.mock.method(rendezvousRepository, 'creerRendezvous', async (trxRecu) => {
    assert.equal(trxRecu, trxExistante);
    return { id: 101 };
  });

  const resultat = await rendezvousService.creerRendezvous(
    ENTITE_FACTICE,
    { dossierId: 42, typeRdv: 'test', dateHeure: DATE_HEURE_FUTURE, formateurId: null },
    trxExistante,
  );

  assert.deepEqual(resultat, { id: 101 });
  assert.equal(neutraliserMock.mock.calls.length, 1);
  assert.equal(creerMock.mock.calls.length, 1);
});

// Workflow v4 : replanifier reste possible à tout moment tant que le dossier est test_planifie,
// SAUF dans les 30 minutes précédant le rendez-vous actuel (voir rendezvousService.js, en-tête).
const TRX_FACTICE = { estUnTrx: true };

test("verifierDelaiAvantReplanification ne fait rien si la liste de transitions ne contient pas replanifier_test", async (t) => {
  const trouverDossierMock = t.mock.method(dossierRepository, 'trouverDossierParId', async () => {
    throw new Error('ne devrait jamais être appelé');
  });

  await rendezvousService.verifierDelaiAvantReplanification(
    ENTITE_FACTICE,
    42,
    [{ codeAction: 'planifier_test', commentaire: 'Test planifié.' }],
    TRX_FACTICE,
  );

  assert.equal(trouverDossierMock.mock.calls.length, 0);
});

test("verifierDelaiAvantReplanification ne fait rien si le dossier n'est plus test_planifie (replanification depuis test_non_realise/invalide)", async (t) => {
  t.mock.method(dossierRepository, 'trouverDossierParId', async () => ({ id: 42, statut_code: 'test_non_realise' }));
  const trouverActifMock = t.mock.method(rendezvousRepository, 'trouverRendezvousTestActifDossier', async () => {
    throw new Error('ne devrait jamais être appelé');
  });

  await rendezvousService.verifierDelaiAvantReplanification(
    ENTITE_FACTICE,
    42,
    [{ codeAction: 'replanifier_test', commentaire: 'Replanifié.' }],
    TRX_FACTICE,
  );

  assert.equal(trouverActifMock.mock.calls.length, 0);
});

test('verifierDelaiAvantReplanification ne fait rien si le dossier est test_planifie mais sans rendez-vous actif', async (t) => {
  t.mock.method(dossierRepository, 'trouverDossierParId', async () => ({ id: 42, statut_code: 'test_planifie' }));
  t.mock.method(rendezvousRepository, 'trouverRendezvousTestActifDossier', async () => undefined);

  await rendezvousService.verifierDelaiAvantReplanification(
    ENTITE_FACTICE,
    42,
    [{ codeAction: 'replanifier_test', commentaire: 'Replanifié.' }],
    TRX_FACTICE,
  );
  // Ne lève pas — rien à protéger.
});

test('verifierDelaiAvantReplanification autorise la replanification si le rendez-vous actuel est encore à plus de 30 minutes', async (t) => {
  t.mock.method(dossierRepository, 'trouverDossierParId', async () => ({ id: 42, statut_code: 'test_planifie' }));
  const dansUneHeure = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  t.mock.method(rendezvousRepository, 'trouverRendezvousTestActifDossier', async () => ({ date_heure: dansUneHeure }));

  await rendezvousService.verifierDelaiAvantReplanification(
    ENTITE_FACTICE,
    42,
    [{ codeAction: 'replanifier_test', commentaire: 'Replanifié.' }],
    TRX_FACTICE,
  );
});

test('verifierDelaiAvantReplanification rejette si le rendez-vous actuel est dans moins de 30 minutes', async (t) => {
  t.mock.method(dossierRepository, 'trouverDossierParId', async () => ({ id: 42, statut_code: 'test_planifie' }));
  const dansQuinzeMinutes = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  t.mock.method(rendezvousRepository, 'trouverRendezvousTestActifDossier', async () => ({ date_heure: dansQuinzeMinutes }));

  await assert.rejects(
    () =>
      rendezvousService.verifierDelaiAvantReplanification(
        ENTITE_FACTICE,
        42,
        [{ codeAction: 'replanifier_test', commentaire: 'Replanifié.' }],
        TRX_FACTICE,
      ),
    rendezvousService.ErreurReplanificationTropTardive,
  );
});

test('verifierDelaiAvantReplanification rejette si le rendez-vous actuel est déjà passé', async (t) => {
  t.mock.method(dossierRepository, 'trouverDossierParId', async () => ({ id: 42, statut_code: 'test_planifie' }));
  const ilYADixMinutes = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  t.mock.method(rendezvousRepository, 'trouverRendezvousTestActifDossier', async () => ({ date_heure: ilYADixMinutes }));

  await assert.rejects(
    () =>
      rendezvousService.verifierDelaiAvantReplanification(
        ENTITE_FACTICE,
        42,
        [{ codeAction: 'replanifier_test', commentaire: 'Replanifié.' }],
        TRX_FACTICE,
      ),
    rendezvousService.ErreurReplanificationTropTardive,
  );
});

// listerHistoriqueRendezvousDossiers / catégorisation (page Planification, bouton "Voir
// l'historique des rendez-vous sélectionnés") — voir rendezvousService.js pour le raisonnement
// complet (rendezvous.statut ne porte aucune valeur "honoré", déduite de l'existence d'une
// évaluation liée ; "Replanifié" déduit de la position dans l'historique du dossier, pas d'une
// colonne dédiée). Renvoie désormais { rendezvous, notes } (décision utilisateur du 2026-08-13,
// ajout des notes/motif/commentaire d'évaluation au panneau) : notes_dossier n'a pas de colonne
// rendezvous_id, ces notes sont donc renvoyées à part, jamais rattachées à une ligne `rendezvous`
// précise (voir notesDossierRepository.listerNotesParDossiers).
const DATE_FUTURE = '2099-06-15T09:00:00.000Z';
const DATE_PASSEE = '2020-01-01T09:00:00.000Z';

// Mock par défaut : aucune note (voir tests dédiés plus bas pour le cas avec notes) — la plupart
// des tests de catégorisation ci-dessous ne portent pas sur les notes, ce mock leur évite de
// planter sur l'appel Promise.all à notesDossierRepository.listerNotesParDossiers.
function mockerNotesVides(t) {
  t.mock.method(notesDossierRepository, 'listerNotesParDossiers', async () => []);
}

test("listerHistoriqueRendezvousDossiers renvoie { rendezvous: [], notes: [] } sans appeler les repositories si dossierIds est vide", async (t) => {
  const repoRendezvousMock = t.mock.method(rendezvousRepository, 'listerHistoriqueRendezvousParDossiers', async () => {
    throw new Error('ne doit pas être appelé');
  });
  const repoNotesMock = t.mock.method(notesDossierRepository, 'listerNotesParDossiers', async () => {
    throw new Error('ne doit pas être appelé');
  });

  const resultat = await rendezvousService.listerHistoriqueRendezvousDossiers(ENTITE_FACTICE, []);

  assert.deepEqual(resultat, { rendezvous: [], notes: [] });
  assert.equal(repoRendezvousMock.mock.calls.length, 0);
  assert.equal(repoNotesMock.mock.calls.length, 0);
});

test('listerHistoriqueRendezvousDossiers catégorise Honoré dès qu\'une évaluation existe, même si le statut brut reste "prevu"', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  mockerNotesVides(t);
  t.mock.method(rendezvousRepository, 'listerHistoriqueRendezvousParDossiers', async () => [
    { id: 1, dossier_id: 88, date_heure: DATE_PASSEE, statut: 'prevu', evaluation_id: 501, evaluation_resultat: 'valide' },
  ]);

  const resultat = await rendezvousService.listerHistoriqueRendezvousDossiers(ENTITE_FACTICE, [88]);

  assert.equal(resultat.rendezvous[0].statutCategorise, rendezvousService.CATEGORIES_STATUT_HISTORIQUE.HONORE);
});

test("listerHistoriqueRendezvousDossiers catégorise Manqué/Annulé directement depuis rendezvous.statut", async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  mockerNotesVides(t);
  t.mock.method(rendezvousRepository, 'listerHistoriqueRendezvousParDossiers', async () => [
    { id: 1, dossier_id: 74, date_heure: DATE_PASSEE, statut: 'absent', evaluation_id: null },
    { id: 2, dossier_id: 74, date_heure: DATE_PASSEE, statut: 'annule', evaluation_id: null },
  ]);

  const resultat = await rendezvousService.listerHistoriqueRendezvousDossiers(ENTITE_FACTICE, [74]);

  assert.equal(resultat.rendezvous[0].statutCategorise, rendezvousService.CATEGORIES_STATUT_HISTORIQUE.MANQUE);
  assert.equal(resultat.rendezvous[1].statutCategorise, rendezvousService.CATEGORIES_STATUT_HISTORIQUE.ANNULE);
});

test('listerHistoriqueRendezvousDossiers catégorise À venir un rendez-vous "prevu" encore actif dont la date est future', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  mockerNotesVides(t);
  t.mock.method(rendezvousRepository, 'listerHistoriqueRendezvousParDossiers', async () => [
    { id: 1, dossier_id: 1, date_heure: DATE_FUTURE, statut: 'prevu', evaluation_id: null },
  ]);

  const resultat = await rendezvousService.listerHistoriqueRendezvousDossiers(ENTITE_FACTICE, [1]);

  assert.equal(resultat.rendezvous[0].statutCategorise, rendezvousService.CATEGORIES_STATUT_HISTORIQUE.A_VENIR);
});

test('listerHistoriqueRendezvousDossiers catégorise À traiter un rendez-vous "confirme" toujours actif dont la date est déjà passée, sans évaluation ni statut absent/annule', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  mockerNotesVides(t);
  t.mock.method(rendezvousRepository, 'listerHistoriqueRendezvousParDossiers', async () => [
    { id: 2, dossier_id: 2, date_heure: DATE_PASSEE, statut: 'confirme', evaluation_id: null },
  ]);

  const resultat = await rendezvousService.listerHistoriqueRendezvousDossiers(ENTITE_FACTICE, [2]);

  assert.equal(resultat.rendezvous[0].statutCategorise, rendezvousService.CATEGORIES_STATUT_HISTORIQUE.A_TRAITER);
});

test('listerHistoriqueRendezvousDossiers catégorise Replanifié un rendez-vous "prevu" plus ancien qu\'un autre rendez-vous du même dossier (réplanification jamais actée sur l\'ancien, voir dossiers #74/#88)', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  mockerNotesVides(t);
  t.mock.method(rendezvousRepository, 'listerHistoriqueRendezvousParDossiers', async () => [
    { id: 1, dossier_id: 88, date_heure: '2026-08-01T09:00:00.000Z', statut: 'prevu', evaluation_id: null },
    { id: 2, dossier_id: 88, date_heure: '2026-08-10T09:00:00.000Z', statut: 'prevu', evaluation_id: null },
    { id: 3, dossier_id: 88, date_heure: DATE_FUTURE, statut: 'prevu', evaluation_id: null },
  ]);

  const resultat = await rendezvousService.listerHistoriqueRendezvousDossiers(ENTITE_FACTICE, [88]);

  assert.equal(resultat.rendezvous[0].statutCategorise, rendezvousService.CATEGORIES_STATUT_HISTORIQUE.REPLANIFIE);
  assert.equal(resultat.rendezvous[1].statutCategorise, rendezvousService.CATEGORIES_STATUT_HISTORIQUE.REPLANIFIE);
  assert.equal(resultat.rendezvous[2].statutCategorise, rendezvousService.CATEGORIES_STATUT_HISTORIQUE.A_VENIR);
});

test("listerHistoriqueRendezvousDossiers calcule le rendez-vous actif indépendamment pour chaque dossier (le 'plus récent' d'un dossier ne doit pas influencer un autre)", async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  mockerNotesVides(t);
  t.mock.method(rendezvousRepository, 'listerHistoriqueRendezvousParDossiers', async () => [
    // Dossier 1 : un seul rendez-vous, passé, toujours actif -> À traiter (pas Replanifié : rien
    // d'autre n'existe pour ce dossier).
    { id: 1, dossier_id: 1, date_heure: DATE_PASSEE, statut: 'prevu', evaluation_id: null },
    // Dossier 2 : un seul rendez-vous, futur -> À venir.
    { id: 2, dossier_id: 2, date_heure: DATE_FUTURE, statut: 'prevu', evaluation_id: null },
  ]);

  const resultat = await rendezvousService.listerHistoriqueRendezvousDossiers(ENTITE_FACTICE, [1, 2]);

  assert.equal(resultat.rendezvous[0].statutCategorise, rendezvousService.CATEGORIES_STATUT_HISTORIQUE.A_TRAITER);
  assert.equal(resultat.rendezvous[1].statutCategorise, rendezvousService.CATEGORIES_STATUT_HISTORIQUE.A_VENIR);
});

test('listerHistoriqueRendezvousDossiers transmet le motif (annulé/absent) et le commentaire d\'évaluation (honoré) portés par chaque ligne de rendez-vous, inchangés', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  mockerNotesVides(t);
  t.mock.method(rendezvousRepository, 'listerHistoriqueRendezvousParDossiers', async () => [
    {
      id: 1,
      dossier_id: 74,
      date_heure: DATE_PASSEE,
      statut: 'annule',
      evaluation_id: null,
      motif_code: 'absence_non_justifiee',
      motif_libelle: 'Absence non justifiée',
    },
    {
      id: 2,
      dossier_id: 74,
      date_heure: DATE_PASSEE,
      statut: 'prevu',
      evaluation_id: 501,
      evaluation_resultat: 'valide',
      evaluation_commentaire: 'Bon contact candidat, ponctuel.',
    },
  ]);

  const resultat = await rendezvousService.listerHistoriqueRendezvousDossiers(ENTITE_FACTICE, [74]);

  assert.equal(resultat.rendezvous[0].motif_libelle, 'Absence non justifiée');
  assert.equal(resultat.rendezvous[1].evaluation_commentaire, 'Bon contact candidat, ponctuel.');
});

test('listerHistoriqueRendezvousDossiers renvoie les notes de dossier telles que fournies par le repository, sans les rattacher à un rendez-vous', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(rendezvousRepository, 'listerHistoriqueRendezvousParDossiers', async () => [
    { id: 1, dossier_id: 88, date_heure: DATE_FUTURE, statut: 'prevu', evaluation_id: null },
  ]);
  const notesMock = t.mock.method(notesDossierRepository, 'listerNotesParDossiers', async () => [
    { id: 10, dossier_id: 88, contenu: 'Candidat très motivé.', date_creation: DATE_PASSEE, auteur_prenom: 'Jeanne', auteur_nom: 'Dupont' },
  ]);

  const resultat = await rendezvousService.listerHistoriqueRendezvousDossiers(ENTITE_FACTICE, [88]);

  assert.equal(notesMock.mock.calls.length, 1);
  assert.deepEqual(notesMock.mock.calls[0].arguments.slice(1), [ENTITE_FACTICE.id, [88]]);
  assert.deepEqual(resultat.notes, [
    { id: 10, dossier_id: 88, contenu: 'Candidat très motivé.', date_creation: DATE_PASSEE, auteur_prenom: 'Jeanne', auteur_nom: 'Dupont' },
  ]);
});

// Garde-fou ajouté par l'audit du 2026-08-20 (dossier #84) : changerStatutRendezvous refuse
// désormais toute action si le dossier a déjà quitté test_planifie vers une issue (voir
// STATUTS_DOSSIER_RENDEZVOUS_CLOS, rendezvousService.js).
test('changerStatutRendezvous rejette avec ErreurRendezvousDossierClos si le dossier est déjà test_non_realise', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => creerBdFactice());
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({
    id: 84,
    statut_code: 'test_non_realise',
    statut_libelle: 'Test non réalisé',
  }));
  const trouverRendezvousParId = t.mock.method(rendezvousRepository, 'trouverRendezvousParId', async () => ({
    id: 70,
    dossier_id: 84,
    statut: 'prevu',
  }));

  await assert.rejects(
    () => rendezvousService.changerStatutRendezvous(ENTITE_FACTICE, { dossierId: 84, rendezvousId: 70, statut: 'confirme' }),
    (erreur) => {
      assert.ok(erreur instanceof ErreurRendezvousDossierClos);
      assert.match(erreur.message, /Test non réalisé/);
      return true;
    },
  );
  // Refusé avant même d'aller chercher le rendez-vous — pas la peine d'une requête de plus une
  // fois le dossier reconnu comme clos.
  assert.equal(trouverRendezvousParId.mock.callCount(), 0);
});

test('changerStatutRendezvous rejette pour chacun des 4 statuts de dossier "clos" (invalide/valide_envoi_formation/valide_pret_embauche en plus de test_non_realise)', async (t) => {
  for (const statutCode of ['invalide', 'valide_envoi_formation', 'valide_pret_embauche']) {
    t.mock.method(db, 'obtenirKnex', async () => creerBdFactice());
    t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({
      id: 1,
      statut_code: statutCode,
      statut_libelle: statutCode,
    }));

    await assert.rejects(
      () => rendezvousService.changerStatutRendezvous(ENTITE_FACTICE, { dossierId: 1, rendezvousId: 1, statut: 'absent', motifCode: 'autre' }),
      ErreurRendezvousDossierClos,
      `devrait rejeter pour statut_code=${statutCode}`,
    );
  }
});

test('changerStatutRendezvous réussit normalement quand le dossier est encore test_planifie', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => creerBdFactice());
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({
    id: 90,
    statut_code: 'test_planifie',
    statut_libelle: 'Test planifié',
  }));
  t.mock.method(rendezvousRepository, 'trouverRendezvousParId', async () => ({ id: 71, dossier_id: 90, statut: 'prevu' }));
  const mettreAJour = t.mock.method(rendezvousRepository, 'mettreAJourStatutRendezvous', async () => ({ id: 71, statut: 'confirme' }));

  const resultat = await rendezvousService.changerStatutRendezvous(ENTITE_FACTICE, { dossierId: 90, rendezvousId: 71, statut: 'confirme' });

  assert.equal(mettreAJour.mock.callCount(), 1);
  assert.deepEqual(resultat, { id: 71, statut: 'confirme' });
});

test('changerStatutRendezvous accepte une transaction déjà ouverte (bdExistante) sans en ouvrir une seconde', async (t) => {
  const obtenirKnex = t.mock.method(db, 'obtenirKnex', async () => creerBdFactice());
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({
    id: 90,
    statut_code: 'test_planifie',
    statut_libelle: 'Test planifié',
  }));
  t.mock.method(rendezvousRepository, 'trouverRendezvousParId', async () => ({ id: 71, dossier_id: 90, statut: 'prevu' }));
  t.mock.method(motifRepository, 'trouverMotifParCode', async () => ({ id: 24, code: 'test_non_realise' }));
  t.mock.method(rendezvousRepository, 'mettreAJourStatutRendezvous', async () => ({ id: 71, statut: 'absent' }));

  const trxFactice = creerBdFactice();
  await rendezvousService.changerStatutRendezvous(
    ENTITE_FACTICE,
    { dossierId: 90, rendezvousId: 71, statut: 'absent', motifCode: 'test_non_realise' },
    trxFactice,
  );

  assert.equal(obtenirKnex.mock.callCount(), 0);
});
