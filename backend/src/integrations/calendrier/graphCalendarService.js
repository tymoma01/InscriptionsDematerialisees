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

// Créneaux occupés du calendrier départemental, filtrés sur LA PERSONNE précise (organisateur ou
// participant identifié par email) — le calendrier lui-même est partagé par département (voir
// CALENDRIER_PAR_ROLE ci-dessus), mais la vérification de disponibilité reste scopée à un seul
// formateur/inspecteur, cohérent avec CAPACITE_MAX_FORMATEUR_PAR_CRENEAU côté Neon (décision
// utilisateur, 2026-08-26) : un créneau déjà occupé par un AUTRE formateur du même département ne
// doit pas apparaître occupé ici. Suppose que creerEvenement (plus bas) ajoute toujours la
// personne en `attendees` — c'est ce filtre qui en dépend pour les créations futures.
// `Prefer: outlook.timezone="UTC"` explicite plutôt que de compter sur le défaut Graph (UTC sans
// header, mais non garanti selon la version d'API) : dateTime renvoyé sans suffixe de fuseau,
// toujours interprété comme UTC ici.
async function obtenirDisponibilites(emailCalendrier, emailPersonne, dateDebutIso, dateFinIso) {
  const client = await graphClient.obtenirClientGraph();
  let reponse;
  try {
    reponse = await client
      .api(`/users/${emailCalendrier}/calendarView`)
      .header('Prefer', 'outlook.timezone="UTC"')
      .query({ startDateTime: dateDebutIso, endDateTime: dateFinIso })
      .select('start,end,organizer,attendees')
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

  const emailPersonneMinuscule = emailPersonne.toLowerCase();
  return (reponse.value ?? [])
    .filter((evenement) => {
      const organisateur = evenement.organizer?.emailAddress?.address?.toLowerCase();
      const participants = (evenement.attendees ?? [])
        .map((participant) => participant.emailAddress?.address?.toLowerCase())
        .filter(Boolean);
      return organisateur === emailPersonneMinuscule || participants.includes(emailPersonneMinuscule);
    })
    .map((evenement) => ({
      debut: `${evenement.start.dateTime}Z`,
      fin: `${evenement.end.dateTime}Z`,
    }));
}

// Crée l'événement réel sur le calendrier départemental — `participantEmail`/`participantNom`
// ajoutés en `attendees` (jamais en `organizer`, que Graph impose de toute façon comme la boîte
// propriétaire en contexte App-only) : c'est ce champ que obtenirDisponibilites ci-dessus relit
// pour identifier les créneaux occupés PAR CETTE PERSONNE précise sur les lectures futures. Ajouter
// un attendee déclenche l'envoi natif d'une invitation Outlook standard à `participantEmail` (via
// Exchange, pas via notre propre envoi d'email) — effet secondaire attendu : le formateur/
// inspecteur voit aussi ce rendez-vous apparaître directement dans SON propre calendrier Outlook,
// en plus du calendrier départemental partagé.
async function creerEvenement(emailCalendrier, { sujet, corps, debutIso, finIso, lieuLibelle, participantEmail, participantNom }) {
  const client = await graphClient.obtenirClientGraph();
  const payload = {
    subject: sujet,
    body: { contentType: 'HTML', content: corps ?? '' },
    start: { dateTime: versDateTimeGraphUtc(debutIso), timeZone: 'UTC' },
    end: { dateTime: versDateTimeGraphUtc(finIso), timeZone: 'UTC' },
    attendees: [{ emailAddress: { address: participantEmail, name: participantNom }, type: 'required' }],
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
