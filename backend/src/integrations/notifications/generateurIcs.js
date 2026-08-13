const { createEvent } = require('ics');

// Durée par défaut d'un créneau de test (décision 2026-07-30) : rendezvous.date_heure ne porte
// qu'un instant de départ, aucune donnée de fin/durée n'existe sur ce modèle — à ajuster si le
// besoin d'une durée variable par test se confirme un jour (table rendezvous à faire évoluer).
const DUREE_TEST_MINUTES = 60;

// Adresse ACCECIT déjà affichée en pied de page du back-office (voir PageBackOffice.jsx) —
// aucune donnée "lieu" dédiée n'existe aujourd'hui (ni sur `rendezvous`, ni sur `entites`, voir
// docs/architecture-technique.md) : à faire évoluer vers un champ de config par entité si
// Adaptel a un jour besoin d'une adresse différente pour ses propres tests.
const LIEU_TEST_ACCECIT = '47 avenue Paul Vaillant Couturier, 94250 Gentilly';

// Compose "adresse (metroAcces)" quand l'accès est renseigné, l'adresse seule sinon — réutilisée
// pour `location` ci-dessous ET pour le SMS (invitationTestService.js/
// notificationChangementLieuService.js, voir construireMessageSms) : SMS et .ics restent
// volontairement plus courts que l'email, qui seul inclut aussi `instructions` (voir
// formatageEmail.formaterLignesLieuHtml) — arbitrage acté lors du passage aux champs structurés
// (migration 047, audit du 2026-08-13).
function composerAdresseCourte({ adresse, metroAcces }) {
  return metroAcces ? `${adresse} (${metroAcces})` : adresse;
}

// Décompose une date en ses composants UTC (année, mois, jour, heure, minute) — la version
// précédente décomposait en composants Europe/Paris "muets" (startOutputType: 'local'), ce qui
// produit en ICS une heure dite "flottante" (DTSTART:20990615T110000, SANS suffixe Z ni TZID —
// vérifié en inspectant la sortie brute de `ics`). Une heure flottante n'a pas de fuseau associé :
// chaque client calendrier l'interprète dans SON PROPRE fuseau local, pas Europe/Paris — un
// candidat dont le téléphone n'est pas réglé sur l'heure de Paris aurait vu un horaire de
// convocation faux, silencieusement, sans aucune erreur. `ics` ne propose que 'local' (flottant)
// ou 'utc' (Z, instant absolu) comme startOutputType — pas de TZID/VTIMEZONE dans cette version de
// la lib (voir node_modules/ics/index.d.ts) — 'utc' est donc le seul mode qui garantisse le même
// instant réel quel que soit le fuseau du client, chacun l'affichant converti dans son propre
// fuseau (comportement standard des invitations Zoom/Google Meet). Le texte du SMS/email (voir
// invitationTestService.js, FORMAT_DATE_HEURE) continue lui d'afficher explicitement l'heure de
// Paris en toutes lettres — ces deux mécanismes sont indépendants et ne doivent pas être confondus.
function composantsDateUtc(date) {
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes()];
}

