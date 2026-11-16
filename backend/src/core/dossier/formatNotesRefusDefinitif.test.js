const test = require('node:test');
const assert = require('node:assert/strict');
// Hors de src/db/migrations : knex y charge tout fichier comme une migration.
const migration = require('../../db/migrations/099_format_notes_refus_definitif');
const blacklistService = require('./blacklistService');

const LIBELLE = 'Fausse déclaration ou faux document';

test('nouvelles notes : refus avec le motif entre parenthèses, levée « Refus définitif levé : … », sans tiret long', () => {
  const refus = blacklistService.formaterMotifRefus(LIBELLE, 'Devrait revenir avec son passeport');
  const levee = blacklistService.formaterMotifLevee('Erreur de dossier');
  assert.equal(refus, 'Refus définitif (Fausse déclaration ou faux document) : Devrait revenir avec son passeport');
  assert.equal(levee, 'Refus définitif levé : Erreur de dossier');
  assert.ok(!refus.includes('—') && !levee.includes('—'));
});

test('ancienne note « Blacklisté — … » et son historique réécrits au nouveau format', () => {
  const resultat = migration.reecrireRefus({
    contenu: `Blacklisté — ${LIBELLE} : Devrait revenir`,
    commentaire: `${LIBELLE} — Devrait revenir`,
    libelle: LIBELLE,
  });
  assert.deepEqual(resultat, { note: `Refus définitif (${LIBELLE}) : Devrait revenir`, historique: `Refus définitif (${LIBELLE}) : Devrait revenir` });
});

test('note intermédiaire « Refus définitif — … » également réécrite ; commentaire saisi conservé tel quel (tirets longs compris)', () => {
  const resultat = migration.reecrireRefus({ contenu: `Refus définitif — ${LIBELLE} : a — b : c`, commentaire: 'autre', libelle: LIBELLE });
  assert.equal(resultat.note, `Refus définitif (${LIBELLE}) : a — b : c`);
  assert.equal(resultat.historique, null);
});

test('anciennes notes de levée réécrites (note et historique)', () => {
  for (const prefixe of ['Retrait de la blacklist', 'Levée du refus définitif']) {
    const resultat = migration.reecrireLevee({ contenu: `${prefixe} : Erreur`, commentaire: `${prefixe} — Erreur` });
    assert.deepEqual(resultat, { note: 'Refus définitif levé : Erreur', historique: 'Refus définitif levé : Erreur' });
  }
});

test('une note saisie à la main n’est jamais modifiée', () => {
  assert.equal(migration.reecrireRefus({ contenu: 'Appelé ce matin — rappeler demain', commentaire: 'x', libelle: LIBELLE }), null);
  assert.equal(migration.reecrireRefus({ contenu: `Blacklisté — Autre motif : x`, commentaire: 'x', libelle: LIBELLE }), null);
  assert.equal(migration.reecrireLevee({ contenu: 'Retrait de la blacklist : x', commentaire: 'Appel du candidat' }), null);
  assert.equal(migration.reecrireLevee({ contenu: 'Note libre', commentaire: null }), null);
});
