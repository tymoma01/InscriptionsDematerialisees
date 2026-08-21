// Ajoute `smartof_config` sur `entites` — configuration libre (JSON) propre à l'intégration
// SmartOF pour une entité donnée, à commencer par la correspondance rôle -> customId d'entreprise
// SmartOF (`entreprises_par_role`, ex. { "formateur": "ENT-0003", "inspecteur": "ENT-0002" },
// décision utilisateur 2026-08-21) : quelle "Entreprise" SmartOF lier à l'apprenant créé selon le
// rôle de l'agent qui valide le test (voir integrations/smartof/smartOfService.js). customId
// plutôt que le nom affiché de l'entreprise (choix révisé le 2026-08-21) : identifiant métier
// stable côté SmartOF, contrairement au nom qui peut être renommé sans que ça remonte ici — et
// plutôt que l'entrepriseUid (le vrai UUID SmartOF) lui-même, qui n'est jamais stocké côté ACCECIT
// (résolu à chaque envoi via /api/entreprise/list, voir smartOfService.js). jsonb plutôt qu'une
// nouvelle colonne dédiée par donnée (même choix que `connecteur_stockage`/`canal_rappel`,
// migration 001/030, mais ici la forme n'est pas une simple chaîne) : ce module d'intégration ne
// doit rien connaître d'ACCECIT en dur (voir Modularité, CLAUDE.md) — seule cette configuration,
// versionnée en base et propre à chaque entite_id, doit varier d'une entité à l'autre.
// Nullable/défaut '{}' : une entité sans SmartOF actif (`smartof_actif=false`) n'a besoin
// d'aucune valeur ici.
exports.up = (knex) =>
  knex.schema.alterTable('entites', (table) => {
    table.jsonb('smartof_config').notNullable().defaultTo('{}');
  });

exports.down = (knex) =>
  knex.schema.alterTable('entites', (table) => {
    table.dropColumn('smartof_config');
  });
