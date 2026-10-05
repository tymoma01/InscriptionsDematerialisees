const test = require('node:test');
const assert = require('node:assert/strict');
const knex = require('knex');

const demandeDpaeRepository = require('./demandeDpaeRepository');

// Requêtes d'écriture des décisions : compte tenu du compare-and-set (demandeDpaeTransitions.test.js
// en simule l'effet), on vérifie ici le SQL réellement généré — sans connexion : knex('pg') sait
// compiler une requête sans la lancer.
const bd = knex({ client: 'pg' });

test('marquerTraitee : UPDATE gardé par id, statut de départ ET version ; version incrémentée, date_maj mise à jour', () => {
  const { sql, bindings } = demandeDpaeRepository
    .marquerTraitee(bd, 7, { statutDepart: 'envoyee', version: 3, statut: 'validee', traitantId: 42 })
    .toSQL();

  assert.match(sql, /^update "demandes_dpae" set /);
  assert.match(sql, /"version" = version \+ 1/);
  assert.match(sql, /"date_maj" = CURRENT_TIMESTAMP/);
  assert.match(sql, /where "id" = \? and "statut" = \? and "version" = \?$/);
  assert.deepEqual(bindings.slice(-3), [7, 'envoyee', 3]);
});

test('marquerEnAttente : UPDATE gardé par id, statut de départ ET version ; décision finale non touchée', () => {
  const { sql, bindings } = demandeDpaeRepository
    .marquerEnAttente(bd, 7, { statutDepart: 'envoyee', version: 3, traitantId: 42, motif: 'Pièce manquante' })
    .toSQL();

  assert.match(sql, /"version" = version \+ 1/);
  assert.match(sql, /where "id" = \? and "statut" = \? and "version" = \?$/);
  assert.deepEqual(bindings.slice(-3), [7, 'envoyee', 3]);
  assert.doesNotMatch(sql, /date_traitement|traite_par_utilisateur_id/);
});

test('modifierDemande : UPDATE gardé par id, statut de départ ET version ; jamais le demandeur, l’entité ni la date de création', () => {
  const donnees = { typeDemande: 'nouvelle_embauche', salarieNom: 'Martin', salariePrenom: 'Sophie', dateDebut: '2026-10-12' };
  const { sql, bindings } = demandeDpaeRepository
    .modifierDemande(bd, 7, { statutDepart: 'en_attente', version: 3, statutArrivee: 'envoyee', donnees: { ...donnees, demandeurId: 99, entiteId: 2 } })
    .toSQL();

  const partieSet = sql.slice(sql.indexOf(' set '), sql.indexOf(' where '));
  assert.match(partieSet, /"statut" = \?/);
  assert.match(partieSet, /"version" = version \+ 1/);
  assert.match(partieSet, /"date_maj" = CURRENT_TIMESTAMP/);
  assert.doesNotMatch(partieSet, /demandeur_id|entite_id|date_creation/);
  assert.match(sql, /where "id" = \? and "statut" = \? and "version" = \?$/);
  assert.deepEqual(bindings.slice(-3), [7, 'en_attente', 3]);
});
