// Amorce (ou met à jour) un utilisateur interne (auth) pour une entité + rôle donnés — utile en
// développement pour tester l'authentification/RBAC de bout en bout tant qu'aucune UI
// d'administration des utilisateurs n'existe (gestion des comptes hors périmètre de ce chantier,
// voir CLAUDE.auth-rbac.md). Idempotent sur l'email : ré-exécutable pour changer le mot de passe
// d'un utilisateur existant. Prérequis : scripts/seedEntite.js et scripts/seedRoles.js.
//
// Usage : node scripts/seedUtilisateur.js <code_entite> <code_role> <email> <prenom> <nom> <mot_de_passe>
// Exemple : node scripts/seedUtilisateur.js accecit recruteur recruteur@accecit.test Jeanne Dupont "un-mot-de-passe-fort"

const { obtenirKnex } = require('../src/db/knex');
const { hacherMotDePasse } = require('../src/core/auth/password');

async function seedUtilisateur(codeEntite, codeRole, email, prenom, nom, motDePasse) {
  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: codeEntite }).first();
    if (!entite) {
      throw new Error(`Entité « ${codeEntite} » introuvable — exécuter d'abord scripts/seedEntite.js`);
    }
    const role = await bd('roles').where({ code: codeRole }).first();
    if (!role) {
      throw new Error(`Rôle « ${codeRole} » introuvable — exécuter d'abord scripts/seedRoles.js`);
    }

    const motDePasseHash = await hacherMotDePasse(motDePasse);
    const existant = await bd('utilisateurs').where({ email }).first();

    if (existant) {
      await bd('utilisateurs').where({ email }).update({
        entite_id: entite.id,
        role_id: role.id,
        prenom,
        nom,
        mot_de_passe_hash: motDePasseHash,
        actif: true,
      });
      console.log(`Utilisateur « ${email} » déjà présent (id=${existant.id}) — mis à jour ✔`);
    } else {
      const [inseree] = await bd('utilisateurs')
        .insert({ entite_id: entite.id, role_id: role.id, email, prenom, nom, mot_de_passe_hash: motDePasseHash })
        .returning('id');
      console.log(`Utilisateur « ${email} » créé (id=${inseree.id}) ✔`);
    }
  } finally {
    await bd.destroy();
  }
}

const [codeEntite, codeRole, email, prenom, nom, motDePasse] = process.argv.slice(2);
if (!codeEntite || !codeRole || !email || !prenom || !nom || !motDePasse) {
  console.error(
    'Usage : node scripts/seedUtilisateur.js <code_entite> <code_role> <email> <prenom> <nom> <mot_de_passe>',
  );
  process.exit(1);
}

seedUtilisateur(codeEntite, codeRole, email, prenom, nom, motDePasse).catch((erreur) => {
  console.error('Échec du seed ✘');
  console.error(erreur.message);
  process.exit(1);
});
