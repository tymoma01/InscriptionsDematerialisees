const { test } = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');

// config/env.js lit process.env au chargement du module (pas à chaque accès), et
// entiteContext.middleware.js déstructure ENTITE_PAR_DEFAUT/HOTES_ENTITE_PAR_DEFAUT ainsi que
// obtenirKnex AU CHARGEMENT (const { obtenirKnex } = require(...)) — une référence figée, pas une
// lecture différée de la propriété du module. Deux conséquences pour les tests :
// 1) il faut vider le cache require des deux modules avant chaque scénario pour rejouer des
//    valeurs d'env différentes ;
// 2) t.mock.method(db, 'obtenirKnex', ...) DOIT être appelé AVANT ce rechargement, sinon le
//    middleware capture la vraie fonction (déjà vue provoquer de vrais appels réseau vers
//    Key Vault/Neon pendant les tests) et le mock posé après n'a plus aucun effet.
// Autre piège : on affecte une chaîne vide plutôt que de `delete` une clé pour "l'absence" —
// dotenv (voir config/env.js) ne réinjecte pas une clé déjà présente dans process.env (même
// vide), mais réinjecterait la vraie valeur de backend/.env pour une clé absente.
function chargerEntiteContext(env) {
  delete require.cache[require.resolve('../../config/env')];
  delete require.cache[require.resolve('./entiteContext.middleware')];

  const cles = ['ENTITE_PAR_DEFAUT', 'HOTES_ENTITE_PAR_DEFAUT'];
  const sauvegarde = Object.fromEntries(cles.map((cle) => [cle, process.env[cle]]));
  cles.forEach((cle) => {
    process.env[cle] = env[cle] ?? '';
  });

  const { entiteContext } = require('./entiteContext.middleware');

  cles.forEach((cle) => {
    if (sauvegarde[cle] === undefined) delete process.env[cle];
    else process.env[cle] = sauvegarde[cle];
  });

  return entiteContext;
}

// Fake knex minimal : bd('entites').where({...}).first() — capture les critères passés à
// where() pour vérifier que le bon codeEntite est cherché en base.
function creerFakeBd(entiteRetournee) {
  const appels = [];
  const bd = (table) => ({
    where(criteres) {
      appels.push({ table, criteres });
      return { first: async () => entiteRetournee };
    },
  });
  return { bd, appels };
}

function creerReponseMock() {
  const res = {
    statutRecu: null,
    jsonRecu: null,
    status(code) {
      this.statutRecu = code;
      return this;
    },
    json(corps) {
      this.jsonRecu = corps;
      return this;
    },
  };
  return res;
}

test('entiteContext résout l\'entité par sous-domaine (cas nominal, aucun repli)', async (t) => {
  const { bd, appels } = creerFakeBd({ id: 'uuid-adaptel', code: 'adaptel', actif: true });
  t.mock.method(db, 'obtenirKnex', async () => bd);
  const entiteContext = chargerEntiteContext({ ENTITE_PAR_DEFAUT: 'accecit' });

  const req = { hostname: 'adaptel.exemple.fr' };
  const res = creerReponseMock();
  let suivantAppele = false;

  await entiteContext(req, res, () => {
    suivantAppele = true;
  });

  assert.equal(suivantAppele, true);
  assert.deepEqual(req.entite, { id: 'uuid-adaptel', code: 'adaptel', actif: true });
  assert.deepEqual(appels[0].criteres, { code: 'adaptel', actif: true });
});

test('entiteContext : hostname listé dans HOTES_ENTITE_PAR_DEFAUT utilise ENTITE_PAR_DEFAUT (domaine perso de prod)', async (t) => {
  const { bd, appels } = creerFakeBd({ id: 'uuid-accecit', code: 'accecit', actif: true });
  t.mock.method(db, 'obtenirKnex', async () => bd);
  const entiteContext = chargerEntiteContext({
    ENTITE_PAR_DEFAUT: 'accecit',
    HOTES_ENTITE_PAR_DEFAUT: 'inscriptions.accecit.com, autre-domaine.fr',
  });

  const req = { hostname: 'inscriptions.accecit.com' };
  const res = creerReponseMock();
  let suivantAppele = false;

  await entiteContext(req, res, () => {
    suivantAppele = true;
  });

  assert.equal(suivantAppele, true);
  assert.deepEqual(req.entite, { id: 'uuid-accecit', code: 'accecit', actif: true });
  // Vérifie que c'est bien ENTITE_PAR_DEFAUT ("accecit") qui a été cherché, pas "inscriptions".
  assert.deepEqual(appels[0].criteres, { code: 'accecit', actif: true });
});

test('entiteContext : hostname absent de HOTES_ENTITE_PAR_DEFAUT et non reconnu -> 404 (comme avant)', async (t) => {
  const { bd } = creerFakeBd(undefined);
  t.mock.method(db, 'obtenirKnex', async () => bd);
  const entiteContext = chargerEntiteContext({
    ENTITE_PAR_DEFAUT: 'accecit',
    HOTES_ENTITE_PAR_DEFAUT: 'inscriptions.accecit.com',
  });

  const req = { hostname: 'inconnu.exemple.fr' };
  const res = creerReponseMock();
  let suivantAppele = false;

  await entiteContext(req, res, () => {
    suivantAppele = true;
  });

  assert.equal(suivantAppele, false);
  assert.equal(res.statutRecu, 404);
  assert.match(res.jsonRecu.erreur, /introuvable ou inactive/);
});

test('entiteContext : hostname mono-label utilise toujours ENTITE_PAR_DEFAUT (cas existant, non régressé)', async (t) => {
  const { bd, appels } = creerFakeBd({ id: 'uuid-accecit', code: 'accecit', actif: true });
  t.mock.method(db, 'obtenirKnex', async () => bd);
  const entiteContext = chargerEntiteContext({
    ENTITE_PAR_DEFAUT: 'accecit',
    HOTES_ENTITE_PAR_DEFAUT: 'inscriptions.accecit.com',
  });

  const req = { hostname: 'backend-interne' };
  const res = creerReponseMock();

  await entiteContext(req, res, () => {});

  assert.deepEqual(appels[0].criteres, { code: 'accecit', actif: true });
});

test('entiteContext : ni repli ni ENTITE_PAR_DEFAUT configuré -> 400', async (t) => {
  const { bd } = creerFakeBd(undefined);
  t.mock.method(db, 'obtenirKnex', async () => bd);
  const entiteContext = chargerEntiteContext({ ENTITE_PAR_DEFAUT: '' });

  const req = { hostname: 'localhost' };
  const res = creerReponseMock();
  let suivantAppele = false;

  await entiteContext(req, res, () => {
    suivantAppele = true;
  });

  assert.equal(suivantAppele, false);
  assert.equal(res.statutRecu, 400);
});
