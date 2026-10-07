// Contrainte CHECK sur `demandes_dpae.statut` : la colonne était une simple chaîne sans garde-fou
// (migration 066, 070). Les quatre codes ci-dessous sont ceux de core/dpae/statutsDpae.js ; ils
// sont recopiés ici volontairement — une migration reste figée, elle ne dépend pas du code courant.
// Ajouter un statut plus tard = nouvelle migration qui remplace cette contrainte.
const NOM_CONTRAINTE = 'demandes_dpae_statut_check';
const STATUTS = ['envoyee', 'en_attente', 'validee', 'rejetee'];

// Littéraux inlinés : PostgreSQL n'accepte pas de paramètres liés dans un ALTER TABLE.
exports.up = (knex) =>
  knex.raw(`ALTER TABLE demandes_dpae ADD CONSTRAINT ${NOM_CONTRAINTE} CHECK (statut IN (${STATUTS.map((statut) => `'${statut}'`).join(', ')}))`);

exports.down = (knex) => knex.raw(`ALTER TABLE demandes_dpae DROP CONSTRAINT IF EXISTS ${NOM_CONTRAINTE}`);
