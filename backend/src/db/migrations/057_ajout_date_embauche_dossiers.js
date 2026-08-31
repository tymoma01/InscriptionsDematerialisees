// Date d'embauche (audit 2026-08-31, nouveau statut terminal "Embauché", après "Validé - prêt à
// l'embauche") — saisie manuelle par Accueil/Coordination ou Admin au moment de marquer un dossier
// comme effectivement embauché (voir core/dossier/embaucheService.js). Colonne dédiée plutôt qu'un
// simple commentaire de transition en texte libre : exploitable directement pour un futur
// indicateur "délai prêt à l'embauche → embauché" (voir audit du tableau de bord, 2026-08-31).
//
// `date` (pas timestamptz) : même convention que candidats.date_naissance (migration 008) — une
// date calendaire choisie via un sélecteur (<input type="date">), sans notion d'heure. Nullable :
// vide pour tout dossier n'ayant jamais atteint ce statut.
exports.up = (knex) =>
  knex.schema.alterTable('dossiers', (table) => {
    table.date('date_embauche').nullable();
  });

exports.down = (knex) =>
  knex.schema.alterTable('dossiers', (table) => {
    table.dropColumn('date_embauche');
  });
