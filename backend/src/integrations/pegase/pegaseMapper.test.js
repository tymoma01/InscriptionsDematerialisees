const test = require('node:test');
const assert = require('node:assert/strict');

const pegaseMapper = require('./pegaseMapper');

const SALARIES = [
  { id: '10', nom: 'DUPONT', prenom: 'Marie', dateNaissance: '1990-05-12', numeroSS: '2900575123456-78', nationalite: '4', nomNationalite: 'Française', pays: '4', libellePays: 'France' },
  { id: '11', nom: 'Diallo', prenom: 'Aïssatou', dateNaissance: '1985-01-02', numeroSS: '2850199123     -', nationalite: '259', nomNationalite: 'Algerienne', pays: '4', libellePays: 'France' },
];

test('trouverDoublon reconnaît le même NIR malgré la clé et les espaces de Pégase', () => {
  const doublon = pegaseMapper.trouverDoublon(SALARIES, { nir: '290057512345678', nom: 'Autre', prenom: 'Nom', dateNaissance: '2000-01-01' });
  assert.equal(doublon.salarie.id, '10');
  assert.equal(doublon.motif, 'même n° de sécurité sociale');
});

test('trouverDoublon retombe sur nom, prénom et date de naissance (accents et casse ignorés)', () => {
  const doublon = pegaseMapper.trouverDoublon(SALARIES, { nir: '', nom: 'diallo', prenom: 'AISSATOU', dateNaissance: new Date(1985, 0, 2) });
  assert.equal(doublon.salarie.id, '11');
});

test('trouverDoublon ne signale rien pour une personne inconnue', () => {
  assert.equal(pegaseMapper.trouverDoublon(SALARIES, { nir: '185057512345699', nom: 'Martin', prenom: 'Paul', dateNaissance: '1985-05-01' }), null);
});

test('trouverDoublon reconnaît une fiche déjà créée par l’application (« # POSTE PRÉNOM NOM »)', () => {
  const salaries = [{ id: '20', nom: '# VALET DE CHAMBRE PAUL MARTIN', prenom: 'Paul', dateNaissance: '1985-05-01', numeroSS: '' }];
  assert.equal(pegaseMapper.trouverDoublon(salaries, { nir: '', nom: 'Martin', prenom: 'Paul', dateNaissance: '1985-05-01' }).salarie.id, '20');
  assert.equal(pegaseMapper.trouverDoublon(salaries, { nir: '', nom: 'Martin', prenom: 'Paul', dateNaissance: '1985-05-02' }), null);
});

test('nomPegase : « # POSTE PRÉNOM NOM », poste de la DPAE en majuscules', () => {
  const candidat = { civilite: 'monsieur', prenom: 'Léa', nom: 'Dupont' };
  assert.equal(pegaseMapper.nomPegase({ demande: { poste: 'femme_valet_chambre' }, candidat }), '# F/VDC LÉA DUPONT');
  assert.equal(pegaseMapper.nomPegase({ demande: { poste: 'gouvernant' }, candidat }), '# GOUVERNANT(E) LÉA DUPONT');
  assert.equal(pegaseMapper.nomPegase({ demande: { poste: 'autre', poste_autre: 'Plongeur' }, candidat }), '# PLONGEUR LÉA DUPONT');
});

test('departementNaissance lit le NIR : métropole, outre-mer, étranger', () => {
  assert.equal(pegaseMapper.departementNaissance('290057512345678'), '75');
  assert.equal(pegaseMapper.departementNaissance('290059712345678'), '971');
  assert.equal(pegaseMapper.departementNaissance('290059912345678'), null);
});

test('construireSalariePegase traduit le candidat avec les codes Pégase', () => {
  const { salarie, avertissements } = pegaseMapper.construireSalariePegase({
    candidat: {
      civilite: 'madame',
      nom: 'Martin',
      nomNaissance: null,
      prenom: 'Julie',
      dateNaissance: new Date(1990, 4, 12),
      lieuNaissance: 'Paris',
      nationalite: 'Algérienne',
      situationFamiliale: 'pacse',
      email: 'ancien@exemple.fr',
    },
    coordonnees: { adresse: '1 rue de la Paix', codePostal: '75002', ville: 'Paris', telephone: '0612345678', email: 'julie@exemple.fr' },
    nir: '290057512345678',
    demande: { id: 42, division: 'tertiaire', poste: 'femme_valet_chambre', date_debut: new Date(2026, 10, 3) },
    agence: '7',
    referentiels: pegaseMapper.construireReferentiels(SALARIES),
  });

  assert.deepEqual(salarie, {
    codeCivilite: 'Mme',
    nom: '# F/VDC JULIE MARTIN',
    prenom: 'Julie',
    nomNaissance: 'Martin',
    dateNaissance: '1990-05-12',
    lieuNaissance: 'Paris',
    depNaissance: '75',
    paysNaissance: '4',
    nationalite: '259',
    numeroSS: '2900575123456-78',
    codeSituationFamiliale: 'Pacs',
    agence: '7',
    adresse: '1 rue de la Paix',
    codePostal: '75002',
    ville: 'Paris',
    pays: '4',
    mobile: '0612345678',
    email: 'julie@exemple.fr',
    anciennete: '2026-11-03',
    typeAgent: 0,
    commentaire: "Créé depuis l'application d'inscription (demande DPAE n° 42).",
  });
  assert.deepEqual(avertissements, []);
});

test('construireSalariePegase omet ce que Pégase ne connaît pas et le signale à la RH', () => {
  const { salarie, avertissements } = pegaseMapper.construireSalariePegase({
    candidat: { civilite: 'monsieur', nom: 'Ng', prenom: 'Li', dateNaissance: '1995-03-03', nationalite: 'Vietnamienne', situationFamiliale: 'celibataire' },
    coordonnees: {},
    nir: '195039912345678',
    demande: { id: 1, division: 'autre', date_debut: null },
    agence: '1',
    referentiels: pegaseMapper.construireReferentiels(SALARIES),
  });

  assert.equal(salarie.nationalite, undefined);
  assert.equal(salarie.paysNaissance, undefined);
  assert.equal(salarie.depNaissance, undefined);
  assert.equal(salarie.agence, '1');
  assert.equal('anciennete' in salarie, false);
  assert.equal(avertissements.length, 2);
});
