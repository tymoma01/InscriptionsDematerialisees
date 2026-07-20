const { obtenirKnex } = require('../../db/knex');
const utilisateurRepository = require('./utilisateurRepository');
const { hacherMotDePasse, verifierMotDePasse } = require('./password');

// Hash factice, calculé une seule fois au premier appel — sert à faire passer par argon2.verify
// un temps comparable même quand l'email est inconnu, pour ne pas laisser une différence de
// timing révéler l'existence d'un compte (énumération d'utilisateurs).
let promesseHachageFactice;
function hachageFactice() {
  if (!promesseHachageFactice) {
    promesseHachageFactice = hacherMotDePasse('mot-de-passe-factice-anti-timing');
  }
  return promesseHachageFactice;
}

// Payload minimal persisté en session — jamais le hash du mot de passe, jamais un champ que le
// client pourrait vouloir falsifier (c'est justement ce que corrige cette brique : uploadedBy
// vient désormais de req.session.utilisateur.id, pas du body, voir pieces.routes.js).
function construireUtilisateurSession(utilisateur) {
  return {
    id: utilisateur.id,
    entiteId: utilisateur.entite_id,
    nom: utilisateur.nom,
    prenom: utilisateur.prenom,
    email: utilisateur.email,
    roleCode: utilisateur.role_code,
  };
}

// Retourne null aussi bien pour un email inconnu que pour un mot de passe erroné — le message
// d'erreur générique est construit par l'appelant (auth.routes.js), jamais "email inconnu" vs
// "mot de passe incorrect" séparément.
async function connecter(entite, { email, motDePasse }) {
  const bd = await obtenirKnex();
  const utilisateur = await utilisateurRepository.trouverParEmail(bd, entite.id, email);

  const motDePasseValide = utilisateur
    ? await verifierMotDePasse(motDePasse, utilisateur.mot_de_passe_hash)
    : await verifierMotDePasse(motDePasse, await hachageFactice());

  if (!utilisateur || !motDePasseValide) {
    return null;
  }

  await utilisateurRepository.mettreAJourDerniereConnexion(bd, utilisateur.id, new Date());
  return construireUtilisateurSession(utilisateur);
}

module.exports = { connecter, construireUtilisateurSession };
