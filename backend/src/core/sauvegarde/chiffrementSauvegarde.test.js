const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Même approche que nirCipher.test.js : on mocke keyVaultClient AVANT de charger le module
// testé, pour qu'aucun appel réseau réel à Azure Key Vault ne soit fait dans ces tests.
const keyVaultClient = require('../securite/keyVaultClient');

const CLE_TEST_BASE64 = crypto.randomBytes(32).toString('base64');
let nombreAppelsObtenirSecret = 0;

keyVaultClient.obtenirSecret = async (nomSecret) => {
  nombreAppelsObtenirSecret += 1;
  assert.equal(nomSecret, 'backup-encryption-key');
  return CLE_TEST_BASE64;
};
keyVaultClient.invaliderSecret = () => {};

const { chiffrerFichier, dechiffrerFichier } = require('./chiffrementSauvegarde');

async function fichierTemporaire(prefixe) {
  const dossier = await fs.mkdtemp(path.join(os.tmpdir(), 'chiffrement-sauvegarde-'));
  return path.join(dossier, prefixe);
}

test('chiffrer puis déchiffrer un fichier redonne le contenu d\'origine', async () => {
  const contenu = Buffer.from('contenu de test du dump Neon, avec des octets variés \0\1\2\xff', 'binary');
  const entree = await fichierTemporaire('dump.bin');
  const chiffre = await fichierTemporaire('dump.bin.enc');
  const sortie = await fichierTemporaire('dump.bin.restaure');

  await fs.writeFile(entree, contenu);
  await chiffrerFichier(entree, chiffre);
  await dechiffrerFichier(chiffre, sortie);

  const resultat = await fs.readFile(sortie);
  assert.ok(resultat.equals(contenu));
});

test('le contenu en clair n\'apparaît pas tel quel dans le fichier chiffré', async () => {
  const contenu = Buffer.from('MARQUEUR_EN_CLAIR_A_NE_PAS_RETROUVER');
  const entree = await fichierTemporaire('dump.bin');
  const chiffre = await fichierTemporaire('dump.bin.enc');

  await fs.writeFile(entree, contenu);
  await chiffrerFichier(entree, chiffre);

  const octetsChiffres = await fs.readFile(chiffre);
  assert.ok(!octetsChiffres.includes(contenu));
});

test('deux chiffrements du même fichier produisent des résultats différents (IV aléatoire)', async () => {
  const contenu = Buffer.from('même contenu, deux chiffrements');
  const entree = await fichierTemporaire('dump.bin');
  const chiffreA = await fichierTemporaire('a.enc');
  const chiffreB = await fichierTemporaire('b.enc');

  await fs.writeFile(entree, contenu);
  await chiffrerFichier(entree, chiffreA);
  await chiffrerFichier(entree, chiffreB);

  assert.ok(!(await fs.readFile(chiffreA)).equals(await fs.readFile(chiffreB)));
});

test('la clé Key Vault est récupérée une seule fois grâce au cache', async () => {
  const contenu = Buffer.from('contenu');
  const entree = await fichierTemporaire('dump.bin');
  await fs.writeFile(entree, contenu);

  const avant = nombreAppelsObtenirSecret;
  await chiffrerFichier(entree, await fichierTemporaire('a.enc'));
  await chiffrerFichier(entree, await fichierTemporaire('b.enc'));
  assert.equal(nombreAppelsObtenirSecret, avant);
});

test('un fichier chiffré trop court (tronqué) est rejeté avec un message clair', async () => {
  const chiffre = await fichierTemporaire('trop-court.enc');
  await fs.writeFile(chiffre, Buffer.alloc(10)); // < IV (12) + tag (16)
  const sortie = await fichierTemporaire('sortie.bin');

  await assert.rejects(() => dechiffrerFichier(chiffre, sortie), /trop petit/);
});

test('un tag GCM invalide (fichier corrompu) est détecté et signalé clairement', async () => {
  const contenu = Buffer.from('contenu original');
  const entree = await fichierTemporaire('dump.bin');
  const chiffre = await fichierTemporaire('dump.bin.enc');

  await fs.writeFile(entree, contenu);
  await chiffrerFichier(entree, chiffre);

  const octets = await fs.readFile(chiffre);
  octets[octets.length - 1] ^= 0xff; // altère le dernier octet du tag -> ne correspond plus
  await fs.writeFile(chiffre, octets);
  const sortie = await fichierTemporaire('sortie.bin');

  await assert.rejects(() => dechiffrerFichier(chiffre, sortie), /tag GCM invalide/);
});
