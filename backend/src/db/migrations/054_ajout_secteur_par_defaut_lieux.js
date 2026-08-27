// Lieu par défaut selon le secteur du dossier (Bureau/Hôtel) — audit 2026-08-27, demande
// utilisateur : ModalePlanificationTest.jsx connaît déjà `secteurDossier` ('bureau'/'hotel', voir
// son commentaire — dérivé des postes déclarés, littéraux déjà en dur ailleurs dans le moteur,
// voir rendezvousService.js) mais ne pouvait jusqu'ici présélectionner aucun lieu : `lieux`
// (migration 044) n'avait ni notion de secteur, ni de lieu "par défaut".
//
// `secteur` : varchar nullable, mêmes valeurs 'bureau'/'hotel' que le reste du moteur — pas un
// nouveau concept générique porté par la config d'entité (voir Modularité, CLAUDE.md) : ce projet
// accepte déjà ce niveau de littéral en dur pour ces deux valeurs précises (rendezvousService.js,
// ModalePlanificationTest.jsx), ajouter ici une abstraction de secteur configurable irait au-delà
// de ce qui est demandé. Nullable : un lieu peut très bien ne servir de défaut à aucun secteur
// (cas normal pour tout lieu créé sans cocher la case dédiée, voir ModalePlanificationTest.jsx).
//
// `par_defaut` : booléen, défaut false — un seul lieu par_defaut=true par (entite_id, secteur) à
// la fois, contrainte posée ICI en base (index unique partiel, ne porte que sur les lignes
// par_defaut=true) en plus de la bascule applicative (lieuRepository.definirLieuParDefaut,
// transaction qui désactive l'ancien défaut avant d'activer le nouveau) — même principe défense en
// profondeur que d'autres contraintes métier de ce projet déjà doublées d'un index/contrainte SQL
// plutôt que laissées au seul code applicatif.
exports.up = async (knex) => {
  await knex.schema.alterTable('lieux', (table) => {
    table.string('secteur').nullable();
    table.boolean('par_defaut').notNullable().defaultTo(false);
  });
  await knex.raw(
    'CREATE UNIQUE INDEX idx_lieux_un_defaut_par_secteur ON lieux (entite_id, secteur) WHERE par_defaut = true',
  );
};

exports.down = async (knex) => {
  await knex.raw('DROP INDEX IF EXISTS idx_lieux_un_defaut_par_secteur');
  await knex.schema.alterTable('lieux', (table) => {
    table.dropColumn('secteur');
    table.dropColumn('par_defaut');
  });
};
