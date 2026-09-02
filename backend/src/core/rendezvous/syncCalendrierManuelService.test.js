const { test } = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const dossierRepository = require('../dossier/dossierRepository');
const notesDossierRepository = require('../dossier/notesDossierRepository');
const rendezvousRepository = require('./rendezvousRepository');
const rendezvousService = require('./rendezvousService');
const graphCalendarService = require('../../integrations/calendrier/graphCalendarService');
const notificationDeplacementManuelService = require('./notificationDeplacementManuelService');
const invitationTestService = require('./invitationTestService');
const journalAudit = require('../audit/journalAudit');
const { executerSyncCalendrierManuel } = require('./syncCalendrierManuelService');

const ENTITE_FACTICE = { id: 1, code: 'accecit' };
const UTILISATEUR_SYSTEME_FACTICE = { id: 99 };

// bd factice avec un .transaction(fn) qui exécute simplement fn(bd) — même patron que
// basculeTestNonRealiseService.test.js/rendezvousService.test.js.
function creerBdFactice() {
  const bd = {};
  bd.transaction = async (fn) => fn(bd);
  return bd;
}

function mockerBase(t) {
  t.mock.method(db, 'obtenirKnex', async () => creerBdFactice());
  t.mock.method(dossierRepository, 'trouverUtilisateurSysteme', async () => UTILISATEUR_SYSTEME_FACTICE);
  t.mock.method(journalAudit, 'enregistrerAction', async () => {});
  t.mock.method(notesDossierRepository, 'ajouterNote', async () => 1);
  t.mock.method(notificationDeplacementManuelService, 'envoyerNotificationDeplacementManuel', async () => ({
    candidatEmailEnvoye: true,
    formateurEmailEnvoye: true,
  }));
  t.mock.method(invitationTestService, 'envoyerNotificationAnnulationTest', async () => ({
    candidatEmailEnvoye: true,
    formateurEmailEnvoye: true,
  }));
}

// formateur_id (audit 2026-09-02) : listerRendezvousActifsAvecEvenementOutlook le sélectionne
// désormais (voir rendezvousRepository.js), requis par invitationTestService.
// envoyerNotificationAnnulationTest/notificationDeplacementManuelService.
// envoyerNotificationDeplacementManuel pour résoudre l'email du formateur/inspecteur.
const RDV_FACTICE = {
  id: 10,
  dossier_id: 42,
  date_heure: '2026-09-01T10:00:00.000Z',
  outlook_event_id: 'outlook-evenement-10',
  formateur_role_code: 'formateur',
  formateur_id: 7,
};

test("executerSyncCalendrierManuel n'appelle rien si aucun rendez-vous actif n'a d'événement Outlook", async (t) => {
  mockerBase(t);
  t.mock.method(rendezvousRepository, 'listerRendezvousActifsAvecEvenementOutlook', async () => []);
  const obtenirEvenement = t.mock.method(graphCalendarService, 'obtenirEvenement', async () => null);

  const resultat = await executerSyncCalendrierManuel(ENTITE_FACTICE);

  assert.equal(obtenirEvenement.mock.callCount(), 0);
  assert.deepEqual(resultat, { annules: 0, deplaces: 0, inchanges: 0, ignores: 0, echecs: 0, total: 0 });
});

