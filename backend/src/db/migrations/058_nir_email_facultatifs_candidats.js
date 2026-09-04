// N° de sécurité sociale et email rendus facultatifs à l'inscription (décision utilisateur,
// 2026-09-04) : certains candidats se présentent sans carte Vitale sous la main ou sans adresse
// email exploitable, et bloquer toute l'inscription pour ça n'est plus jugé acceptable. `nir`/
// `nir_iv` (migration 008) et `nir_hash`/`email` (migration 032) passent donc tous en nullable —
// un candidat sans NIR n'a simplement ni valeur chiffrée ni hash d'unicité (voir
// dossierService.inscrireCandidat), et un candidat sans email n'a simplement pas de valeur dans
// cette colonne.
//
// Les contraintes UNIQUE(entite_id, nir_hash)/UNIQUE(entite_id, email) posées par la migration 032
// n'ont pas besoin d'être touchées : Postgres ne considère jamais deux NULL comme égaux, donc
// plusieurs candidats sans NIR (ou sans email) coexistent déjà sans violer ces contraintes — voir
// dossierService.inscrireCandidat pour la garde correspondante côté application (recherche de
// doublon sautée quand la valeur est absente, faute de pouvoir comparer quoi que ce soit).
exports.up = (knex) =>
  knex.schema.alterTable('candidats', (table) => {
    table.specificType('nir', 'bytea').nullable().alter();
    table.specificType('nir_iv', 'bytea').nullable().alter();
    table.specificType('nir_hash', 'bytea').nullable().alter();
    table.string('email').nullable().alter();
  });

// Repli symétrique de la migration 032 (emailRepli/nirHashRepli) : un rollback ne peut pas savoir
// quelle valeur de repli réattribuer à une ligne insérée sans NIR/email pendant que cette migration
// était appliquée — down() suppose donc qu'aucune ligne de ce type n'existe encore (à vérifier
// manuellement avant un rollback en production).
exports.down = (knex) =>
  knex.schema.alterTable('candidats', (table) => {
    table.specificType('nir', 'bytea').notNullable().alter();
    table.specificType('nir_iv', 'bytea').notNullable().alter();
    table.specificType('nir_hash', 'bytea').notNullable().alter();
    table.string('email').notNullable().alter();
  });
