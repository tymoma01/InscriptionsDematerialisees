const { spawn } = require('child_process');
const { obtenirConnectionString } = require('../../db/config');

// pg_dump/pg_restore sont des binaires externes (paquet système postgresql-client), pas des
// dépendances npm — la version du client installé doit être >= à la version majeure du serveur
// Postgres de Neon (voir docs/sauvegarde-neon.md). Le PITR natif Neon (CLAUDE.md) est limité à 6h
// sur le plan gratuit ; ce dump quotidien est un filet complémentaire, pas un remplacement.
const FORMAT_DUMP = 'custom'; // -Fc : seul format supportant pg_restore --jobs et la sélection d'objets à la restauration

// Convertit la connection string Neon (récupérée depuis Key Vault, voir db/config.js) en
// variables d'environnement PG* pour le process pg_dump/pg_restore, plutôt que de la passer en
// argument de ligne de commande : un argv de process est visible de tout autre utilisateur local
// via `ps aux`/`/proc`, ce qui exposerait le mot de passe Neon en clair — inacceptable pour une
// base contenant NIR/RIB/pièces d'identité (voir CLAUDE.md, contraintes RGPD).
function construireVariablesEnvPg(connectionString) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('Connection string Neon invalide : impossible de la parser comme une URL postgresql://');
  }

  const variables = {
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, '')),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    // Neon impose TLS ; la connection string porte généralement déjà ?sslmode=require, repris ici
    // si présent, sinon on l'impose explicitement plutôt que de laisser pg_dump choisir un défaut.
    PGSSLMODE: url.searchParams.get('sslmode') || 'require',
  };

  if (!variables.PGHOST || !variables.PGDATABASE || !variables.PGUSER) {
    throw new Error('Connection string Neon incomplète (hôte, base ou utilisateur manquant)');
  }

  return variables;
}

function executerProcessPg(commande, args, variablesEnvPg) {
  return new Promise((resolve, reject) => {
    const enfant = spawn(commande, args, {
      env: { ...process.env, ...variablesEnvPg },
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let erreurStderr = '';
    enfant.stderr.on('data', (donnees) => {
      erreurStderr += donnees.toString();
    });

    enfant.on('error', (erreur) => {
      reject(new Error(`Impossible de lancer "${commande}" (binaire absent du PATH ?) : ${erreur.message}`));
    });

    enfant.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`"${commande}" a échoué (code ${code}) : ${erreurStderr.trim() || 'aucun détail sur stderr'}`));
      }
    });
  });
}

/**
 * Exécute un pg_dump complet de la base Neon (format custom, compressé) vers `cheminSortie`.
 */
async function creerDump(cheminSortie) {
  const connectionString = await obtenirConnectionString();
  const variablesEnvPg = construireVariablesEnvPg(connectionString);

  await executerProcessPg('pg_dump', ['--format', FORMAT_DUMP, '--compress', '9', '--file', cheminSortie], variablesEnvPg);
}

/**
 * Restaure un dump local (produit par creerDump, déjà déchiffré) vers la base ciblée par
 * `connectionString` — jamais un défaut implicite vers Neon prod : l'appelant (script CLI) doit
 * explicitement fournir la cible, voir scripts/restaurerSauvegardeNeon.js.
 */
async function restaurerDump(cheminDump, connectionString) {
  const variablesEnvPg = construireVariablesEnvPg(connectionString);

  await executerProcessPg(
    'pg_restore',
    ['--dbname', variablesEnvPg.PGDATABASE, '--clean', '--if-exists', '--no-owner', '--no-privileges', cheminDump],
    variablesEnvPg,
  );
}

module.exports = { creerDump, restaurerDump, construireVariablesEnvPg };
