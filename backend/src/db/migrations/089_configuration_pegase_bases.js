// Bases Pégase d'ACCECIT :
// - Tertiaire : agence ACCECIT TERTIAIRE (id "1", celle de la quasi-totalité des salariés de cette
//   base), pièces rangées en « Dossier Administratif ACCECIT » (AGE), cette base n'ayant pas de type
//   « Dossier salarié ».
// - Choix de la base par le type de poste recherché à l'inscription (Bureau → Tertiaire, Hôtel →
//   Hôtellerie), obligatoire pour tout candidat : plus de base par défaut, qui envoyait vers
//   l'Hôtellerie toute demande DPAE sans Entité (voir pegaseSalarieService.choisirBase).
const modifier = (knex, { agence, codeTypeDocument, baseParTypePoste, baseParDefaut }) =>
  knex.raw(
    `UPDATE entites
        SET pegase_config = jsonb_set(
              jsonb_set(pegase_config, '{bases,tertiaire,agence}', ?::jsonb),
              '{bases,tertiaire,code_type_document}', ?::jsonb)
            - 'base_par_type_poste' - 'base_par_defaut'
            || jsonb_strip_nulls(jsonb_build_object('base_par_type_poste', ?::jsonb, 'base_par_defaut', ?::jsonb))
      WHERE code = 'accecit' AND pegase_config #> '{bases,tertiaire}' IS NOT NULL`,
    [JSON.stringify(agence), JSON.stringify(codeTypeDocument), JSON.stringify(baseParTypePoste), JSON.stringify(baseParDefaut)],
  );

exports.up = (knex) =>
  modifier(knex, { agence: '1', codeTypeDocument: 'AGE', baseParTypePoste: { bureau: 'tertiaire', hotel: 'hotellerie' }, baseParDefaut: null });

exports.down = (knex) => modifier(knex, { agence: null, codeTypeDocument: null, baseParTypePoste: null, baseParDefaut: 'hotellerie' });
