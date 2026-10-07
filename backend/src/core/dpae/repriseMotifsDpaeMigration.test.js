const test = require('node:test');
const assert = require('node:assert/strict');
// Ce test vit hors de src/db/migrations : knex y charge tout fichier comme une migration (voir
// src/db/migrations.integrite.test.js).
const migration = require('../../db/migrations/082_reprise_motifs_dpae_dans_notes');

const DATE_AUDIT = new Date('2026-09-01T10:00:00Z');
const DATE_MAJ = new Date('2026-09-05T08:00:00Z');

function demande(surcharges = {}) {
  return {
    id: 7,
    demandeur_id: 16,
    date_maj: DATE_MAJ,
    traite_par_utilisateur_id: 3,
    mis_en_attente_par_id: 4,
    motif_rejet: null,
    motif_mise_en_attente: null,
    motif_renvoi: null,
    ...surcharges,
  };
}

test('un motif de rejet devient une note « Motif de rejet : … », auteur et date de l’audit', () => {
  const notes = migration.construireNotes(
    [demande({ motif_rejet: ' Doublon ', audit_motif_rejet_auteur: 3, audit_motif_rejet_date: DATE_AUDIT })],
    new Set(),
  );
  assert.deepEqual(notes, [{ demande_dpae_id: 7, auteur_id: 3, contenu: 'Motif de rejet : Doublon', date_creation: DATE_AUDIT, reprise_motif: true }]);
});

test('sans entrée d’audit : auteur enregistré sur la demande et date de dernière modification ; renvoi -> auteur de la demande', () => {
  const notes = migration.construireNotes(
    [demande({ motif_rejet: 'Doublon', motif_mise_en_attente: 'Pièce manquante', motif_renvoi: 'Horaires' })],
    new Set(),
  );
  assert.deepEqual(
    notes.map(({ contenu, auteur_id: auteur, date_creation: date }) => [contenu, auteur, date]),
    [
      ['Motif de rejet : Doublon', 3, DATE_MAJ],
      ['Motif de mise en attente : Pièce manquante', 4, DATE_MAJ],
      ['Motif de renvoi : Horaires', 16, DATE_MAJ],
    ],
  );
});

test('motifs vides ou blancs : aucune note', () => {
  assert.deepEqual(migration.construireNotes([demande({ motif_rejet: '   ', motif_renvoi: '' })], new Set()), []);
});

test('idempotence : un motif déjà repris n’est pas repris une seconde fois', () => {
  const demandes = [demande({ motif_rejet: 'Doublon', motif_renvoi: 'Horaires' })];
  const premiere = migration.construireNotes(demandes, new Set());
  assert.equal(premiere.length, 2);
  const dejaReprises = new Set(['7|Motif de rejet', '7|Motif de renvoi']);
  assert.deepEqual(migration.construireNotes(demandes, dejaReprises), []);
});

test('up et down : colonne de repère ajoutée de façon conditionnelle, down ne supprime que les notes reprises', async () => {
  const appels = [];
  let colonnePresente = false;
  const generateur = (nom) => {
    const requete = { where: (c) => (appels.push([nom, 'where', c]), requete), del: async () => appels.push([nom, 'del']) };
    return requete;
  };
  const knex = (nom) => generateur(nom);
  knex.schema = {
    hasColumn: async () => colonnePresente,
    alterTable: async (nom, f) => {
      const table = { boolean: () => ({ notNullable: () => ({ defaultTo: () => appels.push(['ajout']) }) }), dropColumn: (c) => appels.push(['retrait', c]) };
      f(table);
      colonnePresente = !colonnePresente;
    },
  };
  colonnePresente = true;
  await migration.down(knex);
  assert.deepEqual(appels, [['notes_demande_dpae', 'where', { reprise_motif: true }], ['notes_demande_dpae', 'del'], ['retrait', 'reprise_motif']]);
  appels.length = 0;
  await migration.down(knex); // colonne absente : sans effet
  assert.deepEqual(appels, []);
});
