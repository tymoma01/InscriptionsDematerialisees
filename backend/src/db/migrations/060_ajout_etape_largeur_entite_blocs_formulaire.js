// `etape` (regroupement de blocs affichés ensemble sur une même page du parcours d'inscription)
// et `largeur` ('moitie' | absent = pleine largeur) — jusqu'ici codées en dur côté front
// (formulaireConfig.accecit.js), manquantes à la création de la table (migration 012) pour que
// entite_blocs_formulaire porte tout ce dont useFormulaireInscription.js a besoin, pas seulement
// actif/ordre. Colonnes dédiées plutôt qu'ajoutées dans `config` (JSONB) : même statut que `ordre`
// déjà présent, ce sont des propriétés de mise en page communes à tout bloc, pas des overrides
// métier ponctuels (voir architecture-technique.md §1.4, `config` réservé aux champs
// obligatoires/libellés surchargés). `etape` defaultTo(1) uniquement pour satisfaire notNullable
// si des lignes existaient déjà (table vide en prod à ce jour) — sans conséquence réelle.
exports.up = (knex) =>
  knex.schema.alterTable('entite_blocs_formulaire', (table) => {
    table.integer('etape').notNullable().defaultTo(1);
    table.string('largeur').nullable();
  });

exports.down = (knex) =>
  knex.schema.alterTable('entite_blocs_formulaire', (table) => {
    table.dropColumn('etape');
    table.dropColumn('largeur');
  });