test('executerSyncCalendrierManuel annule le rendez-vous quand son événement Outlook a été supprimé', async (t) => {
  mockerBase(t);
  t.mock.method(rendezvousRepository, 'listerRendezvousActifsAvecEvenementOutlook', async () => [RDV_FACTICE]);
  t.mock.method(rendezvousRepository, 'trouverRendezvousPourBasculeVerrouillee', async () => ({
    ...RDV_FACTICE,
    statut: 'prevu',
  }));
  t.mock.method(graphCalendarService, 'obtenirEvenement', async () => null);
  const changerStatutRendezvous = t.mock.method(rendezvousService, 'changerStatutRendezvous', async () => ({}));
  const mettreAJourDateHeureRendezvous = t.mock.method(rendezvousRepository, 'mettreAJourDateHeureRendezvous', async () => ({}));
  const enregistrerAction = t.mock.method(journalAudit, 'enregistrerAction', async () => {});
  const ajouterNote = t.mock.method(notesDossierRepository, 'ajouterNote', async () => 1);
  const envoyerNotificationAnnulation = t.mock.method(
    invitationTestService,
    'envoyerNotificationAnnulationTest',
    async () => ({ candidatEmailEnvoye: true, formateurEmailEnvoye: true }),
  );
  const envoyerNotificationDeplacement = t.mock.method(
    notificationDeplacementManuelService,
    'envoyerNotificationDeplacementManuel',
    async () => ({ candidatEmailEnvoye: true, formateurEmailEnvoye: true }),
  );

  const resultat = await executerSyncCalendrierManuel(ENTITE_FACTICE);

  assert.equal(changerStatutRendezvous.mock.callCount(), 1);
  const appelChangerStatut = changerStatutRendezvous.mock.calls[0].arguments;
  assert.equal(appelChangerStatut[0], ENTITE_FACTICE);
  assert.equal(appelChangerStatut[1].dossierId, 42);
  assert.equal(appelChangerStatut[1].rendezvousId, 10);
  assert.equal(appelChangerStatut[1].statut, 'annule');
  assert.equal(appelChangerStatut[1].motifCode, 'annule_depuis_outlook');

  assert.equal(mettreAJourDateHeureRendezvous.mock.callCount(), 0, 'une annulation ne doit jamais toucher date_heure');

  assert.equal(ajouterNote.mock.callCount(), 1);
  assert.equal(ajouterNote.mock.calls[0].arguments[1].dossierId, 42);
  assert.equal(ajouterNote.mock.calls[0].arguments[1].auteurId, UTILISATEUR_SYSTEME_FACTICE.id);
  assert.match(ajouterNote.mock.calls[0].arguments[1].contenu, /annulé manuellement depuis le calendrier Outlook/);

  assert.equal(enregistrerAction.mock.callCount(), 1);
  assert.equal(enregistrerAction.mock.calls[0].arguments[1].action, 'rendezvous_annule_sync_outlook');

  // Candidat ET formateur/inspecteur notifiés (décision utilisateur, 2026-09-02 : "en cas de
  // changement de planification, toutes les parties prenantes doivent être notifiées" — annule la
  // règle du 2026-08-28 qui excluait le candidat ici). Même fonction que le chemin UI "Marquer
  // annulé" (invitationTestService.envoyerNotificationAnnulationTest), appelée avec le rendez-vous
  // tel que lu par listerRendezvousActifsAvecEvenementOutlook (id/dossier_id/date_heure/
  // formateur_id).
  assert.equal(envoyerNotificationAnnulation.mock.callCount(), 1);
  const appelAnnulation = envoyerNotificationAnnulation.mock.calls[0].arguments;
  assert.equal(appelAnnulation[0], ENTITE_FACTICE);
  assert.equal(appelAnnulation[1].id, 10);
  assert.equal(appelAnnulation[1].dossier_id, 42);
  assert.equal(appelAnnulation[1].formateur_id, 7);
  assert.equal(envoyerNotificationDeplacement.mock.callCount(), 0, 'une annulation ne déclenche jamais la notification de déplacement');

  assert.deepEqual(resultat, { annules: 1, deplaces: 0, inchanges: 0, ignores: 0, echecs: 0, total: 1 });
});

