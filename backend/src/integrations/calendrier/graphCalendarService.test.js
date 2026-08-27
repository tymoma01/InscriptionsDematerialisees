const test = require('node:test');
const assert = require('node:assert/strict');

// Même patron que graphMailProvider.test.js (méthode api(chemin) renvoyant un objet imitant le SDK
// Graph officiel, GraphError simulée via statusCode/code) — étendu ici avec les méthodes de
// construction de requête chaînées réellement utilisées par ce service (.header/.query/.select/
// .top), absentes de graphMailProvider.js. Chaque méthode de construction renvoie le builder
// lui-même pour permettre n'importe quel ordre de chaînage, comme le vrai SDK.
function creerClientMock(reponses) {
  return {
    api(chemin) {
      const requeteCapturee = { headers: {}, query: {} };
      const builder = {
        header(nom, valeur) {
          requeteCapturee.headers[nom] = valeur;
          return builder;
        },
        query(params) {
          Object.assign(requeteCapturee.query, params);
          return builder;
        },
        select(champs) {
          requeteCapturee.select = champs;
          return builder;
        },
        top(nombre) {
          requeteCapturee.top = nombre;
          return builder;
        },
        get: () => executer('GET'),
        post: (corps) => executer('POST', corps),
        delete: () => executer('DELETE'),
      };

      function executer(methode, corps) {
        const gestion = reponses[`${methode} ${chemin}`];
        if (!gestion) {
          throw new Error(`Appel Graph non simulé dans ce test : ${methode} ${chemin}`);
        }
        if (gestion.erreur) {
          const erreur = new Error(gestion.erreur.message || 'erreur Graph simulée');
          erreur.statusCode = gestion.erreur.statusCode;
          erreur.code = gestion.erreur.code;
          throw erreur;
        }
        if (gestion.capture) {
          gestion.capture({ corps, requete: requeteCapturee });
        }
        return Promise.resolve(gestion.valeur);
      }

      return builder;
    },
  };
}

// Même pattern que graphMailProvider.test.js : recharge le module et son cache graphClient.js
// partagé, pour repartir d'un état propre à chaque test.
function chargerServiceAvecClient(t, clientMock) {
  delete require.cache[require.resolve('./graphCalendarService')];
  delete require.cache[require.resolve('../stockage/graphClient')];
  const graphClient = require('../stockage/graphClient');
  t.mock.method(graphClient, 'obtenirClientGraph', async () => clientMock);
  return require('./graphCalendarService');
}

test('resoudreCalendrierParRole route formateur vers formation@accecit.com et inspecteur vers tertiaire2@accecit.com', async (t) => {
  const service = chargerServiceAvecClient(t, creerClientMock({}));

  assert.equal(service.resoudreCalendrierParRole('formateur'), 'formation@accecit.com');
  assert.equal(service.resoudreCalendrierParRole('inspecteur'), 'tertiaire2@accecit.com');
});

test('resoudreCalendrierParRole rejette un rôle sans calendrier configuré', async (t) => {
  const service = chargerServiceAvecClient(t, creerClientMock({}));

  assert.throws(() => service.resoudreCalendrierParRole('accueil_coordination'), /Aucun calendrier Outlook configuré/);
});

test('obtenirDisponibilites interroge calendarView avec startDateTime/endDateTime et le header Prefer UTC', async (t) => {
  let requeteRecue;
  const client = creerClientMock({
    'GET /users/formation@accecit.com/calendarView': {
      valeur: { value: [] },
      capture: ({ requete }) => {
        requeteRecue = requete;
      },
    },
  });
  const service = chargerServiceAvecClient(t, client);

  await service.obtenirDisponibilites(
    'formation@accecit.com',
    '2026-09-01T00:00:00.000Z',
    '2026-09-08T00:00:00.000Z',
  );

  assert.deepEqual(requeteRecue.query, {
    startDateTime: '2026-09-01T00:00:00.000Z',
    endDateTime: '2026-09-08T00:00:00.000Z',
  });
  assert.equal(requeteRecue.headers.Prefer, 'outlook.timezone="UTC"');
});

