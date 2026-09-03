// Vérifie si l'heure actuelle à Paris tombe dans une fenêtre [cible, cible + toleranceMinutes)
// donnée (ex. 13h30 ±15 min) — utilisé par les scripts prod (scripts/executer*ToutesEntites.js,
// invoqués par un Azure Container Apps Job) pour les jobs sensibles à l'heure de la journée
// (rappel, sync calendrier). Le trigger Schedule d'Azure Container Apps Jobs tourne en cron UTC,
// sans notion de fuseau horaire ; plutôt que de figer un cron UTC (dérive silencieuse de ±1h à
// chaque changement d'heure été/hiver, à corriger à la main deux fois par an), le Job est déclenché
// plus souvent que nécessaire et c'est ce module, pas la configuration Azure, qui décide si le
// script doit réellement agir. Décision utilisateur, 2026-08-31.
function estDansLaFenetreHoraireParis(heureCible, minuteCible, toleranceMinutes = 15) {
  const maintenant = new Date();
  const parties = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(maintenant);

  const heure = Number(parties.find((partie) => partie.type === 'hour').value);
  const minute = Number(parties.find((partie) => partie.type === 'minute').value);

  const minutesEcoulees = heure * 60 + minute;
  const minutesCible = heureCible * 60 + minuteCible;

  return minutesEcoulees >= minutesCible && minutesEcoulees < minutesCible + toleranceMinutes;
}

// Variante "toutes les heures" : vrai si on est dans les `toleranceMinutes` premières minutes de
// N'IMPORTE QUELLE heure (Europe/Paris) — pour un job dont la cadence métier est "chaque heure",
// pas un horaire précis dans la journée (voir executerSyncCalendrierManuelToutesEntites.js).
// Même principe que estDansLaFenetreHoraireParis ci-dessus (le Job Azure tourne en cron UTC sans
// fuseau horaire et est déclenché plus souvent que nécessaire, ex. */15 * * * *), mais sans
// heureCible puisque toutes les heures sont valides.
function estDansLesPremieresMinutesDeLHeureParis(toleranceMinutes = 15) {
  const maintenant = new Date();
  const minute = Number(
    new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', minute: '2-digit' })
      .formatToParts(maintenant)
      .find((partie) => partie.type === 'minute').value,
  );

  return minute < toleranceMinutes;
}

module.exports = { estDansLaFenetreHoraireParis, estDansLesPremieresMinutesDeLHeureParis };
