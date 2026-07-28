// Date du jour au format 'AAAA-MM-JJ', dans le fuseau Europe/Paris — jamais celui,
// potentiellement différent, de l'appareil de l'agent (voir
// backend/src/integrations/stockage/azureOneDriveConnector.js, anneeMoisParis, même technique
// via Intl.DateTimeFormat#formatToParts pour ne dépendre d'aucun format de locale fragile à
// parser). Comparable directement en chaîne avec les clés jour 'AAAA-MM-JJ' déjà utilisées par
// CalendrierDisponibiliteFormateur.jsx/ModalePlanificationTest.jsx : la comparaison lexicographique
// de deux dates ainsi formatées équivaut à leur comparaison chronologique.
export function dateDuJourParis(date = new Date()) {
  const parties = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const annee = parties.find((partie) => partie.type === 'year').value;
  const mois = parties.find((partie) => partie.type === 'month').value;
  const jour = parties.find((partie) => partie.type === 'day').value;
  return `${annee}-${mois}-${jour}`;
}
