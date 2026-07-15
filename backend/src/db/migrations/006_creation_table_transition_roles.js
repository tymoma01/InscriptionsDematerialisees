exports.up = (knex) =>
  knex.schema.createTable('transition_roles', (table) => {
    table.integer('transition_id').notNullable().references('id').inTable('transitions_statut');
    table.integer('role_id').notNullable().references('id').inTable('roles');
    table.primary(['transition_id', 'role_id']);
  });

exports.down = (knex) => knex.schema.dropTableIfExists('transition_roles');