test('executerSyncCalendrierManuel déplace le rendez-vous et notifie le candidat par email quand son horaire Outlook a changé', async (t) => {
  mockerBase(t);
  t.mock.method(rendezvousRepository, 'listerRendezvousActifsAvecEvenementOutlook', async () => [RDV_FACTICE]);
  t.mock.method(rendezvousRepository, 'trouverRendezvousPourBasculeVerrouillee', async () => ({
    ...RDV_FACTICE,
    statut: 'prevu',
  }));
  // Nouvel horaire Outlook, distinct de RDV_FACTICE.date_heure — `Prefer: outlook.timezone="UTC"`
  // (voir graphCalendarService.obtenirEvenement) : dateTime sans suffixe de fuseau, toujours
  // interprété comme UTC (voir syncCalendrierManuelService.dateOutlookVersIso).
  t.mock.method(graphCalendarService, 'obtenirEvenement', async () => ({ start: { dateTime: '2026-09-02T14:30:00.000' } }));
  const changerStatutRendezvous = t.mock.method(rendezvousService, 'changerStatutRendezvous', async () => ({}));
  const mettreAJourDateHeureRendezvous = t.mock.method(rendezvousRepository, 'mettreAJourDateHeureRendezvous', async () => ({}));
  const enregistrerAction = t.mock.method(journalAudit, 'enregistrerAction', async () => {});
  const ajouterNote = t.mock.method(notesDossierRepository, 'ajouterNote', async () => 1);
  const envoyerNotification = t.mock.method(
    notificationDeplacementManuelService,
    'envoyerNotificationDeplacementManuel',
    async () => ({ emailEnvoye: true }),
  );

  const resultat = await executerSyncCalendrierManuel(ENTITE_FACTICE);

  assert.equal(changerStatutRendezvous.mock.callCount(), 0, 'un déplacement ne doit jamais toucher le statut');

  assert.equal(mettreAJourDateHeureRendezvous.mock.callCount(), 1);
  const appelMaj = mettreAJourDateHeureRendezvous.mock.calls[0].arguments;
  assert.equal(appelMaj[1], 10);
  assert.equal(appelMaj[2], '2026-09-02T14:30:00.000Z');

  assert.equal(ajouterNote.mock.callCount(), 1);
  assert.match(ajouterNote.mock.calls[0].arguments[1].contenu, /déplacé manuellement depuis le calendrier Outlook/);

  assert.equal(enregistrerAction.mock.callCount(), 1);
  assert.equal(enregistrerAction.mock.calls[0].arguments[1].action, 'rendezvous_deplace_sync_outlook');

  assert.equal(envoyerNotification.mock.callCount(), 1);
  const appelEmail = envoyerNotification.mock.calls[0].arguments;
  assert.equal(appelEmail[0], ENTITE_FACTICE);
  assert.equal(appelEmail[1].dossierId, 42);
  // formateurId transmis (audit 2026-09-02, "toutes les parties prenantes sont notifiées") — la
  // fonction appelée le résout elle-même en email formateur/inspecteur, voir
  // notificationDeplacementManuelService.js.
  assert.equal(appelEmail[1].formateurId, 7);
  assert.equal(appelEmail[1].ancienneDateHeure, '2026-09-01T10:00:00.000Z');
  assert.equal(appelEmail[1].nouvelleDateHeure, '2026-09-02T14:30:00.000Z');

  assert.deepEqual(resultat, { annules: 0, deplaces: 1, inchanges: 0, ignores: 0, echecs: 0, total: 1 });
});

test("executerSyncCalendrierManuel ne fait rien quand l'événement Outlook existe toujours au même horaire", async (t) => {
  mockerBase(t);
  t.mock.method(rendezvousRepository, 'listerRendezvousActifsAvecEvenementOutlook', async () => [RDV_FACTICE]);
  t.mock.method(rendezvousRepository, 'trouverRendezvousPourBasculeVerrouillee', async () => ({
    ...RDV_FACTICE,
    statut: 'prevu',
  }));
  // Même instant que RDV_FACTICE.date_heure (2026-09-01T10:00:00.000Z), sans suffixe de fuseau —
  // voir dateOutlookVersIso.
  t.mock.method(graphCalendarService, 'obtenirEvenement', async () => ({ start: { dateTime: '2026-09-01T10:00:00.000' } }));
  const changerStatutRendezvous = t.mock.method(rendezvousService, 'changerStatutRendezvous', async () => ({}));
  const mettreAJourDateHeureRendezvous = t.mock.method(rendezvousRepository, 'mettreAJourDateHeureRendezvous', async () => ({}));
  const ajouterNote = t.mock.method(notesDossierRepository, 'ajouterNote', async () => 1);
  const envoyerNotification = t.mock.method(
    notificationDeplacementManuelService,
    'envoyerNotificationDeplacementManuel',
    async () => ({ emailEnvoye: true }),
  );

  const resultat = await executerSyncCalendrierManuel(ENTITE_FACTICE);

  assert.equal(changerStatutRendezvous.mock.callCount(), 0);
  assert.equal(mettreAJourDateHeureRendezvous.mock.callCount(), 0);
  assert.equal(ajouterNote.mock.callCount(), 0);
  assert.equal(envoyerNotification.mock.callCount(), 0);
  assert.deepEqual(resultat, { annules: 0, deplaces: 0, inchanges: 1, ignores: 0, echecs: 0, total: 1 });
});

