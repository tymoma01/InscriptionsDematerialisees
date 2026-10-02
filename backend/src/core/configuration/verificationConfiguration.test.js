const test = require('node:test');
const assert = require('node:assert/strict');

const { TABLES_CONFIGURATION, signalerConfigurationsManquantes } = require('./verificationConfiguration');

// Fausse base : `contenu` = { table: [entite_id, ...] }.
function creerFausseBd(entites, contenu) {
  const bd = (table) => {
    const requete = {
      where(criteres) {
        requete.criteres = criteres;
        return requete;
      },
      select: async () => entites,
      first: async () => ((contenu[table] ?? []).includes(requete.criteres.entite_id) ? { 1: 1 } : undefined),
    };
    return requete;
  };
  bd.raw = (valeur) => valeur;
  return bd;
}

function creerJournal() {
  const erreurs = [];
  const messages = [];
  return { erreurs, messages, error: (m) => erreurs.push(m), log: (m) => messages.push(m) };
}

test('aucune alerte quand chaque table de configuration a au moins une ligne pour l’entité', async () => {
  const contenu = Object.fromEntries(TABLES_CONFIGURATION.map(({ table }) => [table, [1]]));
  const journal = creerJournal();
  const manques = await signalerConfigurationsManquantes(creerFausseBd([{ id: 1, code: 'accecit' }], contenu), journal);
  assert.deepEqual(manques, []);
  assert.deepEqual(journal.erreurs, []);
});

test('signale chaque table vide avec le script à lancer', async () => {
  const contenu = Object.fromEntries(TABLES_CONFIGURATION.map(({ table }) => [table, [1]]));
  contenu.questionnaires_evaluation = [];
  const journal = creerJournal();
  const manques = await signalerConfigurationsManquantes(creerFausseBd([{ id: 1, code: 'accecit' }], contenu), journal);
  assert.deepEqual(manques, [{ entite: 'accecit', table: 'questionnaires_evaluation', script: 'seedQuestionnairesEvaluation.js' }]);
  assert.match(journal.erreurs[0], /questionnaires_evaluation.*seedQuestionnairesEvaluation\.js accecit/);
});
