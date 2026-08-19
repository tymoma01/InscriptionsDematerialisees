// Restaure un dump Neon local (déjà téléchargé ET déchiffré, voir
// scripts/telechargerSauvegardeNeon.js) via pg_restore. Volontairement sans défaut implicite vers
// Neon prod : la cible doit toujours être fournie explicitement, pour qu'un restaurer accidentel
// sur la base de production soit impossible par simple oubli d'argument — voir docs/sauvegarde-neon.md,
// section "tester une restauration", qui documente le flux recommandé (restaurer d'abord sur une
// base Neon de test/branche, jamais directement en prod).
//
// Usage :
//   node scripts/restaurerSauvegardeNeon.js <chemin_dump> --connection-string "<url_postgresql>"
//   node scripts/restaurerSauvegardeNeon.js <chemin_dump> --connection-string-env <NOM_VARIABLE>
//     (préférable en pratique : évite que la connection string apparaisse dans l'historique shell
//     ou "ps aux" — exporter la variable d'environnement avant l'appel)
//   node scripts/restaurerSauvegardeNeon.js <chemin_dump> --neon-prod --confirmer
//     (récupère la connection string Neon prod depuis Key Vault — --confirmer est obligatoire,
//     sans quoi le script refuse de s'exécuter, pour matérialiser qu'il s'agit d'un geste voulu)

const { restaurerDump } = require('../src/core/sauvegarde/pgDumpService');
const { obtenirConnectionString } = require('../src/db/config');

function parserArguments(argv) {
  const [cheminDump, ...reste] = argv;
  const options = {};
  for (let i = 0; i < reste.length; i += 1) {
    const arg = reste[i];
    if (arg === '--connection-string') {
      options.connectionString = reste[i + 1];
      i += 1;
    } else if (arg === '--connection-string-env') {
      options.connectionStringEnv = reste[i + 1];
      i += 1;
    } else if (arg === '--neon-prod') {
      options.neonProd = true;
    } else if (arg === '--confirmer') {
      options.confirme = true;
    }
  }
  return { cheminDump, options };
}

async function resoudreConnectionStringCible(options) {
  if (options.connectionString) {
    return options.connectionString;
  }
  if (options.connectionStringEnv) {
    const valeur = process.env[options.connectionStringEnv];
    if (!valeur) {
      throw new Error(`Variable d'environnement "${options.connectionStringEnv}" absente ou vide.`);
    }
    return valeur;
  }
  if (options.neonProd) {
    if (!options.confirme) {
      throw new Error('--neon-prod exige --confirmer explicite (restauration destructive sur la base de production).');
    }
    console.warn('⚠️  Restauration ciblant Neon PRODUCTION (--neon-prod --confirmer) — --clean écrasera les données actuelles.');
    return obtenirConnectionString();
  }
  throw new Error(
    'Cible manquante : fournir --connection-string, --connection-string-env <VAR>, ou --neon-prod --confirmer.',
  );
}

async function main() {
  const { cheminDump, options } = parserArguments(process.argv.slice(2));
  if (!cheminDump) {
    throw new Error(
      'Usage : node scripts/restaurerSauvegardeNeon.js <chemin_dump> (--connection-string "<url>" | --connection-string-env <VAR> | --neon-prod --confirmer)',
    );
  }

  const connectionString = await resoudreConnectionStringCible(options);

  console.log(`Restauration de "${cheminDump}" en cours (pg_restore --clean --if-exists)...`);
  await restaurerDump(cheminDump, connectionString);
  console.log('Restauration terminée ✔');
}

main().catch((erreur) => {
  console.error('Échec de la restauration ✘');
  console.error(erreur.message);
  process.exit(1);
});
