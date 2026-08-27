// Réutilise l'authentification Graph déjà en place pour SharePoint/OneDrive et l'envoi d'email
// (même app registration, mêmes secrets Key Vault graph-client-id/graph-client-secret/
// graph-tenant-id) — dupliquer la récupération des secrets/le ClientSecretCredential ici referait
// exactement ce que graphClient.js fait déjà (voir aussi graphMailProvider.js, même pattern).
// Nécessite d'ajouter la permission d'application "Calendars.ReadWrite" (consentement admin) à
// cette app registration — déjà accordée et testée côté Microsoft 365 (audit 2026-08-26), un 403
// éventuel ici est donc un bug d'appel, pas un défaut de permission.
// Non déstructuré exprès, même raison que graphMailProvider.js : les tests mockent
// `graphClient.obtenirClientGraph` via `t.mock.method`, qui ne fonctionne que si l'appel passe
// par la propriété du module (une déstructuration figerait la référence dès le require).
const graphClient = require('../stockage/graphClient');
const { traduireErreurGraph } = require('../stockage/erreursGraph');

const PERMISSION_GRAPH_CALENDRIER = 'Calendars.ReadWrite';

// Calendriers départementaux partagés ACCECIT (décision actée, audit 2026-08-26) : les tests
// Inspecteur (postes bureau) et Formateur (postes hôtel) sont routés vers deux calendriers
// distincts, jamais la boîte personnelle de chaque formateur/inspecteur. En dur ici, comme
// BOITE_EXPEDITRICE dans graphMailProvider.js : si une future entité utilise elle aussi Microsoft
// Graph pour ses calendriers de test avec un autre routage, en faire une valeur de configuration
// par entité plutôt que d'ajouter un branchement ici (voir Modularité, CLAUDE.md — ce module
// reste, comme rendezvousService.js qui l'appelle, volontairement "ACCECIT-flavored").
const CALENDRIER_PAR_ROLE = {
  formateur: 'formation@accecit.com',
  inspecteur: 'tertiaire2@accecit.com',
};

function resoudreCalendrierParRole(roleCode) {
  const email = CALENDRIER_PAR_ROLE[roleCode];
  if (!email) {
    throw new Error(`Aucun calendrier Outlook configuré pour le rôle "${roleCode}".`);
  }
  return email;
}

// Graph attend un datetime SANS suffixe de fuseau dans le corps de dateTimeTimeZone (le fuseau est
// porté séparément par le champ `timeZone`, toujours 'UTC' ici) — contrairement à un ISO complet
// avec offset utilisé partout ailleurs dans ce projet (ex. rendezvous.date_heure). `dateIso` reçu
// ici est un ISO complet (avec offset ou 'Z') ; on le fait transiter par un objet Date pour repartir
// d'une représentation UTC propre, puis on retire le seul 'Z' que toISOString() ajoute.
function versDateTimeGraphUtc(dateIso) {
  return new Date(dateIso).toISOString().replace('Z', '');
}

// Tous les événements du calendrier départemental sur la plage demandée — le calendrier hebdomadaire
// (CalendrierHebdomadaireDisponibilite.jsx) est purement informatif depuis l'audit 2026-08-26 (ne
// bloque plus aucune sélection, voir `desactive` côté front), donc plus de filtrage par personne
// ici : un calendrier partagé par département doit refléter TOUTE l'activité du département, pas
// seulement celle du formateur/inspecteur actuellement sélectionné dans le dropdown. Filtrage par
// organisateur/participant retiré le même jour (audit complémentaire) — c'était la cause du bug
// "rien ne s'affiche" pour un inspecteur/formateur donné : les événements réels du calendrier
// partagé (créés directement dans Outlook par l'équipe, ex. "MEP TOM Ford", "CROUS DAVIEL") ont pour
// organisateur la boîte départementale elle-même et pour attendees des collègues divers — jamais la
// personne précise sélectionnée côté app — donc l'ancien filtre organisateur===personne||
// attendees.includes(personne) excluait systématiquement tout, même quand Graph renvoyait bien des
// événements (vérifié par appel direct à calendarView : 18 événements bruts sur tertiaire2@accecit.com
// pour la semaine du 24/08, tous éliminés par ce filtre).
// `Prefer: outlook.timezone="UTC"` explicite plutôt que de compter sur le défaut Graph (UTC sans
// header, mais non garanti selon la version d'API) : dateTime renvoyé sans suffixe de fuseau,
// toujours interprété comme UTC ici.
async function obtenirDisponibilites(emailCalendrier, dateDebutIso, dateFinIso) {
  let reponse;
  try {
    // `obtenirClientGraph()` inclus dans ce try (audit 2026-08-27, pas seulement l'appel
    // `.get()` plus bas) : la construction du client va chercher les secrets Key Vault puis
    // acquiert un token Microsoft, deux appels réseau qui peuvent échouer avec le même genre
    // d'erreur réseau (timeout, hôte injoignable) qu'un échec de `calendarView` lui-même — les
    // deux méritent la même traduction en message métier lisible plutôt qu'une erreur technique
    // brute remontée telle quelle jusqu'à rendezvousService/l'API.
    const client = await graphClient.obtenirClientGraph();
    reponse = await client
      .api(`/users/${emailCalendrier}/calendarView`)
      .header('Prefer', 'outlook.timezone="UTC"')
      .query({ startDateTime: dateDebutIso, endDateTime: dateFinIso })
      .select('start,end,subject,isAllDay')
      // Volume hebdomadaire par département largement sous cette limite en pratique (quelques
      // dizaines de tests/semaine au plus) — pas de gestion de pagination (@odata.nextLink) ici,
      // à revisiter si ce volume change significativement.
      .top(250)
      .get();
  } catch (erreur) {
    throw traduireErreurGraph(erreur, `lecture du calendrier "${emailCalendrier}"`, {
      permission: PERMISSION_GRAPH_CALENDRIER,
    });
  }

  // `subject` peut être absent/vide (événement privé, ou champ jamais renseigné côté Outlook) —
  // le repli ("Occupé") est décidé côté front (CalendrierHebdomadaireDisponibilite.jsx), pas ici :
  // ce service reste une transcription fidèle de ce que Graph renvoie, `sujet` peut donc valoir
  // `null`. `journeeEntiere` (renommé depuis `isAllDay` Graph, convention française du projet) :
  // permet au front de regrouper ces événements dans un bandeau dédié plutôt que de les répéter sur
  // chaque créneau de 15 min de la journée (audit lisibilité 2026-08-26).
  return (reponse.value ?? []).map((evenement) => ({
    debut: `${evenement.start.dateTime}Z`,
    fin: `${evenement.end.dateTime}Z`,
    sujet: evenement.subject || null,
    journeeEntiere: evenement.isAllDay === true,
  }));
}

