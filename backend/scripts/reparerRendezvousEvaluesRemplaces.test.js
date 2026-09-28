// Couvre uniquement determinerStatutTraitement (fonction pure, aucun accès base) — les 4
// conditions du point 2 de la demande, dans leur ordre de vérification, plus les deux cas de sortie
// hors "ignoré simple" (INTROUVABLE, DEJA_TRAITE). Hors du glob "src/**/*.test.js" de `npm test`
// (ce fichier vit dans scripts/, pas src/) : à lancer explicitement avec
// `node --test scripts/reparerRendezvousEvaluesRemplaces.test.js` depuis backend/.
const test = require('node:test');
const assert = require('node:assert/strict');

const { determinerStatutTraitement, resoudreUtilisateurSysteme } = require('./reparerRendezvousEvaluesRemplaces');

test('rendez-vous introuvable -> INTROUVABLE', () => {
  const decision = determinerStatutTraitement({ rendezvous: null, aEvaluation: false, aRendezvousTestPlusRecent: false });
  assert.equal(decision.code, 'INTROUVABLE');
});

test("rendez-vous déjà à 'honore' -> DEJA_TRAITE (idempotence)", () => {
  const decision = determinerStatutTraitement({
    rendezvous: { statut: 'honore', type_rdv: 'test' },
    aEvaluation: true,
    aRendezvousTestPlusRecent: false,
  });
  assert.equal(decision.code, 'DEJA_TRAITE');
});

test("statut différent de 'remplace' (et de 'honore') -> IGNORE, raison explicite", () => {
  const decision = determinerStatutTraitement({
    rendezvous: { statut: 'prevu', type_rdv: 'test' },
    aEvaluation: true,
    aRendezvousTestPlusRecent: false,
  });
  assert.equal(decision.code, 'IGNORE');
  assert.match(decision.raison, /statut actuel « prevu »/);
});

test("statut 'remplace' mais type_rdv différent de 'test' -> IGNORE", () => {
  const decision = determinerStatutTraitement({
    rendezvous: { statut: 'remplace', type_rdv: 'entretien' },
    aEvaluation: true,
    aRendezvousTestPlusRecent: false,
  });
  assert.equal(decision.code, 'IGNORE');
  assert.match(decision.raison, /type_rdv « entretien »/);
});

test('statut/type corrects mais aucune évaluation liée -> IGNORE', () => {
  const decision = determinerStatutTraitement({
    rendezvous: { statut: 'remplace', type_rdv: 'test' },
    aEvaluation: false,
    aRendezvousTestPlusRecent: false,
  });
  assert.equal(decision.code, 'IGNORE');
  assert.match(decision.raison, /aucune évaluation liée/);
});

test('statut/type/évaluation corrects mais un rendez-vous test plus récent existe -> IGNORE', () => {
  const decision = determinerStatutTraitement({
    rendezvous: { statut: 'remplace', type_rdv: 'test' },
    aEvaluation: true,
    aRendezvousTestPlusRecent: true,
  });
  assert.equal(decision.code, 'IGNORE');
  assert.match(decision.raison, /rendez-vous test plus récent/);
});

test('les 4 conditions réunies -> ELIGIBLE', () => {
  const decision = determinerStatutTraitement({
    rendezvous: { statut: 'remplace', type_rdv: 'test' },
    aEvaluation: true,
    aRendezvousTestPlusRecent: false,
  });
  assert.equal(decision.code, 'ELIGIBLE');
});

// resoudreUtilisateurSysteme (bug prod 2026-09-28, point 5 de la demande) — fake query builder
// minimal (join/where/select/first chaînables), suffisant pour vérifier la forme de la requête et
// le comportement de cache, sans dépendre d'une vraie connexion (même esprit que les mocks
// bd.transaction utilisés ailleurs dans ce projet, ex. dossierService.test.js).
function creerBdFactice(resultat) {
  const appels = [];
  const builder = {
    join(...args) {
      appels.push({ methode: 'join', args });
      return builder;
    },
    where(...args) {
      appels.push({ methode: 'where', args });
      return builder;
    },
    select(...args) {
      appels.push({ methode: 'select', args });
      return builder;
    },
    first: async () => resultat,
  };
  const bd = (...args) => {
    appels.push({ methode: 'from', args });
    return builder;
  };
  bd.appels = appels;
  return bd;
}

test('resoudreUtilisateurSysteme renvoie l\'id du compte "systeme" trouvé pour l\'entité, filtré par entite_id et roles.code', async () => {
  const bd = creerBdFactice({ id: 2 });
  const cache = new Map();

  const resultat = await resoudreUtilisateurSysteme(bd, 1, cache);

  assert.equal(resultat, 2);
  const appelWhere = bd.appels.find((a) => a.methode === 'where');
  assert.deepEqual(appelWhere.args[0], { 'utilisateurs.entite_id': 1, 'roles.code': 'systeme' });
});

test('resoudreUtilisateurSysteme renvoie null (jamais une exception) si aucun compte "systeme" pour cette entité', async () => {
  const bd = creerBdFactice(undefined);
  const cache = new Map();

  const resultat = await resoudreUtilisateurSysteme(bd, 999, cache);

  assert.equal(resultat, null);
});

test('resoudreUtilisateurSysteme met en cache (un succès comme un échec) — un second appel pour la même entité ne relance aucune requête', async () => {
  const bd = creerBdFactice({ id: 5 });
  const cache = new Map();

  const premier = await resoudreUtilisateurSysteme(bd, 2, cache);
  const nbAppelsApresPremier = bd.appels.length;
  const second = await resoudreUtilisateurSysteme(bd, 2, cache);

  assert.equal(premier, 5);
  assert.equal(second, 5);
  assert.equal(bd.appels.length, nbAppelsApresPremier, 'aucun nouvel appel au query builder pour une entité déjà en cache');
});

test('resoudreUtilisateurSysteme accepte indifféremment bd ou trx (même signature de query builder) — condition du correctif : résolution possible AVANT ouverture de la transaction', async () => {
  const bdFactice = creerBdFactice({ id: 7 });
  const trxFactice = creerBdFactice({ id: 7 });
  const cache = new Map();

  const viaBd = await resoudreUtilisateurSysteme(bdFactice, 3, cache);
  cache.clear();
  const viaTrx = await resoudreUtilisateurSysteme(trxFactice, 3, cache);

  assert.equal(viaBd, 7);
  assert.equal(viaTrx, 7);
});
