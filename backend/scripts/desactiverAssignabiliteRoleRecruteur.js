// Audit du rôle Recruteur (2026-08-27), étape 4 révisée (Option C) — passe `assignable` à false
// sur la ligne `roles` du recruteur (migration 055), sans supprimer cette ligne : plus aucun
// nouveau compte ne peut se voir attribuer ce rôle (utilisateurRepository.listerRolesAssignables
// filtre déjà dessus, utilisateurService.creerUtilisateur/mettreAJourUtilisateur le revalident
// indépendamment côté API), mais les 8 comptes existants qui le portent encore restent pleinement
// valides et visibles (voir désactivation séparée, scripts/desactiverComptesRoleRecruteur.js).
//
// Idempotent. Usage : node scripts/desactiverAssignabiliteRoleRecruteur.js

const { obtenirKnex } = require('../src/db/knex');
const journalAudit = require('../src/core/audit/journalAudit');

const CODE_ROLE = 'recruteur';

async function main() {
  const bd = await obtenirKnex();
  try {
    const role = await bd('roles').where({ code: CODE_ROLE }).first();
    if (!role) throw new Error(`Rôle « ${CODE_ROLE} » introuvable.`);

    if (!role.assignable) {
      console.log(`Rôle « ${CODE_ROLE} » déjà non assignable — rien à faire.`);
      return;
    }

    const entiteAccecit = await bd('entites').where({ code: 'accecit' }).first();
    const systemeAccecit = await bd('utilisateurs')
      .join('roles', 'roles.id', 'utilisateurs.role_id')
      .where({ 'utilisateurs.entite_id': entiteAccecit.id, 'roles.code': 'systeme' })
      .select('utilisateurs.id')
      .first();

    await bd.transaction(async (trx) => {
      await trx('roles').where({ id: role.id }).update({ assignable: false });
      await journalAudit.enregistrerAction(trx, {
        utilisateurId: systemeAccecit?.id ?? null,
        // `roles` est une table globale (pas de entite_id propre, voir rbac.js) — ACCECIT choisie
        // ici comme entité porteuse de l'action, cohérent avec le reste de ce chantier.
        entiteId: entiteAccecit.id,
        action: 'role_assignable_false',
        tableCible: 'roles',
        cibleId: role.id,
        donnees: {
          roleCode: CODE_ROLE,
          raison: "Audit du rôle Recruteur (2026-08-27) — plus aucune fonction dans le workflow, ligne conservée (Option C) pour ne pas casser l'affichage historique",
        },
        adresseIp: 'script:audit-role-recruteur',
      });
    });
    console.log(`Rôle « ${CODE_ROLE} » passé à assignable=false ✔`);
  } finally {
    await bd.destroy();
  }
}

main().catch((erreur) => {
  console.error('Échec ✘');
  console.error(erreur.message);
  process.exitCode = 1;
});
