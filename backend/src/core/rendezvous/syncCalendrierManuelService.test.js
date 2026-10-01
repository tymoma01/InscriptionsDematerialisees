const { test } = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const dossierRepository = require('../dossier/dossierRepository');
const notesDossierRepository = require('../dossier/notesDossierRepository');
const rendezvousRepository = require('./rendezvousRepository');
const rendezvousService = require('./rendezvousService');
const workflowEngine = require('../workflow/workflowEngine');
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
  // Par défaut, aucune transition dossier composée (voir les tests dédiés ci-dessous pour le cas
  // où elle s'applique) — évite que resoudreTransitionAnnulationTest (jamais mockée sinon) touche
  // la bd factice `{}` dans les tests qui ne testent pas spécifiquement ce comportement.
  t.mock.method(rendezvousService, 'resoudreTransitionAnnulationTest', async () => []);
  t.mock.method(workflowEngine, 'appliquerTransition', async () => ({ statutDestinationId: 4 }));
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
  // Boîte de création de l'événement (migration 072) : la seule que la synchronisation lit.
  outlook_calendrier: 'formation@accecit.com',
  formateur_role_code: 'formateur',
  formateur_id: 7,
};

test("executerSyncCalendrierManuel n'appelle rien si aucun rendez-vous actif n'a d'événement Outlook", async (t) => {
  mockerBase(t);
  t.mock.method(rendezvousRepository, 'listerRendezvousActifsAvecEvenementOutlook', async () => []);
  const obtenirEvenement = t.mock.method(graphCalendarService, 'obtenirEvenement', async () => null);

  const resultat = await executerSyncCalendrierManuel(ENTITE_FACTICE);

  assert.equal(obtenirEvenement.mock.callCount(), 0);
  assert.deepEqual(resultat, { annules: 0, deplaces: 0, inchanges: 0, ignores: 0, echecs: 0, annulationsBloquees: 0, total: 0 });
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

  // resoudreTransitionAnnulationTest décide seule (mockée à [] par mockerBase ci-dessus) : ce test
  // vérifie juste qu'elle est bien interrogée, avec les bons id — le cas où elle renvoie une
  // transition est couvert par le test dédié suivant.
  assert.equal(rendezvousService.resoudreTransitionAnnulationTest.mock.callCount(), 1);
  const appelResolution = rendezvousService.resoudreTransitionAnnulationTest.mock.calls[0].arguments;
  assert.equal(appelResolution[0], ENTITE_FACTICE);
  assert.deepEqual(appelResolution[1], { dossierId: 42, rendezvousId: 10 });
  assert.equal(workflowEngine.appliquerTransition.mock.callCount(), 0, "aucune transition à appliquer ([] renvoyé par défaut)");

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

  assert.deepEqual(resultat, { annules: 1, deplaces: 0, inchanges: 0, ignores: 0, echecs: 0, annulationsBloquees: 0, total: 1 });
});

