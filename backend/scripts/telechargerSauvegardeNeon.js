// Télécharge une sauvegarde Neon depuis SharePoint (Backups/neon) et la déchiffre localement,
// prête pour scripts/restaurerSauvegardeNeon.js — voir docs/sauvegarde-neon.md pour la procédure
// complète de test de restauration.
//
// Usage :
//   node scripts/telechargerSauvegardeNeon.js                     -> liste les sauvegardes disponibles
//   node scripts/telechargerSauvegardeNeon.js <nom_fichier> [dossier_sortie]
//     ex. node scripts/telechargerSauvegardeNeon.js backup-2026-08-19.dump.enc /tmp/restauration

const fs = require('fs/promises');
const path = require('path');
const stockageSauvegardeGraph = require('../src/core/sauvegarde/stockageSauvegardeGraph');
const { dechiffrerFichier } = require('../src/core/sauvegarde/chiffrementSauvegarde');

async function lister() {
  const sauvegardes = await stockageSauvegardeGraph.listerSauvegardes();
  if (sauvegardes.length === 0) {
    console.log('Aucune sauvegarde trouvée dans Backups/neon.');
    return;
  }
  console.log(`${sauvegardes.length} sauvegarde(s) disponible(s) (la plus récente en premier) :`);
  for (const sauvegarde of sauvegardes) {
    console.log(`  ${sauvegarde.nom}\t${sauvegarde.dateCreation.toISOString()}`);
  }
  console.log('\nPour télécharger : node scripts/telechargerSauvegardeNeon.js <nom_fichier> [dossier_sortie]');
}

async function telechargerEtDechiffrer(nomFichier, dossierSortie) {
  const sauvegardes = await stockageSauvegardeGraph.listerSauvegardes();
  const sauvegarde = sauvegardes.find((s) => s.nom === nomFichier);
  if (!sauvegarde) {
    throw new Error(`Sauvegarde "${nomFichier}" introuvable dans Backups/neon (voir la liste sans argument).`);
  }

  await fs.mkdir(dossierSortie, { recursive: true });
  const cheminChiffre = path.join(dossierSortie, sauvegarde.nom);
  const cheminDechiffre = path.join(dossierSortie, sauvegarde.nom.replace(/\.enc$/, ''));

  console.log(`Téléchargement de "${sauvegarde.nom}"...`);
  const contenu = await stockageSauvegardeGraph.telechargerSauvegarde(sauvegarde.id);
  await fs.writeFile(cheminChiffre, contenu);

  console.log('Déchiffrement...');
  await dechiffrerFichier(cheminChiffre, cheminDechiffre);
  await fs.rm(cheminChiffre); // ne pas laisser traîner la copie chiffrée à côté du dump en clair

  console.log(`Dump déchiffré prêt : ${cheminDechiffre}`);
  console.log(
    `Pour restaurer (sur une base de TEST, jamais directement en prod sans confirmation) :\n` +
      `  node scripts/restaurerSauvegardeNeon.js ${cheminDechiffre} "<connection_string_cible>"`,
  );
}

const [, , nomFichier, dossierSortie] = process.argv;

const promesse = nomFichier
  ? telechargerEtDechiffrer(nomFichier, dossierSortie ?? path.join(process.cwd(), 'sauvegardes-telechargees'))
  : lister();

promesse.catch((erreur) => {
  console.error('Échec ✘');
  console.error(erreur.message);
  process.exit(1);
});
