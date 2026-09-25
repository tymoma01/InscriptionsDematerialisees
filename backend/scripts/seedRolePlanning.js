// Amorce le rôle 'planning' (table `roles`, globale — pas de entite_id, voir seedRoles.js) —
// audit 2026-09-25 : exactement les droits d'Accueil/Coordination + le droit de forcer un statut
// (ROLES_ACCUEIL/ROLES_FORCAGE, backend/src/core/auth/rbac.js). Script dédié plutôt qu'un ajout
// dans scripts/seedRoles.js : ce dernier référence encore `ROLES.RECRUTEUR`, retiré de l'objet
// `ROLES` (rbac.js) depuis l'audit du 2026-08-27 — le réexécuter planterait sur cette ligne
// obsolète, pas dans le périmètre de ce chantier.
//
// Idempotent. Usage : node scripts/seedRolePlanning.js

const { obtenirKnex } = require('../src/db/knex');
const { ROLES } = require('../src/core/auth/rbac');

const ROLE_PLANNING = { code: ROLES.PLANNING, libelle: 'Planning' };

async function seedRolePlanning() {
  const bd = await obtenirKnex();
  try {
    const existant = await bd('roles').where({ code: ROLE_PLANNING.code }).first();
    if (existant) {
      console.log(`Rôle « ${ROLE_PLANNING.code} » déjà présent (id=${existant.id}) ✔`);
      return;
    }

    const [inseree] = await bd('roles').insert(ROLE_PLANNING).returning('id');
    console.log(`Rôle « ${ROLE_PLANNING.code} » créé (id=${inseree.id}) ✔`);
  } finally {
    await bd.destroy();
  }
}

seedRolePlanning().catch((erreur) => {
  console.error('Échec du seed ✘');
  console.error(erreur.message);
  process.exit(1);
});