// Crée l'événement réel sur le calendrier départemental — jamais d'`attendees` (audit 2026-08-28,
// corrige une double notification) : le calendrier cible (formation@/tertiaire2@) appartient déjà
// au département concerné, l'événement y est créé directement, aucun participant à inviter. Un
// `attendee` sur ce payload déclenchait l'envoi natif d'une invitation Outlook standard au
// formateur/inspecteur (boutons Accepté/À confirmer/Refusé/Proposer un nouvel horaire) EN PLUS de
// notre propre email personnalisé ("Nouveau candidat à évaluer", voir invitationTestService.js) —
// et son équivalent "Annulé : ..." lors de la suppression de l'événement au moment d'une
// replanification (voir supprimerEvenement plus bas, appelé par rendezvousService.js) : deux
// notifications pour une seule action, dont une jamais voulue. `participantEmail` conservé
// uniquement pour identifier la personne dans le message d'erreur ci-dessous en cas d'échec —
// `organizer` reste de toute façon imposé par Graph comme la boîte départementale elle-même en
// contexte App-only, jamais modifiable ici.
async function creerEvenement(emailCalendrier, { sujet, corps, debutIso, finIso, lieuLibelle, participantEmail }) {
  const client = await graphClient.obtenirClientGraph();
  const payload = {
    subject: sujet,
    body: { contentType: 'HTML', content: corps ?? '' },
    start: { dateTime: versDateTimeGraphUtc(debutIso), timeZone: 'UTC' },
    end: { dateTime: versDateTimeGraphUtc(finIso), timeZone: 'UTC' },
  };
  if (lieuLibelle) {
    payload.location = { displayName: lieuLibelle };
  }

  try {
    return await client.api(`/users/${emailCalendrier}/events`).post(payload);
  } catch (erreur) {
    throw traduireErreurGraph(erreur, `création de l'événement pour "${participantEmail}"`, {
      permission: PERMISSION_GRAPH_CALENDRIER,
    });
  }
}

// Libère le créneau lors d'une replanification (voir rendezvousService.creerRendezvous, corrige la
// fuite identifiée à l'audit du 2026-08-26 : sans cet appel, l'ancien événement restait occupé
// indéfiniment sur le calendrier départemental même une fois le rendez-vous Neon neutralisé).
// 404 traité comme un succès (même principe que graphUploadFichier.js/azureOneDriveConnector.js,
// "item déjà absent") : l'événement a pu être supprimé manuellement dans Outlook entre-temps, ça
// ne doit jamais faire échouer la nouvelle planification déjà confirmée par ailleurs.
async function supprimerEvenement(emailCalendrier, outlookEventId) {
  const client = await graphClient.obtenirClientGraph();
  try {
    await client.api(`/users/${emailCalendrier}/events/${outlookEventId}`).delete();
  } catch (erreur) {
    if (erreur?.statusCode === 404) return;
    throw traduireErreurGraph(erreur, `suppression de l'événement "${outlookEventId}"`, {
      permission: PERMISSION_GRAPH_CALENDRIER,
    });
  }
}

module.exports = {
  CALENDRIER_PAR_ROLE,
  resoudreCalendrierParRole,
  obtenirDisponibilites,
  creerEvenement,
  supprimerEvenement,
};
