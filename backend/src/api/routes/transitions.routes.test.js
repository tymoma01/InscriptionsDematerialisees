const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const utilisateurRepository = require('../../core/auth/utilisateurRepository');
const graphCalendarService = require('../../integrations/calendrier/graphCalendarService');
const journalAudit = require('../../core/audit/journalAudit');
const transitionsRouter = require('./transitions.routes');

const { supprimerEvenementsOutlookRendezvousNeutralises } = transitionsRouter;

const ENTITE_ACCECIT = { id: 1, code: 'accecit' };
const FORMATEUR = { id: 8, role_code: 'formateur', calendrier_personnel: false };

// Aucune convention de test HTTP/route dans ce projet (pas de supertest) — cette fonction est
// exportée par transitions.routes.js spécifiquement pour rester testable directement (voir son
// commentaire d'en-tête), sans monter Express.
function mockerBase(t) {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(utilisateurRepository, 'trouverUtilisateurParId', async () => FORMATEUR);
  t.mock.method(graphCalendarService, 'resoudreCalendrierPourUtilisateur', () => 'formation@accecit.com');
}

test("supprimerEvenementsOutlookRendezvousNeutralises supprime l'événement Outlook de chaque rendez-vous qui en possède un", async (t) => {
  mockerBase(t);
  const supprimerEvenement = t.mock.method(graphCalendarService, 'supprimerEvenement', async () => {});

  await supprimerEvenementsOutlookRendezvousNeutralises(ENTITE_ACCECIT, {
    rendezvousNeutralises: [
      { id: 160, statutAvant: 'prevu', outlookEventId: 'evt-160', formateurId: 8 },
      { id: 161, statutAvant: 'confirme', outlookEventId: 'evt-161', formateurId: 8 },
    ],
    utilisateurId: 9,
    adresseIp: '127.0.0.1',
  });

  assert.equal(supprimerEvenement.mock.calls.length, 2);
  assert.deepEqual(supprimerEvenement.mock.calls[0].arguments, ['formation@accecit.com', 'evt-160']);
  assert.deepEqual(supprimerEvenement.mock.calls[1].arguments, ['formation@accecit.com', 'evt-161']);
});

test("supprimerEvenementsOutlookRendezvousNeutralises ignore silencieusement un rendez-vous sans outlookEventId ou sans formateurId (rien à supprimer)", async (t) => {
  mockerBase(t);
  const supprimerEvenement = t.mock.method(graphCalendarService, 'supprimerEvenement', async () => {});

  await supprimerEvenementsOutlookRendezvousNeutralises(ENTITE_ACCECIT, {
    rendezvousNeutralises: [
      { id: 170, statutAvant: 'prevu', outlookEventId: null, formateurId: 8 },
      { id: 171, statutAvant: 'prevu', outlookEventId: 'evt-171', formateurId: null },
    ],
    utilisateurId: 9,
    adresseIp: '127.0.0.1',
  });

  assert.equal(supprimerEvenement.mock.calls.length, 0);
});

// B9 (bloc 2, audit 2026-09-23) : un échec Outlook sur un rendez-vous n'empêche pas la suppression
// des suivants — try/catch PAR rendez-vous, jamais un seul englobant.
test("supprimerEvenementsOutlookRendezvousNeutralises continue sur les rendez-vous suivants après un échec Graph isolé, et journalise l'échec sans le propager", async (t) => {
  mockerBase(t);
  let appel = 0;
  const supprimerEvenement = t.mock.method(graphCalendarService, 'supprimerEvenement', async () => {
    appel += 1;
    if (appel === 1) throw new Error('Erreur Graph simulée (403).');
  });
  const enregistrerAction = t.mock.method(journalAudit, 'enregistrerAction', async () => {});
  const consoleErrorOriginal = console.error;
  console.error = () => {};

  try {
    await supprimerEvenementsOutlookRendezvousNeutralises(ENTITE_ACCECIT, {
      rendezvousNeutralises: [
        { id: 180, statutAvant: 'prevu', outlookEventId: 'evt-180', formateurId: 8 },
        { id: 181, statutAvant: 'confirme', outlookEventId: 'evt-181', formateurId: 8 },
      ],
      utilisateurId: 9,
      adresseIp: '127.0.0.1',
    });
  } finally {
    console.error = consoleErrorOriginal;
  }

  // Les DEUX suppressions ont été tentées — l'échec du premier n'a jamais empêché le second.
  assert.equal(supprimerEvenement.mock.calls.length, 2);

  // Une seule entrée journal_audit (le second a réussi, rien à journaliser pour lui) : action
  // dédiée, distincte de 'rendezvous_neutralise_force'.
  assert.equal(enregistrerAction.mock.calls.length, 1);
  const donneesJournal = enregistrerAction.mock.calls[0].arguments[1];
  assert.equal(donneesJournal.action, 'rendezvous_suppression_outlook_echec');
  assert.equal(donneesJournal.tableCible, 'rendezvous');
  assert.equal(donneesJournal.cibleId, 180);
  assert.equal(donneesJournal.donnees.outlookEventId, 'evt-180');
  assert.match(donneesJournal.donnees.erreur, /Erreur Graph simulée/);
});

test('supprimerEvenementsOutlookRendezvousNeutralises ignore un rendez-vous dont le formateur est introuvable (dossier orphelin), sans planter', async (t) => {
  mockerBase(t);
  t.mock.method(utilisateurRepository, 'trouverUtilisateurParId', async () => undefined);
  const supprimerEvenement = t.mock.method(graphCalendarService, 'supprimerEvenement', async () => {});

  await supprimerEvenementsOutlookRendezvousNeutralises(ENTITE_ACCECIT, {
    rendezvousNeutralises: [{ id: 190, statutAvant: 'prevu', outlookEventId: 'evt-190', formateurId: 42 }],
    utilisateurId: 9,
    adresseIp: '127.0.0.1',
  });

  assert.equal(supprimerEvenement.mock.calls.length, 0);
});