// Le cœur de la demande (décision utilisateur, 2026-08-26, révisée le même jour) : le calendrier
// hebdomadaire est purement informatif (ne bloque plus aucune sélection), donc TOUS les événements
// du calendrier départemental doivent être renvoyés — peu importe organisateur/participant. Ancien
// comportement (filtrage par personne) abandonné : il masquait systématiquement les événements créés
// directement dans Outlook par l'équipe (organisateur = boîte départementale, attendees = collègues
// divers, jamais la personne précise sélectionnée côté app), causant un calendrier vide en pratique.
test('obtenirDisponibilites retourne TOUS les événements du calendrier départemental, sans filtrage par organisateur/participant', async (t) => {
  const client = creerClientMock({
    'GET /users/formation@accecit.com/calendarView': {
      valeur: {
        value: [
          {
            start: { dateTime: '2026-09-01T08:00:00.0000000' },
            end: { dateTime: '2026-09-01T09:00:00.0000000' },
            organizer: { emailAddress: { address: 'formation@accecit.com' } },
            attendees: [{ emailAddress: { address: 'formateur-a@accecit.test' } }],
          },
          {
            start: { dateTime: '2026-09-01T10:00:00.0000000' },
            end: { dateTime: '2026-09-01T11:00:00.0000000' },
            organizer: { emailAddress: { address: 'formation@accecit.com' } },
            attendees: [{ emailAddress: { address: 'formateur-b@accecit.test' } }],
          },
        ],
      },
    },
  });
  const service = chargerServiceAvecClient(t, client);

  const resultat = await service.obtenirDisponibilites(
    'formation@accecit.com',
    '2026-09-01T00:00:00.000Z',
    '2026-09-08T00:00:00.000Z',
  );

  assert.deepEqual(resultat, [
    { debut: '2026-09-01T08:00:00.0000000Z', fin: '2026-09-01T09:00:00.0000000Z', sujet: null, journeeEntiere: false },
    { debut: '2026-09-01T10:00:00.0000000Z', fin: '2026-09-01T11:00:00.0000000Z', sujet: null, journeeEntiere: false },
  ]);
});

// Affichage du libellé directement dans le bloc du créneau (CalendrierHebdomadaireDisponibilite.jsx)
// plutôt qu'au seul survol — dépend de `subject` désormais demandé à Graph (voir `.select` ci-dessus).
test('obtenirDisponibilites renvoie le subject Graph tel quel sous `sujet`, et `null` (jamais chaîne vide) quand absent/vide', async (t) => {
  const client = creerClientMock({
    'GET /users/formation@accecit.com/calendarView': {
      valeur: {
        value: [
          {
            start: { dateTime: '2026-09-01T08:00:00.0000000' },
            end: { dateTime: '2026-09-01T09:00:00.0000000' },
            subject: 'MEP TOM Ford',
          },
          {
            start: { dateTime: '2026-09-01T10:00:00.0000000' },
            end: { dateTime: '2026-09-01T11:00:00.0000000' },
            subject: '',
          },
          {
            start: { dateTime: '2026-09-01T12:00:00.0000000' },
            end: { dateTime: '2026-09-01T13:00:00.0000000' },
          },
        ],
      },
    },
  });
  const service = chargerServiceAvecClient(t, client);

  const resultat = await service.obtenirDisponibilites(
    'formation@accecit.com',
    '2026-09-01T00:00:00.000Z',
    '2026-09-08T00:00:00.000Z',
  );

  assert.deepEqual(resultat, [
    { debut: '2026-09-01T08:00:00.0000000Z', fin: '2026-09-01T09:00:00.0000000Z', sujet: 'MEP TOM Ford', journeeEntiere: false },
    { debut: '2026-09-01T10:00:00.0000000Z', fin: '2026-09-01T11:00:00.0000000Z', sujet: null, journeeEntiere: false },
    { debut: '2026-09-01T12:00:00.0000000Z', fin: '2026-09-01T13:00:00.0000000Z', sujet: null, journeeEntiere: false },
  ]);
});

// Regroupement en bandeau dédié côté front (CalendrierHebdomadaireDisponibilite.jsx, audit
// lisibilité 2026-08-26) plutôt que répété sur chaque créneau de 15 min de la journée — dépend de
// `isAllDay` désormais demandé à Graph (voir `.select` ci-dessus), retranscrit sous `journeeEntiere`
// (convention française du projet).
test('obtenirDisponibilites retranscrit isAllDay sous `journeeEntiere`', async (t) => {
  const client = creerClientMock({
    'GET /users/formation@accecit.com/calendarView': {
      valeur: {
        value: [
          {
            start: { dateTime: '2026-09-01T00:00:00.0000000' },
            end: { dateTime: '2026-09-02T00:00:00.0000000' },
            subject: 'CAFET Report',
            isAllDay: true,
          },
        ],
      },
    },
  });
  const service = chargerServiceAvecClient(t, client);

  const resultat = await service.obtenirDisponibilites(
    'formation@accecit.com',
    '2026-09-01T00:00:00.000Z',
    '2026-09-08T00:00:00.000Z',
  );

  assert.deepEqual(resultat, [
    {
      debut: '2026-09-01T00:00:00.0000000Z',
      fin: '2026-09-02T00:00:00.0000000Z',
      sujet: 'CAFET Report',
      journeeEntiere: true,
    },
  ]);
});

