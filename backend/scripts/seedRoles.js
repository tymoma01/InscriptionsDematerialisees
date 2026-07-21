// Amorce les 4 rôles globaux (table `roles`, migration 002_creation_table_roles.js) — pas de
// entite_id, décision déjà actée avec le développeur senior (voir docs/schema-bdd-proposition.md,
// "la table roles reste globale"). Idempotent : ré-exécutable sans dupliquer les lignes.
// Prérequis pour scripts/seedUtilisateur.js (utilisateurs.role_id référence cette table).
//
// Usage : node scripts/seedRoles.js

const { obtenirKnex } = require('../src/db/knex');
const { ROLES } = require('../src/core/auth/rbac');

const ROLES_A_AMORCER = [
  { code: ROLES.ACCUEIL_COORDINATION, libelle: 'Accueil / Coordination' },
  { code: ROLES.RECRUTEUR, libelle: 'Recruteur' },
  { code: ROLES.FORMATEUR, libelle: 'Formateur' },
  { code: ROLES.ADMIN, libelle: 'Admin' },
  { code: ROLES.SYSTEME, libelle: 'Système (automatisation)' },
];

async function seedRoles() {
  const bd = await obtenirKnex();
  try {
    for (const role of ROLES_A_AMORCER) {
      const existant = await bd('roles').where({ code: role.code }).first();
      if (existant) {
        console.log(`Rôle « ${role.code} » déjà présent (id=${existant.id}) ✔`);
        continue;
      }

      const [inseree] = await bd('roles').insert(role).returning('id');
      console.log(`Rôle « ${role.code} » créé (id=${inseree.id}) ✔`);
    }
  } finally {
    await bd.destroy();
  }
}

seedRoles().catch((erreur) => {
  console.error('Échec du seed ✘');
  console.error(erreur.message);
  process.exit(1);
});
