// Migration ponctuelle — audit du rôle Recruteur avant suppression (2026-08-27), étape 1/4.
//
// Contexte : l'audit a montré que pour ACCECIT, les transitions valider_dossier/rejeter_dossier
// (ancien circuit "validation recruteur") ont déjà été retirées (scripts/migrerWorkflowAccecitV4.js,
// dossiers #73/#76 clos puis supprimés). Pour ADAPTEL en revanche, ces deux mêmes codeAction
// existent TOUJOURS en base (transitions_statut, entite_id=2) et n'autorisent aujourd'hui que
// 'recruteur' et 'admin' (transition_roles) — décision actée avec l'utilisateur (confirmé : Adaptel
// n'a plus besoin du rôle Recruteur non plus) : ajouter 'accueil_coordination' à côté, AVANT toute
// suppression du rôle Recruteur, pour ne jamais laisser Admin seul capable de valider/rejeter un
// dossier chez Adaptel.
//
// Additif uniquement : ne retire ni 'recruteur' ni 'admin' ici (retrait du rôle recruteur = étape 4
// distincte, une fois plus aucun compte actif ne le porte). Idempotent (vérifie l'existant avant
// d'insérer). Transaction dédiée + entrée journal_audit par transition modifiée (utilisateurSysteme
// d'Adaptel comme auteur, même patron que scripts/corrigerDoublonsRendezvousDossier88.js).
//
// Usage : node scripts/ajouterAccueilCoordinationValidationDossierAdaptel.js

const { obtenirKnex } = require('../src/db/knex');
const journalAudit = require('../src/core/audit/journalAudit');

const CODE_ENTITE = 'adaptel';
const CODES_ACTION = ['valider_dossier', 'rejeter_dossier'];
const ROLE_A_AJOUTER = 'accueil_coordination';

async function main() {
  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: CODE_ENTITE }).first();
    if (!entite) throw new Error(`Entité « ${CODE_ENTITE} » introuvable.`);

    const roleAjoute = await bd('roles').where({ code: ROLE_A_AJOUTER }).first();
    if (!roleAjoute) throw new Error(`Rôle « ${ROLE_A_AJOUTER} » introuvable.`);

    // `.select('utilisateurs.id')` explicite : sans lui, la jointure utilisateurs/roles (deux
    // colonnes `id` homonymes) laisserait `roles.id` écraser silencieusement `utilisateurs.id`
    // dans l'objet résultat — bug réel constaté dans scripts/desactiverComptesRoleRecruteur.js,
    // resté sans symptôme ici uniquement par coïncidence (l'id du rôle 'systeme' et l'id du
    // compte système Adaptel valent tous deux 5 dans ce jeu de données).
    const utilisateurSysteme = await bd('utilisateurs')
      .join('roles', 'roles.id', 'utilisateurs.role_id')
      .where({ 'utilisateurs.entite_id': entite.id, 'roles.code': 'systeme' })
      .select('utilisateurs.id')
      .first();

    const transitions = await bd('transitions_statut').where({ entite_id: entite.id }).whereIn('code_action', CODES_ACTION);
    if (transitions.length === 0) {
      console.log(`Aucune transition ${JSON.stringify(CODES_ACTION)} trouvée pour « ${CODE_ENTITE} » — rien à faire.`);
      return;
    }

    for (const transition of transitions) {
      // eslint-disable-next-line no-await-in-loop -- 2 transitions seulement, séquentiel suffisant.
      const dejaPresent = await bd('transition_roles').where({ transition_id: transition.id, role_id: roleAjoute.id }).first();
      if (dejaPresent) {
        console.log(`« ${transition.code_action} » (id=${transition.id}) a déjà le rôle « ${ROLE_A_AJOUTER} » — rien à faire.`);
        // eslint-disable-next-line no-continue
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      await bd.transaction(async (trx) => {
        await trx('transition_roles').insert({ transition_id: transition.id, role_id: roleAjoute.id });
        await journalAudit.enregistrerAction(trx, {
          utilisateurId: utilisateurSysteme?.id ?? null,
          entiteId: entite.id,
          action: 'transition_roles_ajout_role',
          tableCible: 'transition_roles',
          cibleId: transition.id,
          donnees: {
            codeAction: transition.code_action,
            roleAjoute: ROLE_A_AJOUTER,
            raison: "Audit du rôle Recruteur (2026-08-27) — ajout d'un chemin non-admin avant suppression du rôle recruteur",
          },
          adresseIp: 'script:audit-role-recruteur',
        });
      });
      console.log(`« ${transition.code_action} » (id=${transition.id}) : rôle « ${ROLE_A_AJOUTER} » ajouté ✔`);
    }
  } finally {
    await bd.destroy();
  }
}

main().catch((erreur) => {
  console.error('Échec de la migration ✘');
  console.error(erreur.message);
  process.exitCode = 1;
});
