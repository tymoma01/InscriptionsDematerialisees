require('dotenv').config();
const { Client } = require('pg');

async function testerConnexion() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL manquant — vérifie backend/.env');
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });

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