// Audit 2026-09-21 (angle mort constaté sur 12 dossiers PROD, ex. #29/#41) : jusqu'ici, une
// annulation détectée via la sync Outlook posait rendezvous.statut='annule' SANS jamais composer
// avec workflowEngine.appliquerTransition, contrairement au chemin UI équivalent (PATCH
// /rendezvous/:id). Ce test vérifie que la composition est bien faite, dans la MÊME transaction
// (trx factice partagée, voir creerBdFactice), quand resoudreTransitionAnnulationTest renvoie une
// transition à appliquer.
test('executerSyncCalendrierManuel compose la transition dossier test_non_realise quand resoudreTransitionAnnulationTest en renvoie une', async (t) => {
  mockerBase(t);
  t.mock.method(rendezvousRepository, 'listerRendezvousActifsAvecEvenementOutlook', async () => [RDV_FACTICE]);
  t.mock.method(rendezvousRepository, 'trouverRendezvousPourBasculeVerrouillee', async () => ({
    ...RDV_FACTICE,
    statut: 'prevu',
  }));
  t.mock.method(graphCalendarService, 'obtenirEvenement', async () => null);
  t.mock.method(rendezvousService, 'changerStatutRendezvous', async () => ({}));
  const resoudreTransition = t.mock.method(rendezvousService, 'resoudreTransitionAnnulationTest', async () => [
    { codeAction: 'test_non_realise', commentaire: 'Test non réalisé (rendez-vous annulé).' },
  ]);
  const appliquerTransition = t.mock.method(workflowEngine, 'appliquerTransition', async () => ({ statutDestinationId: 4 }));
  const enregistrerAction = t.mock.method(journalAudit, 'enregistrerAction', async () => {});

  const resultat = await executerSyncCalendrierManuel(ENTITE_FACTICE);

  assert.equal(resoudreTransition.mock.callCount(), 1);

  assert.equal(appliquerTransition.mock.callCount(), 1);
  const appel = appliquerTransition.mock.calls[0].arguments;
  assert.equal(appel[0], ENTITE_FACTICE);
  assert.equal(appel[1].dossierId, 42);
  assert.equal(appel[1].codeAction, 'test_non_realise');
  assert.equal(appel[1].utilisateurId, UTILISATEUR_SYSTEME_FACTICE.id);
  // Acteur SYSTEME, pas un utilisateur humain — cette transition part d'une détection automatique
  // (job de sync), jamais d'une action directe d'un agent dans l'app.
  assert.equal(appel[1].roleCode, 'systeme');

  // 3 actions journalisées au total pour ce cas : la transition dossier (action DISTINCTE des
  // autres origines possibles de ce même codeAction), puis rendezvous_annule_sync_outlook.
  assert.equal(enregistrerAction.mock.callCount(), 2);
  const actions = enregistrerAction.mock.calls.map((appelAction) => appelAction.arguments[1].action);
  assert.deepEqual(actions, ['dossier_transition_test_non_realise_annulation_sync_outlook', 'rendezvous_annule_sync_outlook']);

  assert.deepEqual(resultat, { annules: 1, deplaces: 0, inchanges: 0, ignores: 0, echecs: 0, annulationsBloquees: 0, total: 1 });
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

  assert.deepEqual(resultat, { annules: 0, deplaces: 1, inchanges: 0, ignores: 0, echecs: 0, annulationsBloquees: 0, total: 1 });
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
  assert.deepEqual(resultat, { annules: 0, deplaces: 0, inchanges: 1, ignores: 0, echecs: 0, annulationsBloquees: 0, total: 1 });
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
  assert.deepEqual(resultat, { annules: 0, deplaces: 0, inchanges: 0, ignores: 1, echecs: 0, annulationsBloquees: 0, total: 1 });
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
  assert.deepEqual(resultat, { annules: 0, deplaces: 0, inchanges: 0, ignores: 1, echecs: 0, annulationsBloquees: 0, total: 1 });
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

  assert.deepEqual(resultat, { annules: 1, deplaces: 0, inchanges: 0, ignores: 0, echecs: 1, annulationsBloquees: 0, total: 2 });
});

test('executerSyncCalendrierManuel échoue explicitement si aucun utilisateur système configuré', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => creerBdFactice());
  t.mock.method(dossierRepository, 'trouverUtilisateurSysteme', async () => undefined);

  await assert.rejects(() => executerSyncCalendrierManuel(ENTITE_FACTICE), /Utilisateur système non configuré/);
});

// ---------------------------------------------------------------------------------------------
// Correctif 2026-10-01 (incident de production) : rendez-vous d'Anni Neacsu (calendrier personnel,
// adeville@) annulés à tort — l'événement, créé dans SA boîte, était relu dans formation@ (404).
// La synchronisation lit désormais la boîte de CRÉATION (rendezvous.outlook_calendrier), n'annule
// que sur « supprimé » obtenu dans cette boîte, et jamais plus de SEUIL_ANNULATIONS_PAR_PASSAGE
// annulations par passage.
// ---------------------------------------------------------------------------------------------
const { SEUIL_ANNULATIONS_PAR_PASSAGE } = require('./syncCalendrierManuelService');

const RDV_CALENDRIER_PERSONNEL = {
  ...RDV_FACTICE,
  id: 122,
  dossier_id: 135,
  date_heure: '2026-10-02T07:30:00.000Z',
  outlook_event_id: 'AAMk-evenement-anni',
  outlook_calendrier: 'adeville@accecit.com',
  formateur_id: 31,
};

// Outlook factice : un événement n'existe QUE dans la boîte où il a été créé.
function mockerOutlook(t, evenementsParBoite) {
  return t.mock.method(graphCalendarService, 'obtenirEvenement', async (boite, id) => evenementsParBoite[boite]?.[id] ?? null);
}

