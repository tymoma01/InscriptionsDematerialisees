// Amorce les 4 rôles globaux (table `roles`, migration 002_creation_table_roles.js) — pas de
// entite_id, décision déjà actée avec le développeur senior (voir docs/schema-bdd-proposition.md,
// "la table roles reste globale"). Idempotent : ré-exécutable sans dupliquer les lignes.
// Prérequis pour scripts/seedUtilisateur.js (utilisateurs.role_id référence cette table).
//
// Usage : node scripts/seedRoles.js

const { obtenirKnex } = require('../src/db/knex');
const { ROLES } = require('../src/core/auth/rbac');

// ROLES.RECRUTEUR retiré (correctif 2026-09-28, module Demandes DPAE) : ce rôle n'existe plus
// dans rbac.js depuis sa suppression du projet (audit 2026-08-27, voir son commentaire d'en-tête —
// "rôle supprimé de la table `roles` en base, les 8 comptes qui le portaient désactivés"). L'entrée
// valait donc `{ code: undefined, libelle: 'Recruteur' }`, ce que Knex refuse dans un `where` —
// le script plantait dès cette ligne, avant même d'atteindre toute entrée placée après elle (ici,
// ROLES.RH ci-dessous).
const ROLES_A_AMORCER = [
  { code: ROLES.ACCUEIL_COORDINATION, libelle: 'Accueil / Coordination' },
  { code: ROLES.FORMATEUR, libelle: 'Formateur' },
  { code: ROLES.INSPECTEUR, libelle: 'Inspecteur' },
  { code: ROLES.ADMIN, libelle: 'Admin' },
  // RH (module Demandes DPAE, 2026-09-28) : traite/valide/rejette les demandes DPAE — voir
  // core/auth/rbac.js, ROLES_DPAE_RH.
  { code: ROLES.RH, libelle: 'RH' },
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
