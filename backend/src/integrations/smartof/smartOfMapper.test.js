const test = require('node:test');
const assert = require('node:assert/strict');

const { construirePayloadApprenant } = require('./smartOfMapper');

// Forme réelle observée sur le dossier #69 (candidat de test "TEST ETEST", entité ACCECIT,
// interrogé en base le 2026-08-21) — sert de fixture plutôt qu'une donnée inventée, pour que ce
// test reflète la forme exacte que dossierRepository.trouverInscriptionCompleteParDossierId
// renvoie réellement.
const INSCRIPTION_DOSSIER_69 = {
  candidat: {
    civilite: 'monsieur',
    nom: 'ETEST',
    nomNaissance: '',
    prenom: 'TEST',
    dateNaissance: new Date('2004-12-30T23:00:00.000Z'),
    lieuNaissance: 'PARIS',
    nationalite: 'Française',
    situationFamiliale: 'celibataire',
    email: 'A@T.GT',
  },
  blocs: {
    coordonnees: {
      email: 'A@T.GT',
      adresse: '12 RUE DE PARIS',
      codePostal: '75001',
      ville: 'PARIS',
      telephone: '0712345677',
      contactUrgenceNom: 'NOM',
      contactUrgenceTelephone: '0523456776',
    },
  },
};

test('construirePayloadApprenant traduit un dossier ACCECIT réel (#69) vers le format apprenant/create attendu par SmartOF', () => {
  const payload = construirePayloadApprenant({
    dossierId: 69,
    inscription: INSCRIPTION_DOSSIER_69,
    entrepriseUid: 'uid-entreprise-hotellerie',
    nir: '1850578006048',
  });

  assert.equal(payload.customId, 'APPX-69');
  assert.equal(payload.email, 'A@T.GT');
  assert.deepEqual(payload.entrepriseUids, ['uid-entreprise-hotellerie']);
  assert.equal(payload.archived, false);

  assert.equal(payload.meta.nom, 'ETEST');
  assert.equal(payload.meta.prenom, 'TEST');
  assert.equal(payload.meta.civilite, 'Monsieur');
  assert.equal(payload.meta.dateNaissance, '2004-12-30');
  assert.equal(payload.meta.tel, '0712345677');
  assert.equal(payload.meta.adresse.rue, '12 RUE DE PARIS');
  assert.equal(payload.meta.adresse.codePostal, '75001');
  assert.equal(payload.meta.adresse.ville, 'PARIS');
  assert.equal(payload.meta.adresse.complementAdresse, '');

  // custom_field_1 = NIR (décision utilisateur, 2026-08-21) ; les 19 autres restent vides.
  assert.equal(payload.custom_fields.custom_field_1, '1850578006048');
  for (let i = 2; i <= 20; i += 1) {
    assert.equal(payload.custom_fields[`custom_field_${i}`], '');
  }
});

test('construirePayloadApprenant retombe sur "Non renseigné" pour une civilité inconnue et sur des chaînes vides quand entrepriseUid est absent', () => {
  const payload = construirePayloadApprenant({
    dossierId: 70,
    inscription: {
      candidat: { nom: 'X', prenom: 'Y', civilite: 'autre', dateNaissance: null },
      blocs: {},
    },
    entrepriseUid: undefined,
  });

  assert.equal(payload.meta.civilite, 'Non renseigné');
  assert.equal(payload.meta.dateNaissance, '');
  assert.equal(payload.meta.tel, '');
  assert.deepEqual(payload.entrepriseUids, []);
  // nir absent (déchiffrement en échec côté smartOfService.js, voir son commentaire) : repli vide.
  assert.equal(payload.custom_fields.custom_field_1, '');
});
