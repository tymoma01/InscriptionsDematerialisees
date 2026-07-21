// Amorce l'utilisateur technique d'une entité (rôle `systeme`, voir core/auth/rbac.js) —
// l'acteur attribué aux transitions de statut déclenchées automatiquement par le serveur, sans
// agent connecté (ex : fin de soumission du formulaire d'inscription par le candidat lui-même,
// voir dossierService.js). Créé avec `actif: false` : `utilisateurRepository.trouverParEmail`
// filtre sur `actif = true`, donc cet utilisateur ne peut jamais servir à se connecter, même si
// son mot de passe (aléatoire, jamais communiqué) fuitait. Idempotent, comme les autres seeds.
// Prérequis : scripts/seedEntite.js et scripts/seedRoles.js.
//
// Usage : node scripts/seedUtilisateurSysteme.js <code_entite>

const crypto = require('crypto');
const { obtenirKnex } = require('../src/db/knex');
const { hacherMotDePasse } = require('../src/core/auth/password');
const { ROLES } = require('../src/core/auth/rbac');

async function seedUtilisateurSysteme(codeEntite) {
  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: codeEntite }).first();
    if (!entite) {
      throw new Error(`Entité « ${codeEntite} » introuvable — exécuter d'abord scripts/seedEntite.js`);
    }
    const role = await bd('roles').where({ code: ROLES.SYSTEME }).first();
    if (!role) {
      throw new Error(`Rôle « ${ROLES.SYSTEME} » introuvable — exécuter d'abord scripts/seedRoles.js`);
    }

    const email = `systeme@${codeEntite}.interne`;
    const existant = await bd('utilisateurs').where({ email }).first();
    if (existant) {
      console.log(`Utilisateur système « ${email} » déjà présent (id=${existant.id}) ✔`);
      return;
    }

    const motDePasseHash = await hacherMotDePasse(crypto.randomBytes(32).toString('hex'));
    const [inseree] = await bd('utilisateurs')
      .insert({
        entite_id: entite.id,
        role_id: role.id,
        email,
        prenom: 'Système',
        nom: codeEntite,
        mot_de_passe_hash: motDePasseHash,
        actif: false,
      })
      .returning('id');
    console.log(`Utilisateur système « ${email} » créé (id=${inseree.id}) ✔`);
  } finally {
    await bd.destroy();
  }
}

const codeEntite = process.argv[2];
if (!codeEntite) {
  console.error('Usage : node scripts/seedUtilisateurSysteme.js <code_entite>');
  process.exit(1);
}

seedUtilisateurSysteme(codeEntite).catch((erreur) => {
  console.error('Échec du seed ✘');
  console.error(erreur.message);
  process.exit(1);
});