// Génère le contenu texte d'un fichier .ics pour la convocation au test (voir
// invitationTestService.js) — et pour toute notification qui doit REFLÉTER une mise à jour du
// même rendez-vous (voir notificationChangementLieuService.js, changement de lieu) plutôt que
// créer un doublon dans le calendrier du destinataire.
//
// candidatEmail : toujours fourni en pratique (voir invitationTestService.js, l'envoi lui-même
// est déjà conditionné à sa présence) — reste optionnel ici pour que ce générateur ne partage pas
// cette règle avec son appelant (voir Modularité, CLAUDE.md : un module générique ne décide pas
// à la place de l'appelant si un envoi doit avoir lieu, il décrit juste le fichier).
//
// formateurNom/formateurPrenom/formateurEmail : absents pour un rendez-vous pas encore assigné à
// un formateur/inspecteur (`rendezvous.formateur_id` nullable, voir migration 018) — l'appelant
// ne les fournit alors simplement pas, cette fonction n'a besoin d'aucune logique conditionnelle
// supplémentaire pour ce cas.
//
// lieuAdresse/lieuMetroAcces : champs structurés du lieu réellement choisi sur le rendez-vous
// (`rendezvous.lieu_id`, table `lieux`, migrations 044/045/047) — résolus une seule fois par
// l'appelant (voir invitationTestService.js) et transmis tels quels ici. `instructions` n'est
// volontairement PAS repris dans `location` (arbitrage : SMS/.ics limités à adresse+metroAcces,
// voir composerAdresseCourte ci-dessus — seul l'email HTML inclut aussi les instructions). Repli
// défensif sur LIEU_TEST_ACCECIT si `lieuAdresse` absent : ce générateur reste utilisable seul
// (voir generateurIcs.test.js), sans dépendre de ce que fait précisément son unique appelant
// actuel.
//
// rendezvousId : sert à dériver un UID iCalendar STABLE (RFC 5545 — un événement se met à jour
// dans le calendrier du destinataire uniquement si le second .ics envoyé porte le MÊME UID que le
// premier ; sans ça, chaque appel génère un UID aléatoire — voir eventDefaults dans `ics`, nanoid()
// — et un client calendrier (Outlook, Google Calendar) importe l'.ics suivant comme un DEUXIÈME
// événement séparé plutôt que de mettre à jour le premier). Optionnel : si absent, `createEvent`
// retombe sur son UID aléatoire par défaut — un appelant qui n'a jamais besoin de régénérer cet
// .ics pour le même rendez-vous (aucun cas de ce genre avant notificationChangementLieuService.js)
// n'a pas à s'en soucier.
//
// sequence : à incrémenter (0 -> 1 -> ...) à chaque régénération d'un .ics pour un rendez-vous déjà
// notifié une première fois — c'est ce compteur, en plus de l'UID identique, qui indique au client
// calendrier qu'il s'agit d'une mise à jour plus récente plutôt que d'un doublon ou d'une version
// obsolète reçue en retard. Absent (undefined) pour la toute première convocation d'un rendez-vous
// (voir invitationTestService.js) : RFC 5545 traite un SEQUENCE omis comme 0, la valeur initiale.
function genererIcsInvitationTest({
  dateHeure,
  candidatNom,
  candidatPrenom,
  candidatEmail,
  formateurNom,
  formateurPrenom,
  formateurEmail,
  lieuAdresse,
  lieuMetroAcces,
  rendezvousId,
  sequence,
}) {
  const attendees = [];
  if (candidatEmail) {
    attendees.push({
      name: `${candidatPrenom} ${candidatNom}`,
      email: candidatEmail,
      role: 'REQ-PARTICIPANT',
      partstat: 'NEEDS-ACTION',
      rsvp: true,
    });
  }
  if (formateurEmail) {
    attendees.push({
      name: `${formateurPrenom} ${formateurNom}`,
      email: formateurEmail,
      role: 'REQ-PARTICIPANT',
      partstat: 'NEEDS-ACTION',
      rsvp: true,
    });
  }

  // `ics` (createEvent) plante si `uid`/`sequence` sont présents dans l'objet d'attributs avec la
  // valeur `undefined` (vérifié : removeUndefined, dans ics/dist/pipeline/build.js, retire alors
  // la clé — y compris la valeur par défaut déjà posée par eventDefaults() juste avant — et
  // format.js tente ensuite un .replace() sur ce uid devenu absent, TypeError). Ces deux clés ne
  // doivent donc être présentes DANS L'OBJET que quand elles ont une vraie valeur, jamais posées à
  // `undefined` à la place d'omises.
  const optionsRendezvous = {};
  if (rendezvousId) {
    // Format resemblant un identifiant d'email (convention iCalendar usuelle pour un UID lisible/
    // debuggable), pas une adresse réellement destinée à recevoir du courrier — voir commentaire
    // rendezvousId plus haut pour le rôle de ce champ.
    optionsRendezvous.uid = `rendezvous-${rendezvousId}@accecit.com`;
  }
  if (sequence !== undefined) {
    optionsRendezvous.sequence = sequence;
  }

  const { error, value } = createEvent({
    start: composantsDateUtc(new Date(dateHeure)),
    startInputType: 'utc',
    startOutputType: 'utc',
    duration: { minutes: DUREE_TEST_MINUTES },
    title: 'Test ACCECIT',
    description: `Convocation au test ACCECIT pour ${candidatPrenom} ${candidatNom}.`,
    location: composerAdresseCourte({ adresse: lieuAdresse ?? LIEU_TEST_ACCECIT, metroAcces: lieuMetroAcces }),
    status: 'CONFIRMED',
    ...optionsRendezvous,
    // Pas d'email ORGANIZER : aucune adresse d'expédition ACCECIT n'est à ce jour documentée nulle
    // part dans le projet (voir docs/architecture-technique.md, point ouvert remonté séparément) —
    // et la librairie `ics` émet une ligne ORGANIZER invalide (`ORGANIZER;CN=ACCECIT` sans valeur
    // après les deux-points) si `organizer.email` est omis (voir node_modules/ics/dist/utils/
    // set-organizer.js : le "MAILTO:" ne s'ajoute que si `email` est fourni). Omettre complètement
    // `organizer` plutôt que publier une ligne mal formée : RFC 5545 ne le rend obligatoire que
    // pour une invitation envoyée en tant que demande de planification (METHOD:REQUEST, non
    // utilisé ici, voir createEvent ci-dessus qui n'en définit aucun), pas pour un simple fichier
    // joint. À réintroduire (`organizer: { name: 'ACCECIT', email: ... }`) une fois cette adresse
    // tranchée.
    attendees: attendees.length > 0 ? attendees : undefined,
  });

  if (error) {
    throw error;
  }
  return value;
}

module.exports = { genererIcsInvitationTest, composerAdresseCourte, DUREE_TEST_MINUTES, LIEU_TEST_ACCECIT };
