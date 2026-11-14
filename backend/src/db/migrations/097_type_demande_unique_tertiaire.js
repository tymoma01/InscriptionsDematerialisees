// Formulaire DPAE du Tertiaire : un seul type de demande, « Nouvelle embauche », défini dans la configuration de
// l'entité (`entites.dpae_config.tertiaire.formulaire.types_demande`). Les demandes du Tertiaire déjà créées avec un
// autre type ne sont pas modifiées. Les types de l'Hôtellerie ne changent pas.
const TYPES_DEMANDE = [{ code: 'nouvelle_embauche', libelle: 'Nouvelle embauche' }];

// L'opérateur JSON « ? » est remplacé par jsonb_exists : knex.raw prend tout « ? » pour un paramètre.
exports.up = async (knex) => {
  await knex.raw(
    `UPDATE entites SET dpae_config = jsonb_set(dpae_config, '{tertiaire,formulaire,types_demande}', ?::jsonb, true)
      WHERE code = 'accecit' AND jsonb_exists(dpae_config, 'tertiaire')`,
    [JSON.stringify(TYPES_DEMANDE)],
  );
};

exports.down = async (knex) => {
  await knex.raw(`UPDATE entites SET dpae_config = dpae_config #- '{tertiaire,formulaire,types_demande}' WHERE code = 'accecit' AND jsonb_exists(dpae_config, 'tertiaire')`);
};

exports.TYPES_DEMANDE = TYPES_DEMANDE;