function mockerRelectureVerrouillee(t, rendezvousListe) {
  t.mock.method(rendezvousRepository, 'trouverRendezvousPourBasculeVerrouillee', async (trx, id) => ({
    ...rendezvousListe.find((r) => r.id === id),
    statut: 'prevu',
  }));
}

function erreurGraph(statusCode, codeGraph, message = 'refus') {
  const erreur = new Error(message);
  erreur.statusCode = statusCode;
  erreur.codeGraph = codeGraph;
  return erreur;
}

test('Formateur à calendrier personnel : événement présent dans SA boîte -> lu dans cette boîte, aucune annulation (cas Anni, dossier #135)', async (t) => {
  mockerBase(t);
  t.mock.method(rendezvousRepository, 'listerRendezvousActifsAvecEvenementOutlook', async () => [RDV_CALENDRIER_PERSONNEL]);
  mockerRelectureVerrouillee(t, [RDV_CALENDRIER_PERSONNEL]);
  const obtenirEvenement = mockerOutlook(t, {
    'adeville@accecit.com': { 'AAMk-evenement-anni': { start: { dateTime: '2026-10-02T07:30:00.0000000' } } },
    // Absent de formation@ : c'était la boîte (fausse) interrogée avant le correctif.
  });
  const changerStatut = t.mock.method(rendezvousService, 'changerStatutRendezvous', async () => ({}));

  const resultat = await executerSyncCalendrierManuel(ENTITE_FACTICE);

  assert.deepEqual(obtenirEvenement.mock.calls[0].arguments, ['adeville@accecit.com', 'AAMk-evenement-anni']);
  assert.equal(changerStatut.mock.callCount(), 0);
  assert.equal(invitationTestService.envoyerNotificationAnnulationTest.mock.callCount(), 0, 'aucun courriel d’annulation');
  assert.deepEqual(resultat, { annules: 0, deplaces: 0, inchanges: 1, ignores: 0, echecs: 0, annulationsBloquees: 0, total: 1 });
});

test('Vraie suppression : « supprimé » dans la bonne boîte (calendrier personnel) -> annulation, comme avant', async (t) => {
  mockerBase(t);
  t.mock.method(rendezvousRepository, 'listerRendezvousActifsAvecEvenementOutlook', async () => [RDV_CALENDRIER_PERSONNEL]);
  mockerRelectureVerrouillee(t, [RDV_CALENDRIER_PERSONNEL]);
  const obtenirEvenement = mockerOutlook(t, { 'adeville@accecit.com': {} });
  const changerStatut = t.mock.method(rendezvousService, 'changerStatutRendezvous', async () => ({}));

  const resultat = await executerSyncCalendrierManuel(ENTITE_FACTICE);

  assert.equal(obtenirEvenement.mock.calls[0].arguments[0], 'adeville@accecit.com');
  assert.equal(changerStatut.mock.callCount(), 1);
  assert.equal(changerStatut.mock.calls[0].arguments[1].motifCode, 'annule_depuis_outlook');
  assert.equal(invitationTestService.envoyerNotificationAnnulationTest.mock.callCount(), 1);
  assert.equal(resultat.annules, 1);
});

for (const [cas, erreur] of [
  ['403 ErrorAccessDenied', erreurGraph(403, 'ErrorAccessDenied')],
  ['401 InvalidAuthenticationToken', erreurGraph(401, 'InvalidAuthenticationToken')],
  ['503 (5xx)', erreurGraph(503, 'ServiceUnavailable')],
  ['404 boîte inconnue (ErrorInvalidUser)', erreurGraph(404, 'ErrorInvalidUser')],
  ['erreur réseau', erreurGraph(null, null, 'getaddrinfo ENOTFOUND graph.microsoft.com')],
]) {
  test(`Réponse non concluante (${cas}) -> aucune annulation, aucun courriel, une ligne d'erreur dans journal_audit`, async (t) => {
    mockerBase(t);
    t.mock.method(rendezvousRepository, 'listerRendezvousActifsAvecEvenementOutlook', async () => [RDV_CALENDRIER_PERSONNEL]);
    t.mock.method(graphCalendarService, 'obtenirEvenement', async () => {
      throw erreur;
    });
    const changerStatut = t.mock.method(rendezvousService, 'changerStatutRendezvous', async () => ({}));
    const enregistrerAction = t.mock.method(journalAudit, 'enregistrerAction', async () => {});

    const resultat = await executerSyncCalendrierManuel(ENTITE_FACTICE);

    assert.equal(changerStatut.mock.callCount(), 0);
    assert.equal(workflowEngine.appliquerTransition.mock.callCount(), 0);
    assert.equal(notesDossierRepository.ajouterNote.mock.callCount(), 0);
    assert.equal(invitationTestService.envoyerNotificationAnnulationTest.mock.callCount(), 0);
    assert.equal(enregistrerAction.mock.callCount(), 1);
    const trace = enregistrerAction.mock.calls[0].arguments[1];
    assert.equal(trace.action, 'rendezvous_sync_outlook_erreur');
    assert.equal(trace.cibleId, 122);
    assert.equal(trace.donnees.statutHttp, erreur.statusCode);
    assert.equal(trace.donnees.codeGraph, erreur.codeGraph);
    assert.equal(trace.donnees.outlookCalendrier, 'adeville@accecit.com');
    assert.deepEqual(resultat, { annules: 0, deplaces: 0, inchanges: 0, ignores: 0, echecs: 1, annulationsBloquees: 0, total: 1 });
  });
}