test("creerEvenement construit un payload correct (start/end UTC, location, SANS attendees) et renvoie l'événement créé", async (t) => {
  let corpsEnvoye;
  const client = creerClientMock({
    'POST /users/formation@accecit.com/events': {
      valeur: { id: 'outlook-evenement-abc' },
      capture: ({ corps }) => {
        corpsEnvoye = corps;
      },
    },
  });
  const service = chargerServiceAvecClient(t, client);

  const resultat = await service.creerEvenement('formation@accecit.com', {
    sujet: 'Test ACCECIT — Jean Dupont',
    corps: '<p>Dossier #42</p>',
    debutIso: '2026-09-01T10:00:00.000Z',
    finIso: '2026-09-01T11:00:00.000Z',
    lieuLibelle: '14 rue de Valadon, 75007 Paris',
    participantEmail: 'formateur@accecit.test',
  });

  assert.deepEqual(resultat, { id: 'outlook-evenement-abc' });
  // dateTime SANS suffixe 'Z' (voir versDateTimeGraphUtc, graphCalendarService.js) : Graph attend
  // un datetime nu pour dateTimeTimeZone, le fuseau étant porté séparément par `timeZone`.
  // Pas de clé `attendees` du tout (audit 2026-08-28, corrige la double notification : un
  // attendee déclenchait une invitation Outlook native EN PLUS de notre email personnalisé, et son
  // "Annulé : ..." lors d'une replanification) — deepEqual vérifie l'objet exact, une régression
  // qui réintroduirait `attendees` ferait donc échouer ce test.
  assert.deepEqual(corpsEnvoye, {
    subject: 'Test ACCECIT — Jean Dupont',
    body: { contentType: 'HTML', content: '<p>Dossier #42</p>' },
    start: { dateTime: '2026-09-01T10:00:00.000', timeZone: 'UTC' },
    end: { dateTime: '2026-09-01T11:00:00.000', timeZone: 'UTC' },
    location: { displayName: '14 rue de Valadon, 75007 Paris' },
  });
});

test("creerEvenement omet location quand lieuLibelle n'est pas fourni", async (t) => {
  let corpsEnvoye;
  const client = creerClientMock({
    'POST /users/formation@accecit.com/events': {
      valeur: { id: 'outlook-evenement-def' },
      capture: ({ corps }) => {
        corpsEnvoye = corps;
      },
    },
  });
  const service = chargerServiceAvecClient(t, client);

  await service.creerEvenement('formation@accecit.com', {
    sujet: 'Test',
    debutIso: '2026-09-01T10:00:00.000Z',
    finIso: '2026-09-01T11:00:00.000Z',
    participantEmail: 'formateur@accecit.test',
  });

  assert.equal('location' in corpsEnvoye, false);
});

test('creerEvenement traduit une erreur 403 en citant la permission Calendars.ReadWrite', async (t) => {
  const client = creerClientMock({
    'POST /users/formation@accecit.com/events': { erreur: { statusCode: 403, code: 'ErrorAccessDenied' } },
  });
  const service = chargerServiceAvecClient(t, client);

  await assert.rejects(
    () =>
      service.creerEvenement('formation@accecit.com', {
        sujet: 'Test',
        debutIso: '2026-09-01T10:00:00.000Z',
        finIso: '2026-09-01T11:00:00.000Z',
        participantEmail: 'formateur@accecit.test',
      }),
    /Permissions Microsoft Graph insuffisantes.*"Calendars\.ReadWrite"/s,
  );
});

test('supprimerEvenement appelle bien DELETE sur événement du calendrier concerné', async (t) => {
  let appele = false;
  const client = creerClientMock({
    'DELETE /users/formation@accecit.com/events/outlook-evenement-abc': {
      valeur: undefined,
      capture: () => {
        appele = true;
      },
    },
  });
  const service = chargerServiceAvecClient(t, client);

  await service.supprimerEvenement('formation@accecit.com', 'outlook-evenement-abc');

  assert.equal(appele, true);
});

// Même principe que graphUploadFichier.js/azureOneDriveConnector.js ("item déjà absent (404) comme
// un succès") : l'événement a pu être supprimé manuellement dans Outlook entre-temps, ça ne doit
// jamais faire échouer l'appelant (voir rendezvousService.creerRendezvous, suppression best-effort
// de l'ancien événement lors d'une replanification).
test('supprimerEvenement traite un 404 (événement déjà absent) comme un succès, pas une erreur', async (t) => {
  const client = creerClientMock({
    'DELETE /users/formation@accecit.com/events/outlook-evenement-abc': { erreur: { statusCode: 404 } },
  });
  const service = chargerServiceAvecClient(t, client);

  await service.supprimerEvenement('formation@accecit.com', 'outlook-evenement-abc');
  // Ne lève pas — c'est l'assertion.
});

test('supprimerEvenement traduit une erreur 403 en citant la permission Calendars.ReadWrite', async (t) => {
  const client = creerClientMock({
    'DELETE /users/formation@accecit.com/events/outlook-evenement-abc': { erreur: { statusCode: 403 } },
  });
  const service = chargerServiceAvecClient(t, client);

  await assert.rejects(
    () => service.supprimerEvenement('formation@accecit.com', 'outlook-evenement-abc'),
    /Permissions Microsoft Graph insuffisantes.*"Calendars\.ReadWrite"/s,
  );
});
