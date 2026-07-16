const { Client } = require('pg');
const { obtenirConnectionString } = require('../src/db/config');

async function testerConnexion() {
  let connectionString;
  try {
    connectionString = await obtenirConnectionString();
  } catch (erreur) {
    console.error('Échec de récupération du secret depuis Azure Key Vault ✘');
    console.error(erreur.message);
    process.exit(1);
  }

  const client = new Client({ connectionString });

  try {
    await client.connect();
    const { rows } = await client.query('SELECT NOW() AS heure_serveur, current_database() AS base');
    console.log('Connexion réussie ✔');
    console.log(`Base : ${rows[0].base}`);
    console.log(`Heure serveur : ${rows[0].heure_serveur}`);
  } catch (erreur) {
    console.error('Échec de connexion ✘');
    console.error(erreur.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

testerConnexion();
