// Duplique, dans `transition_roles` (migration 006), toutes les lignes où un rôle de référence
// (`accueil_coordination`) est autorisé, vers chacun des autres rôles listés dans
// ROLES_EQUIVALENTS_ACCUEIL ci-dessous — audit 2026-09-25, rôle Planning : Planning doit avoir
// EXACTEMENT les mêmes transitions déclenchables qu'Accueil/Coordination.
//
// Générique et piloté par la base, PAS par une liste de codeAction en dur par entité (contrairement
// à scripts/seedTransitionRoles.js, propre à ACCECIT) : ce script relit simplement les lignes
// transition_roles DÉJÀ posées pour le rôle de référence, quelle que soit l'entité ou le codeAction
// — fonctionne donc identiquement pour ACCECIT (6 transitions) et Adaptel (valider_dossier/
// rejeter_dossier), sans qu'il faille les connaître ni les maintenir ici. Le prochain rôle qui
// devra hériter des mêmes droits qu'Accueil/Coordination n'a qu'à être ajouté à la liste
// ROLES_EQUIVALENTS_ACCUEIL ci-dessous — un seul endroit à modifier.
//
// Idempotent : `INSERT` uniquement si la ligne (transition_id, role_id) n'existe pas déjà.
// Prérequis : scripts/seedRoles.js + scripts/seedTransitionRoles.js (ACCECIT) déjà exécutés (ce
// script ne fait que dupliquer des lignes existantes, il n'en crée aucune pour le rôle de
// référence lui-même).
//
// Usage : node scripts/seedRolesEquivalentsAccueil.js

const { obtenirKnex } = require('../src/db/knex');

const ROLE_REFERENCE = 'accueil_coordination';
// Rôles qui doivent recevoir EXACTEMENT les mêmes lignes transition_roles que ROLE_REFERENCE
// ci-dessus (hors lui-même, jamais dupliqué sur lui-même). Ajouter un futur rôle "équivalent
// Accueil" ici suffit à le couvrir, sans toucher au reste de ce script.
const ROLES_EQUIVALENTS_ACCUEIL = ['planning'];

async function seedRolesEquivalentsAccueil() {
  const bd = await obtenirKnex();
  try {
    const roleReference = await bd('roles').where({ code: ROLE_REFERENCE }).first();
    if (!roleReference) {
      throw new Error(`Rôle de référence « ${ROLE_REFERENCE} » introuvable — exécuter d'abord scripts/seedRoles.js`);
    }

    // Toutes les transitions autorisées pour le rôle de référence, avec le contexte (entité +
    // codeAction) uniquement pour un affichage lisible dans les logs — jamais utilisé pour décider
    // quoi dupliquer (voir commentaire d'en-tête).
    const lignesReference = await bd('transition_roles as tr')
      .join('transitions_statut as ts', 'ts.id', 'tr.transition_id')
      .join('entites as e', 'e.id', 'ts.entite_id')
      .where('tr.role_id', roleReference.id)
      .select('tr.transition_id', 'ts.code_action', 'e.code as entite_code');

    console.log(`${lignesReference.length} ligne(s) transition_roles trouvée(s) pour « ${ROLE_REFERENCE} ».`);

    for (const codeRole of ROLES_EQUIVALENTS_ACCUEIL) {
      const role = await bd('roles').where({ code: codeRole }).first();
      if (!role) {
        console.log(`Rôle « ${codeRole} » introuvable — exécuter d'abord scripts/seedRolePlanning.js (ou équivalent), ignoré.`);
        continue;
      }

      for (const ligne of lignesReference) {
        const existant = await bd('transition_roles')
          .where({ transition_id: ligne.transition_id, role_id: role.id })
          .first();
        if (existant) {
          console.log(
            `« ${codeRole} » déjà autorisé pour « ${ligne.code_action} » (« ${ligne.entite_code} », transition_id=${ligne.transition_id}) ✔`,
          );
          continue;
        }

        await bd('transition_roles').insert({ transition_id: ligne.transition_id, role_id: role.id });
        console.log(
          `« ${codeRole} » autorisé pour « ${ligne.code_action} » (« ${ligne.entite_code} », transition_id=${ligne.transition_id}) ✔`,
        );
      }
    }
  } finally {
    await bd.destroy();
  }
}

seedRolesEquivalentsAccueil().catch((erreur) => {
  console.error('Échec du seed ✘');
  console.error(erreur.message);
  process.exit(1);
});