test('executerSyncCalendrierManuel ignore un rendez-vous déjà traité par une action concurrente (statut changé à la relecture verrouillée)', async (t) => {
  mockerBase(t);
  t.mock.method(rendezvousRepository, 'listerRendezvousActifsAvecEvenementOutlook', async () => [RDV_FACTICE]);
  // Un agent a confirmé/annulé/replanifié ce rendez-vous depuis l'app entre la lecture initiale et
  // cette écriture — la relecture verrouillée voit désormais un statut hors 'prevu'/'confirme'.
  t.mock.method(rendezvousRepository, 'trouverRendezvousPourBasculeVerrouillee', async () => ({
    ...RDV_FACTICE,
    statut: 'absent',
  }));
  t.mock.method(graphCalendarService, 'obtenirEvenement', async () => null);
  const changerStatutRendezvous = t.mock.method(rendezvousService, 'changerStatutRendezvous', async () => ({}));

  const resultat = await executerSyncCalendrierManuel(ENTITE_FACTICE);

  assert.equal(changerStatutRendezvous.mock.callCount(), 0);
  assert.deepEqual(resultat, { annules: 0, deplaces: 0, inchanges: 0, ignores: 1, echecs: 0, total: 1 });
});

test("executerSyncCalendrierManuel ignore un rendez-vous déjà replanifié depuis l'app (outlook_event_id changé à la relecture verrouillée)", async (t) => {
  mockerBase(t);
  t.mock.method(rendezvousRepository, 'listerRendezvousActifsAvecEvenementOutlook', async () => [RDV_FACTICE]);
  t.mock.method(rendezvousRepository, 'trouverRendezvousPourBasculeVerrouillee', async () => ({
    ...RDV_FACTICE,
    statut: 'prevu',
    outlook_event_id: 'outlook-evenement-NOUVEAU',
  }));
  t.mock.method(graphCalendarService, 'obtenirEvenement', async () => null);
  const changerStatutRendezvous = t.mock.method(rendezvousService, 'changerStatutRendezvous', async () => ({}));

  const resultat = await executerSyncCalendrierManuel(ENTITE_FACTICE);

  assert.equal(changerStatutRendezvous.mock.callCount(), 0);
  assert.deepEqual(resultat, { annules: 0, deplaces: 0, inchanges: 0, ignores: 1, echecs: 0, total: 1 });
});

test('executerSyncCalendrierManuel continue sur les rendez-vous suivants après un échec isolé', async (t) => {
  mockerBase(t);
  const rdv1 = { ...RDV_FACTICE, id: 20, dossier_id: 200, outlook_event_id: 'outlook-20' };
  const rdv2 = { ...RDV_FACTICE, id: 21, dossier_id: 201, outlook_event_id: 'outlook-21' };
  t.mock.method(rendezvousRepository, 'listerRendezvousActifsAvecEvenementOutlook', async () => [rdv1, rdv2]);
  t.mock.method(rendezvousRepository, 'trouverRendezvousPourBasculeVerrouillee', async (trx, id) => ({
    id,
    dossier_id: id === rdv1.id ? rdv1.dossier_id : rdv2.dossier_id,
    statut: 'prevu',
    outlook_event_id: id === rdv1.id ? rdv1.outlook_event_id : rdv2.outlook_event_id,
    date_heure: RDV_FACTICE.date_heure,
  }));
  t.mock.method(graphCalendarService, 'obtenirEvenement', async () => null);
  let appel = 0;
  t.mock.method(rendezvousService, 'changerStatutRendezvous', async () => {
    appel += 1;
    if (appel === 1) throw new Error('Ce test est déjà clôturé.');
    return {};
  });

  const resultat = await executerSyncCalendrierManuel(ENTITE_FACTICE);

  assert.deepEqual(resultat, { annules: 1, deplaces: 0, inchanges: 0, ignores: 0, echecs: 1, total: 2 });
});

test('executerSyncCalendrierManuel échoue explicitement si aucun utilisateur système configuré', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => creerBdFactice());
  t.mock.method(dossierRepository, 'trouverUtilisateurSysteme', async () => undefined);

  await assert.rejects(() => executerSyncCalendrierManuel(ENTITE_FACTICE), /Utilisateur système non configuré/);
});
