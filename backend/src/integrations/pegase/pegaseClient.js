const { obtenirSecret } = require('../../core/securite/keyVaultClient');
const { NODE_ENV } = require('../../config/env');

// Client des web services Pégase (IDSoft, doc « Web Services Appli Externe v1.58 »). ACCECIT a une
// base Pégase par division (Hôtellerie, Tertiaire), chacune avec son propre token : chaque appel
// part de la base choisie par pegaseSalarieService (entites.pegase_config.bases).
//
// Le token est lié à un utilisateur Pégase : il lui faut les droits « Etat civil d'un salarié »
// (lecture de la liste et création) et « Documents associés du salarié » (ajout des pièces).
// Un secret Key Vault par base et par environnement, comme la base Neon : hors production, le nom
// configuré reçoit le suffixe « -dev ». Ces secrets sont absents, et aucun salarié ne peut être créé
// par erreur dans un Pégase réel depuis un poste de développement.
const URL_PAR_DEFAUT = 'https://extranet.accecit.com:3053/externepegase/rest';
const DELAI_MS = 60_000;

const nomSecret = (secret) => (NODE_ENV === 'production' ? secret : `${secret}-dev`);

class ErreurPegase extends Error {}

// Pégase détaille une erreur 422 sous la forme {"ressource": {"ERROR": "message"}} (doc §2.1.3) ;
// la casse de la clé varie selon les web services (« Erreur » observé sur nbPersonnelActif).
async function messageErreur(reponse, ressource) {
  let detail = '';
  try {
    const corps = await reponse.json();
    const contenu = corps?.[ressource] ?? corps;
    detail = contenu?.ERROR ?? contenu?.Erreur ?? contenu?.erreur ?? JSON.stringify(contenu);
  } catch {
    // Corps vide ou HTML (419 renvoie une page HTML) : le code HTTP suffit.
  }
  if (reponse.status === 401 || reponse.status === 403) {
    return `Accès refusé par Pégase à « ${ressource} » (HTTP ${reponse.status}) : vérifier les droits de l'utilisateur Pégase lié au token.`;
  }
  return `Pégase a refusé « ${ressource} » (HTTP ${reponse.status})${detail ? ` : ${detail}` : ''}.`;
}

// Une session par envoi : POST /session avec le token, l'id renvoyé part ensuite dans l'en-tête
// X-SessionId de chaque appel (doc §2.2). `base` : { url?, secret }.
async function ouvrirSession(base) {
  const url = (base.url ?? URL_PAR_DEFAUT).replace(/\/+$/, '');
  const secret = nomSecret(base.secret);
  let token;
  try {
    token = await obtenirSecret(secret);
  } catch (erreur) {
    throw new ErreurPegase(`Token Pégase introuvable dans Key Vault (secret « ${secret} »).`, { cause: erreur });
  }
  const reponse = await fetch(`${url}/session`, {
    method: 'POST',
    signal: AbortSignal.timeout(DELAI_MS),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: { token } }),
  });
  if (reponse.status === 419) throw new ErreurPegase(`Token Pégase refusé (419) : vérifier le secret « ${secret} ».`);
  if (!reponse.ok) throw new ErreurPegase(`Échec d'ouverture de session Pégase : HTTP ${reponse.status}.`);
  const corps = await reponse.json();
  if (!corps?.session?.id) throw new ErreurPegase("Réponse de session Pégase inattendue (pas d'identifiant de session).");
  return { url, sessionId: corps.session.id };
}

async function appeler(session, methode, ressource, { parametres, corps } = {}) {
  const requete = parametres ? `?${new URLSearchParams(parametres)}` : '';
  const reponse = await fetch(`${session.url}/${ressource}${requete}`, {
    method: methode,
    signal: AbortSignal.timeout(DELAI_MS),
    headers: { 'X-SessionId': session.sessionId, ...(corps ? { 'Content-Type': 'application/json' } : {}) },
    body: corps ? JSON.stringify({ [ressource]: corps }) : undefined,
  });
  // 404 = aucun résultat pour une lecture (Pégase ne renvoie pas de liste vide, doc §2.1.3).
  if (methode === 'GET' && reponse.status === 404) return null;
  if (!reponse.ok) throw new ErreurPegase(await messageErreur(reponse, ressource));
  return (await reponse.json())?.[ressource] ?? null;
}

// Tous les salariés, cachés compris (salariés sortis) : un ancien salarié qui revient ne doit pas
// être recréé. `cache=-1` (« tous » selon la doc) renvoie en réalité une liste vide : on fait donc
// deux lectures. Les fiches complètes (NIR, IBAN…) ne sortent jamais de ce module : seuls les
// champs utiles au contrôle de doublon et aux référentiels sont gardés.
async function listerSalaries(session) {
  const [visibles, caches] = await Promise.all([
    appeler(session, 'GET', 'personnels', { parametres: { cache: '0' } }),
    appeler(session, 'GET', 'personnels', { parametres: { cache: '1' } }),
  ]);
  return [...(visibles?.list ?? []), ...(caches?.list ?? [])].map((salarie) => ({
    id: salarie.id,
    nom: salarie.nom,
    prenom: salarie.prenom,
    dateNaissance: salarie.dateNaissance,
    numeroSS: salarie.numeroSS,
    nationalite: salarie.nationalite,
    nomNationalite: salarie.nomNationalite,
    pays: salarie.pays,
    libellePays: salarie.libellePays,
  }));
}

// Création : PUT /personnel sans identifiant (doc §3.10.11). Renvoie l'id du salarié créé.
async function creerSalarie(session, salarie) {
  const resultat = await appeler(session, 'PUT', 'personnel', { corps: salarie });
  if (!resultat?.id) throw new ErreurPegase("Pégase n'a pas renvoyé l'identifiant du salarié créé.");
  return String(resultat.id);
}

// Ajout d'un document sur un salarié : fichier en base64 (doc §3.10.1).
async function ajouterDocument(session, { personnelId, nomFichier, contenu, libelle, codeTypeDocument }) {
  await appeler(session, 'PUT', 'ajoutDocPersonnel', {
    corps: {
      personnel: personnelId,
      nom: nomFichier,
      data: contenu.toString('base64'),
      info: libelle,
      codeTypeDoc: codeTypeDocument,
    },
  });
}

module.exports = { ErreurPegase, ouvrirSession, listerSalaries, creerSalarie, ajouterDocument };
