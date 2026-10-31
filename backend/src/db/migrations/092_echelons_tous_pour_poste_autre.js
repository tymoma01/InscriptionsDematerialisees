// Le poste « autre » propose tous les échelons de l'entité : déclaré dans `dpae_config`
// (`postes_tous_echelons`), l'union étant calculée par core/dpae/echelonsDpae.js.
exports.up = (knex) =>
  knex.raw(
    `UPDATE entites
        SET dpae_config = dpae_config || '{"postes_tous_echelons": ["autre"]}'::jsonb
      WHERE code = 'accecit'`,
  );

exports.down = (knex) =>
  knex.raw(`UPDATE entites SET dpae_config = dpae_config - 'postes_tous_echelons' WHERE code = 'accecit'`);