test('Boîte de création inconnue (outlook_calendrier vide) -> aucun appel Graph, aucune annulation, erreur tracée', async (t) => {
  mockerBase(t);
  t.mock.method(rendezvousRepository, 'listerRendezvousActifsAvecEvenementOutlook', async () => [{ ...RDV_FACTICE, outlook_calendrier: null }]);
  const obtenirEvenement = mockerOutlook(t, {});
  const changerStatut = t.mock.method(rendezvousService, 'changerStatutRendezvous', async () => ({}));
  const enregistrerAction = t.mock.method(journalAudit, 'enregistrerAction', async () => {});

  const resultat = await executerSyncCalendrierManuel(ENTITE_FACTICE);

  assert.equal(obtenirEvenement.mock.callCount(), 0);
  assert.equal(changerStatut.mock.callCount(), 0);
  assert.equal(enregistrerAction.mock.calls[0].arguments[1].donnees.codeGraph, 'boite_inconnue');
  assert.equal(resultat.echecs, 1);
});

test('Après une réponse non concluante, le rendez-vous reste actif et est revérifié au passage suivant', async (t) => {
  mockerBase(t);
  t.mock.method(rendezvousRepository, 'listerRendezvousActifsAvecEvenementOutlook', async () => [RDV_CALENDRIER_PERSONNEL]);
  mockerRelectureVerrouillee(t, [RDV_CALENDRIER_PERSONNEL]);
  let passage = 0;
  const obtenirEvenement = t.mock.method(graphCalendarService, 'obtenirEvenement', async () => {
    passage += 1;
    if (passage === 1) throw erreurGraph(503, 'ServiceUnavailable');
    return { start: { dateTime: '2026-10-02T07:30:00.0000000' } };
  });
  const changerStatut = t.mock.method(rendezvousService, 'changerStatutRendezvous', async () => ({}));

  const premier = await executerSyncCalendrierManuel(ENTITE_FACTICE);
  const second = await executerSyncCalendrierManuel(ENTITE_FACTICE);

  assert.equal(premier.echecs, 1);
  assert.equal(second.inchanges, 1);
  assert.equal(obtenirEvenement.mock.callCount(), 2);
  assert.equal(changerStatut.mock.callCount(), 0);
});

function rendezvousSupprimes(nombre) {
  return Array.from({ length: nombre }, (_, i) => ({ ...RDV_FACTICE, id: 500 + i, dossier_id: 600 + i, outlook_event_id: `evt-${i}` }));
}

