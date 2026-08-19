const fs = require('fs/promises');
const os = require('os');
const path = require('path');
// Non déstructurés exprès (même raison qu'azureOneDriveConnector.js) : les tests mockent ces
// fonctions via `t.mock.method`, qui ne fonctionne que si l'appel passe par la propriété du
// module — une déstructuration figerait la référence à l'implémentation réelle dès le require.
const pgDumpService = require('./pgDumpService');
const chiffrementSauvegarde = require('./chiffrementSauvegarde');
const stockageSauvegardeGraph = require('./stockageSauvegardeGraph');
const notificationEchecSauvegarde = require('./notificationEchecSauvegarde');

// PITR natif Neon limité à 6h sur le plan gratuit (CLAUDE.md) : cette sauvegarde quotidienne est
// un filet complémentaire, pas un remplacement — voir docs/sauvegarde-neon.md.
const NOMBRE_SAUVEGARDES_CONSERVEES = 30;

// Date du jour dans le fuseau Europe/Paris (jamais celui, potentiellement différent, du serveur/
// runner CI qui exécute le job) — même principe que anneeMoisParis dans azureOneDriveConnector.js.
function dateDuJourParis() {
  const parties = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).formatToParts(new Date());
  const valeurs = Object.fromEntries(parties.map((partie) => [partie.type, partie.value]));
  return `${valeurs.year}-${valeurs.month}-${valeurs.day}`; // fr-CA : format AAAA-MM-JJ directement
}

function formaterTailleLisible(octets) {
  const unites = ['o', 'Kio', 'Mio', 'Gio'];
  let valeur = octets;
  let indexUnite = 0;
  while (valeur >= 1024 && indexUnite < unites.length - 1) {
    valeur /= 1024;
    indexUnite += 1;
  }
  return `${valeur.toFixed(1)} ${unites[indexUnite]}`;
}

// Ne conserve que les NOMBRE_SAUVEGARDES_CONSERVEES sauvegardes les plus récentes sur SharePoint,
// en supprimant les plus anciennes — appelé à chaque exécution réussie du job (spécification :
// "supprimer automatiquement les plus anciens à chaque exécution").
async function appliquerRetention() {
  const sauvegardes = await stockageSauvegardeGraph.listerSauvegardes(); // déjà triées, plus récente en premier
  const aSupprimer = sauvegardes.slice(NOMBRE_SAUVEGARDES_CONSERVEES);

  for (const sauvegarde of aSupprimer) {
    await stockageSauvegardeGraph.supprimerSauvegarde(sauvegarde.id);
  }

  return aSupprimer.length;
}

/**
 * Exécute la sauvegarde quotidienne complète : pg_dump -> chiffrement AES-256-GCM -> upload
 * SharePoint -> purge de rétention (30 derniers dumps). Sur échec, notifie explicitement (voir
 * notificationEchecSauvegarde.js) puis relance l'erreur — l'appelant (scripts/sauvegarderNeon.js)
 * est responsable du code de sortie non-zéro, pour qu'un échec ne passe jamais inaperçu (ni par un
 * job planifié silencieux, ni par un log noyé parmi d'autres).
 */
async function executerSauvegarde() {
  const debut = Date.now();
  const dossierTemporaire = await fs.mkdtemp(path.join(os.tmpdir(), 'sauvegarde-neon-'));
  const cheminDump = path.join(dossierTemporaire, 'dump.pgdump');
  const cheminChiffre = path.join(dossierTemporaire, 'dump.pgdump.enc');
  const nomFichierDistant = `backup-${dateDuJourParis()}.dump.enc`;

  try {
    console.log('Sauvegarde Neon : démarrage du pg_dump...');
    await pgDumpService.creerDump(cheminDump);

    console.log('Sauvegarde Neon : chiffrement du dump...');
    await chiffrementSauvegarde.chiffrerFichier(cheminDump, cheminChiffre);

    const { size: tailleOctets } = await fs.stat(cheminChiffre);
    const contenuChiffre = await fs.readFile(cheminChiffre);

    console.log(`Sauvegarde Neon : upload vers SharePoint (${nomFichierDistant}, ${formaterTailleLisible(tailleOctets)})...`);
    await stockageSauvegardeGraph.uploaderSauvegarde(nomFichierDistant, contenuChiffre);

    console.log('Sauvegarde Neon : application de la politique de rétention...');
    const nombreSupprime = await appliquerRetention();

    const dureeMs = Date.now() - debut;
    const resultat = {
      succes: true,
      nomFichier: nomFichierDistant,
      tailleOctets,
      dureeMs,
      sauvegardesSupprimees: nombreSupprime,
    };

    console.log(
      `Sauvegarde Neon réussie ✔ — ${nomFichierDistant}, ${formaterTailleLisible(tailleOctets)}, ` +
        `${(dureeMs / 1000).toFixed(1)}s, ${nombreSupprime} ancienne(s) sauvegarde(s) purgée(s).`,
    );

    return resultat;
  } catch (erreur) {
    console.error('Sauvegarde Neon en échec ✘');
    console.error(erreur.message);
    await notificationEchecSauvegarde.notifierEchecSauvegarde(erreur);
    throw erreur;
  } finally {
    // Le dump contient l'intégralité des données candidat de Neon (état civil, coordonnées, NIR
    // chiffré, etc. — voir CLAUDE.md, contraintes RGPD) : ne jamais laisser le fichier local
    // (dump en clair ou sa version chiffrée) traîner sur le disque au-delà de l'exécution du job,
    // succès ou échec.
    await fs.rm(dossierTemporaire, { recursive: true, force: true });
  }
}

module.exports = { executerSauvegarde, appliquerRetention, NOMBRE_SAUVEGARDES_CONSERVEES };
