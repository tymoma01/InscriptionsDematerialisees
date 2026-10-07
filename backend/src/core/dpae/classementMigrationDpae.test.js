const test = require('node:test');
const assert = require('node:assert/strict');
// Hors de src/db/migrations (voir src/db/migrations.integrite.test.js).
const migration = require('../../db/migrations/084_memorisation_classement_demandes_dpae');

const { reconstituerStatutAvantClassement: reconstituer } = migration;

test('migration 084 : statut d’avant le classement rejoué depuis les actions tracées', () => {
  assert.equal(reconstituer({ roleDemandeur: 'inspecteur_hotellerie', actionsAvantClassement: ['demande_dpae_creation'] }), 'a_valider_planning');
  assert.equal(reconstituer({ roleDemandeur: 'planning', actionsAvantClassement: ['demande_dpae_creation'] }), 'envoyee');
  assert.equal(reconstituer({ roleDemandeur: 'inspecteur_hotellerie', actionsAvantClassement: ['demande_dpae_creation', 'demande_dpae_transmission_rh'] }), 'envoyee');
  assert.equal(
    reconstituer({ roleDemandeur: 'inspecteur_hotellerie', actionsAvantClassement: ['demande_dpae_creation', 'demande_dpae_transmission_rh', 'demande_dpae_mise_en_attente', 'demande_dpae_modification', 'note_demande_dpae_creation'] }),
    'en_attente',
  );
  assert.equal(
    reconstituer({ roleDemandeur: 'inspecteur_hotellerie', actionsAvantClassement: ['demande_dpae_creation', 'demande_dpae_renvoi_inspecteur', 'demande_dpae_modification', 'demande_dpae_envoi_planning'] }),
    'a_valider_planning',
  );
  assert.equal(reconstituer({ roleDemandeur: 'inspecteur_hotellerie', actionsAvantClassement: ['demande_dpae_renvoi_inspecteur'] }), 'renvoyee_inspecteur');
});

test('migration 084 : sans action ni rôle du demandeur, non reconstituable (null)', () => {
  assert.equal(reconstituer({ roleDemandeur: null, actionsAvantClassement: [] }), null);
  assert.equal(reconstituer({ roleDemandeur: null, actionsAvantClassement: ['demande_dpae_modification'] }), null);
});