test(`Garde-fou : plus de ${SEUIL_ANNULATIONS_PAR_PASSAGE} annulations dans un passage -> AUCUNE appliquée, alerte dans journal_audit`, async (t) => {
  mockerBase(t);
  const liste = rendezvousSupprimes(SEUIL_ANNULATIONS_PAR_PASSAGE + 1);
  // Un rendez-vous DÉPLACÉ dans le même passage : le déplacement, lui, reste appliqué.
  const deplace = { ...RDV_FACTICE, id: 700, dossier_id: 800, outlook_event_id: 'evt-deplace' };
  t.mock.method(rendezvousRepository, 'listerRendezvousActifsAvecEvenementOutlook', async () => [...liste, deplace]);
  mockerRelectureVerrouillee(t, [...liste, deplace]);
  mockerOutlook(t, { 'formation@accecit.com': { 'evt-deplace': { start: { dateTime: '2026-09-01T12:00:00.0000000' } } } });
  t.mock.method(rendezvousRepository, 'mettreAJourDateHeureRendezvous', async () => ({}));
  const changerStatut = t.mock.method(rendezvousService, 'changerStatutRendezvous', async () => ({}));
  const enregistrerAction = t.mock.method(journalAudit, 'enregistrerAction', async () => {});

  const resultat = await executerSyncCalendrierManuel(ENTITE_FACTICE);

  assert.equal(changerStatut.mock.callCount(), 0, 'aucune annulation');
  assert.equal(invitationTestService.envoyerNotificationAnnulationTest.mock.callCount(), 0, 'aucun courriel d’annulation');
  const alerte = enregistrerAction.mock.calls.find((appel) => appel.arguments[1].action === 'alerte_sync_outlook_annulations_massives');
  assert.ok(alerte, 'alerte consignée');
  assert.equal(alerte.arguments[1].donnees.nombre, SEUIL_ANNULATIONS_PAR_PASSAGE + 1);
  assert.deepEqual(alerte.arguments[1].donnees.rendezvous.map((r) => r.rendezvousId), liste.map((r) => r.id));
  assert.equal(resultat.deplaces, 1, 'le déplacement reste appliqué');
  assert.equal(resultat.annules, 0);
  assert.equal(resultat.annulationsBloquees, SEUIL_ANNULATIONS_PAR_PASSAGE + 1);
});

test(`Garde-fou : exactement ${SEUIL_ANNULATIONS_PAR_PASSAGE} annulations dans un passage -> toutes appliquées, aucune alerte`, async (t) => {
  mockerBase(t);
  const liste = rendezvousSupprimes(SEUIL_ANNULATIONS_PAR_PASSAGE);
  t.mock.method(rendezvousRepository, 'listerRendezvousActifsAvecEvenementOutlook', async () => liste);
  mockerRelectureVerrouillee(t, liste);
  mockerOutlook(t, {});
  const changerStatut = t.mock.method(rendezvousService, 'changerStatutRendezvous', async () => ({}));
  const enregistrerAction = t.mock.method(journalAudit, 'enregistrerAction', async () => {});

  const resultat = await executerSyncCalendrierManuel(ENTITE_FACTICE);

  assert.equal(changerStatut.mock.callCount(), SEUIL_ANNULATIONS_PAR_PASSAGE);
  assert.equal(enregistrerAction.mock.calls.some((appel) => appel.arguments[1].action === 'alerte_sync_outlook_annulations_massives'), false);
  assert.equal(resultat.annules, SEUIL_ANNULATIONS_PAR_PASSAGE);
  assert.equal(resultat.annulationsBloquees, 0);
});

test('Sans calendrier personnel : formateur lu dans formation@, inspecteur dans test-tertiaire@ (boîtes de création), comportement inchangé', async (t) => {
  mockerBase(t);
  const formateur = { ...RDV_FACTICE, id: 801, outlook_event_id: 'evt-f', outlook_calendrier: 'formation@accecit.com' };
  const inspecteur = { ...RDV_FACTICE, id: 802, outlook_event_id: 'evt-i', outlook_calendrier: 'test-tertiaire@accecit.com', formateur_role_code: 'inspecteur' };
  t.mock.method(rendezvousRepository, 'listerRendezvousActifsAvecEvenementOutlook', async () => [formateur, inspecteur]);
  mockerRelectureVerrouillee(t, [formateur, inspecteur]);
  const memeHoraire = { start: { dateTime: '2026-09-01T10:00:00.0000000' } };
  const obtenirEvenement = mockerOutlook(t, {
    'formation@accecit.com': { 'evt-f': memeHoraire },
    'test-tertiaire@accecit.com': { 'evt-i': memeHoraire },
  });

  const resultat = await executerSyncCalendrierManuel(ENTITE_FACTICE);

  assert.deepEqual(obtenirEvenement.mock.calls.map((appel) => appel.arguments[0]), ['formation@accecit.com', 'test-tertiaire@accecit.com']);
  assert.deepEqual(resultat, { annules: 0, deplaces: 0, inchanges: 2, ignores: 0, echecs: 0, annulationsBloquees: 0, total: 2 });
});
