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

// Décompose une date en ses composants Europe/Paris (année, mois, jour, heure, minute) — jamais
// les composants UTC bruts d'un serveur qui pourrait tourner dans un autre fuseau, même principe
// que anneeMoisParis dans azureOneDriveConnector.js. `ics` restitue ensuite ces composants tels
// quels dans le fichier généré (startInputType/startOutputType 'local' ci-dessous) : l'heure
// affichée dans le calendrier du candidat est directement celle de Paris, sans conversion.
function composantsDateParis(date) {
  const parties = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const valeur = (type) => Number(parties.find((partie) => partie.type === type).value);
  return [valeur('year'), valeur('month'), valeur('day'), valeur('hour'), valeur('minute')];
}

// Génère le contenu texte d'un fichier .ics pour la convocation au test (voir
// invitationTestService.js) — À VÉRIFIER dans un vrai client (Outlook/Google Calendar) avant mise
// en production : la gestion des fuseaux horaires en ICS est notoirement piégeuse, ce fichier n'a
// jamais été testé contre un client réel.
function genererIcsInvitationTest({ dateHeure, candidatNom, candidatPrenom }) {
  const { error, value } = createEvent({
    start: composantsDateParis(new Date(dateHeure)),
    startInputType: 'local',
    startOutputType: 'local',
    duration: { minutes: DUREE_TEST_MINUTES },
    title: 'Test ACCECIT',
    description: `Convocation au test ACCECIT pour ${candidatPrenom} ${candidatNom}.`,
    location: LIEU_TEST_ACCECIT,
    status: 'CONFIRMED',
    organizer: { name: 'ACCECIT' },
  });

  if (error) {
    throw error;
  }
  return value;
}

module.exports = { genererIcsInvitationTest, DUREE_TEST_MINUTES, LIEU_TEST_ACCECIT };
