const crypto = require('crypto');

// Vérification d'unicité NIR/email à l'inscription (voir dossierService.inscrireCandidat) :
// - email dénormalisé depuis le bloc "coordonnées" (dossier_donnees_formulaire), même logique
//   que les colonnes nir/nir_iv déjà présentes sur candidats pour les champs sensibles/
//   identifiants du bloc "infos_perso" — le JSONB reste la source d'affichage, cette colonne
//   n'existe que pour permettre une contrainte UNIQUE performante.
// - nir_hash : HMAC-SHA256 déterministe du NIR en clair (voir core/securite/nirCipher.js), qui
//   permet une recherche d'égalité là où nir/nir_iv (AES-256-GCM, non déterministe) ne le
//   permettent pas.
// Portée par entité (entite_id, ...) plutôt que globale : cohérent avec le reste du système
// multi-tenant, un même candidat peut légitimement s'inscrire séparément auprès de deux entités
// distinctes sans que ce soit un doublon.

// Valeurs de repli pour les candidats déjà en base avant cette migration (aucun email ni
// nir_hash connu) : distinctes par ligne (dérivées de l'id) pour ne jamais entrer en conflit
// avec la contrainte UNIQUE posée plus bas, et sans possibilité de correspondre un jour à une
// vraie valeur (email non joignable, hash non déductible d'un vrai NIR).
function emailRepli(id) {
  return `legacy-candidat-${id}@migration.local`;
}

function nirHashRepli(id) {
  return crypto.createHash('sha256').update(`legacy-nir-hash-repli-${id}`).digest();
}

exports.up = async (knex) => {
  await knex.schema.alterTable('candidats', (table) => {
    table.string('email');
    table.specificType('nir_hash', 'bytea');
  });

  const candidatsExistants = await knex('candidats')
    .where(function () {
      this.whereNull('email').orWhereNull('nir_hash');
    })
    .select('id');

  for (const { id } of candidatsExistants) {
    await knex('candidats')
      .where({ id })
      .update({ email: emailRepli(id), nir_hash: nirHashRepli(id) });
  }

  await knex.schema.alterTable('candidats', (table) => {
    table.string('email').notNullable().alter();
    table.specificType('nir_hash', 'bytea').notNullable().alter();
    table.unique(['entite_id', 'email']);
    table.unique(['entite_id', 'nir_hash']);
  });
};

exports.down = (knex) =>
  knex.schema.alterTable('candidats', (table) => {
    table.dropUnique(['entite_id', 'email']);
    table.dropUnique(['entite_id', 'nir_hash']);
    table.dropColumn('email');
    table.dropColumn('nir_hash');
  });
