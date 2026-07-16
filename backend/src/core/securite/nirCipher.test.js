const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// On simule le client Key Vault AVANT de charger nirCipher.js, pour que ses fonctions
// (capturées par déstructuration au chargement du module) pointent vers ce mock —
// aucun appel réseau réel à Azure Key Vault dans ces tests.
const keyVaultClient = require('./keyVaultClient');

const CLE_TEST_BASE64 = crypto.randomBytes(32).toString('base64');
let nombreAppelsObtenirSecret = 0;

keyVaultClient.obtenirSecret = async (nomSecret) => {
  nombreAppelsObtenirSecret += 1;
  assert.equal(nomSecret, 'nir-encryption-key');
  return CLE_TEST_BASE64;
};
keyVaultClient.invaliderSecret = () => {};

const { chiffrerNir, dechiffrerNir, chiffrerNirPourColonnes, dechiffrerNirDepuisColonnes } = require('./nirCipher');

test('chiffrer puis déchiffrer redonne la valeur d\'origine', async () => {
  const nir = '1850578006048';
  const chiffre = await chiffrerNir(nir);
  const dechiffre = await dechiffrerNir(chiffre);
  assert.equal(dechiffre, nir);
});

test('le NIR en clair n\'apparaît jamais dans la valeur chiffrée', async () => {
  const nir = '1850578006048';
  const chiffre = await chiffrerNir(nir);
  assert.ok(!chiffre.includes(nir));
});

test('deux chiffrements du même NIR produisent des résultats différents (IV aléatoire)', async () => {
  const nir = '1850578006048';
  const a = await chiffrerNir(nir);
  const b = await chiffrerNir(nir);
  assert.notEqual(a, b);
});

test('la clé Key Vault est récupérée une seule fois grâce au cache', async () => {
  const avant = nombreAppelsObtenirSecret;
  await chiffrerNir('269054958815780');
  await chiffrerNir('269054958815781');
  await dechiffrerNir(await chiffrerNir('269054958815782'));
  assert.equal(nombreAppelsObtenirSecret, avant);
});

test('rejette une entrée vide ou non-string', async () => {
  await assert.rejects(() => chiffrerNir(''), /chaîne non vide/);
  await assert.rejects(() => chiffrerNir(undefined), /chaîne non vide/);
});

test('déchiffrement d\'un format invalide lève une erreur claire', async () => {
  await assert.rejects(() => dechiffrerNir('ceci n\'est pas du JSON'), /[Ff]ormat.*invalide/);
  await assert.rejects(() => dechiffrerNir(JSON.stringify({ iv: 'x' })), /[Ff]ormat.*invalide/);
});

test('un tag GCM invalide (donnée corrompue) est détecté et signalé clairement', async () => {
  const nir = '1234567890123';
  const chiffre = await chiffrerNir(nir);
  const objet = JSON.parse(chiffre);
  const donneesCorrompues = Buffer.from(objet.donnees, 'base64');
  donneesCorrompues[donneesCorrompues.length - 1] ^= 0xff; // altère un octet -> le tag ne correspond plus
  objet.donnees = donneesCorrompues.toString('base64');

  await assert.rejects(
    () => dechiffrerNir(JSON.stringify(objet)),
    (erreur) => {
      assert.match(erreur.message, /tag GCM invalide/);
      assert.ok(!erreur.message.includes(nir), 'le NIR en clair ne doit jamais apparaître dans un message d\'erreur');
      return true;
    }
  );
});

test('chiffrerNirPourColonnes / dechiffrerNirDepuisColonnes round-trip (colonnes bytea nir + nir_iv)', async () => {
  const nir = '2850578006123';
  const { nir: colonneNir, nirIv } = await chiffrerNirPourColonnes(nir);
  assert.ok(Buffer.isBuffer(colonneNir));
  assert.ok(Buffer.isBuffer(nirIv));
  assert.ok(!colonneNir.toString('utf8').includes(nir));

  const dechiffre = await dechiffrerNirDepuisColonnes(colonneNir, nirIv);
  assert.equal(dechiffre, nir);
});

test('dechiffrerNirDepuisColonnes rejette des arguments qui ne sont pas des Buffer', async () => {
  await assert.rejects(() => dechiffrerNirDepuisColonnes('pas-un-buffer', Buffer.alloc(12)), /Buffer/);
});

test('aucune fuite du NIR en clair dans les erreurs, quelle que soit la panne', async () => {
  const nir = '9998887776655';
  const chiffre = await chiffrerNir(nir);

  const tentativesEnErreur = [
    () => dechiffrerNir('valeur-completement-invalide'),
    () => dechiffrerNir(JSON.stringify({ ...JSON.parse(chiffre), tag: 'dGFnLWFsdGVyZQ==' })),
  ];

  for (const tentative of tentativesEnErreur) {
    try {
      await tentative();
      assert.fail('un déchiffrement invalide aurait dû lever une erreur');
    } catch (erreur) {
      assert.ok(!erreur.message.includes(nir));
      assert.ok(!JSON.stringify(erreur).includes(nir));
    }
  }
});
