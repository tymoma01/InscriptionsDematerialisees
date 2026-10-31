const test = require('node:test');
const assert = require('node:assert/strict');
const { ZodError } = require('zod');

const { echelonsDuPoste } = require('./echelonsDpae');
const { appliquerEchelon } = require('../../api/routes/dpae.routes');
const config = require('../../entites/accecit/entite.config.json');

const ENTITE = { code: 'accecit', dpae_config: config.dpae_config };

const ECHELONS_ATTENDUS = {
  femme_valet_chambre: ['AS'],
  equipier: ['AS', 'ATQS'],
  gouvernant: ['CE1', 'CE2', 'CE3', 'MP1'],
  cafetier: ['AS'],
  autre: ['AS', 'ATQS', 'CE1', 'CE2', 'CE3', 'MP1'],
  plongeur: [],
};

for (const [poste, echelons] of Object.entries(ECHELONS_ATTENDUS)) {
  test(`échelons du poste « ${poste} » : ${echelons.join(', ') || 'aucun'}`, () => {
    assert.deepEqual(echelonsDuPoste(ENTITE, poste), echelons);
    for (const echelon of echelons) {
      assert.equal(appliquerEchelon(ENTITE, { poste, echelon }).echelon, echelon);
    }
  });
}

function messageRefus(donnees) {
  try {
    appliquerEchelon(ENTITE, donnees);
  } catch (erreur) {
    assert.ok(erreur instanceof ZodError);
    assert.deepEqual(erreur.issues[0].path, ['echelon']);
    return erreur.issues[0].message;
  }
  return null;
}

test('échelon hors de la liste du poste : refusé', () => {
  assert.match(messageRefus({ poste: 'equipier', echelon: 'CE1' }), /n'existe pas/);
  assert.match(messageRefus({ poste: 'femme_valet_chambre', echelon: 'ATQS' }), /n'existe pas/);
});

test('échelon manquant pour un poste qui en a : refusé', () => {
  assert.match(messageRefus({ poste: 'gouvernant' }), /obligatoire/);
  assert.match(messageRefus({ poste: 'equipier', echelon: '' }), /obligatoire/);
});

test('poste « autre » : les 6 échelons de l\'entité, sans doublon, chacun accepté', () => {
  assert.equal(echelonsDuPoste(ENTITE, 'autre').length, 6);
  assert.match(messageRefus({ poste: 'autre', posteAutre: 'Plongeur' }), /obligatoire/);
});

test('poste « autre » : échelon inconnu refusé', () => {
  assert.match(messageRefus({ poste: 'autre', echelon: 'XYZ' }), /n'existe pas/);
});

test('un échelon ajouté à un autre poste apparaît pour « autre »', () => {
  const entite = { dpae_config: { ...ENTITE.dpae_config, echelons_par_poste: { ...ENTITE.dpae_config.echelons_par_poste, cafetier: ['AS', 'NEW'] } } };
  assert.deepEqual(echelonsDuPoste(entite, 'autre').at(-1), 'NEW');
  assert.equal(appliquerEchelon(entite, { poste: 'autre', echelon: 'NEW' }).echelon, 'NEW');
});

test('poste sans échelon : accepté, échelon ignoré (null)', () => {
  assert.equal(appliquerEchelon(ENTITE, { poste: 'plongeur', echelon: 'AS' }).echelon, null);
  assert.equal(appliquerEchelon(ENTITE, { poste: 'plongeur' }).echelon, null);
});

test('entité sans configuration DPAE : aucun poste n\'a d\'échelon', () => {
  assert.equal(appliquerEchelon({ code: 'x' }, { poste: 'equipier', echelon: 'AS' }).echelon, null);
});
