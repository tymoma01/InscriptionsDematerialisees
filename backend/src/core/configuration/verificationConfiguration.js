// Vérification au démarrage que chaque entité active a bien sa configuration en base.
//
// Les tables ci-dessous ne sont remplies que par les scripts backend/scripts/seed*.js, que le
// déploiement ne rejoue pas. Une table vide ne provoque aucune erreur au démarrage : elle ne se
// voit qu'au premier écran qui en a besoin, sous la forme d'une erreur 500 qui ressemble à un bug
// (incident du 2026-09-09, questionnaire d'évaluation absent en prod). Ce contrôle la signale
// dès le démarrage, dans les logs, avec le script à lancer — sans bloquer le serveur.
const TABLES_CONFIGURATION = [
  { table: 'statuts', script: 'seedStatuts.js' },
  { table: 'transitions_statut', script: 'seedStatuts.js' },
  { table: 'entite_blocs_formulaire', script: 'seedFormulaire.js' },
  { table: 'types_pieces', script: 'seedTypesPieces.js' },
  { table: 'questionnaires_evaluation', script: 'seedQuestionnairesEvaluation.js' },
  { table: 'chartes', script: 'seedCharte.js' },
  { table: 'motifs', script: 'seedMotifs*.js' },
  { table: 'lieux', script: 'seedLieux.js' },
];

// Renvoie la liste des manques ({ entite, table, script }) — vide si tout est configuré.
async function trouverConfigurationsManquantes(bd) {
  const entites = await bd('entites').where({ actif: true }).select('id', 'code');
  const manques = [];
  for (const entite of entites) {
    for (const { table, script } of TABLES_CONFIGURATION) {
      // eslint-disable-next-line no-await-in-loop
      const ligne = await bd(table).where({ entite_id: entite.id }).first(bd.raw('1'));
      if (!ligne) manques.push({ entite: entite.code, table, script });
    }
  }
  return manques;
}

async function signalerConfigurationsManquantes(bd, journal = console) {
  const manques = await trouverConfigurationsManquantes(bd);
  for (const { entite, table, script } of manques) {
    journal.error(
      `CONFIGURATION MANQUANTE : table « ${table} » vide pour l'entité « ${entite} » — lancer backend/scripts/${script} ${entite}`,
    );
  }
  if (manques.length === 0) journal.log('Configuration des entités : complète.');
  return manques;
}

module.exports = { TABLES_CONFIGURATION, trouverConfigurationsManquantes, signalerConfigurationsManquantes };
