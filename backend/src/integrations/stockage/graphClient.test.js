const test = require('node:test');
const assert = require('node:assert/strict');

// Même patron de rechargement que graphCalendarService.test.js : repart d'un module.cache propre
// à chaque test pour que `promesseClient` (variable de module) reparte de zéro, et mocke
// keyVaultClient.obtenirSecret (jamais un vrai appel Key Vault en test).
function chargerAvecSecretMock(t, comportement) {
  delete require.cache[require.resolve('./graphClient')];
  delete require.cache[require.resolve('../../core/securite/keyVaultClient')];
  const keyVaultClient = require('../../core/securite/keyVaultClient');
  t.mock.method(keyVaultClient, 'obtenirSecret', comportement);
  return require('./graphClient');
}

// Audit 2026-08-27 (calendrier hebdomadaire Outlook bloqué suite à un ECONNREFUSED serveur) :
// avant ce correctif, `promesseClient` gardait en cache la promesse REJETÉE du tout premier
// appel, donc un échec transitoire (Key Vault injoignable un court instant) cassait
// `obtenirClientGraph()` — et par extension tout le calendrier hebdomadaire — pour toute la
// durée de vie du process, même une fois le réseau redevenu disponible.
test("obtenirClientGraph ne garde pas en cache un échec — un appel suivant retente depuis zéro plutôt que de rejeter indéfiniment", async (t) => {
  let appel = 0;
  const graphClient = chargerAvecSecretMock(t, async () => {
    appel += 1;
    if (appel <= 3) throw new Error('Key Vault injoignable (ECONNREFUSED)');
    return 'valeur-secret-de-test';
  });

  await assert.rejects(() => graphClient.obtenirClientGraph(), /Key Vault injoignable/);

  // Deuxième appel après l'échec : doit re-déclencher obtenirSecret (donc réussir une fois le
  // "réseau" de nouveau disponible) plutôt que de rejeter à nouveau la même promesse en cache.
  const client = await graphClient.obtenirClientGraph();
  assert.ok(client);
  assert.equal(appel, 6, 'les 3 secrets doivent avoir été redemandés lors du deuxième appel');
});

test('obtenirClientGraph ne redemande les secrets qu’une seule fois après un succès (mise en cache normale)', async (t) => {
  let appel = 0;
  const graphClient = chargerAvecSecretMock(t, async () => {
    appel += 1;
    return 'valeur-secret-de-test';
  });

  const premier = await graphClient.obtenirClientGraph();
  const second = await graphClient.obtenirClientGraph();
  assert.equal(premier, second, 'le même client (même promesse) doit être réutilisé après un succès');
  assert.equal(appel, 3, 'obtenirSecret ne doit être appelé que pour le tout premier appel (3 secrets, une seule fois)');
});
