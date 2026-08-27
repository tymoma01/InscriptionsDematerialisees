// Audit du rôle Recruteur (2026-08-27), étapes 3 et purge de sessions — désactive les 4 comptes
// encore actifs (les 4 autres l'étaient déjà) : #4 Jeanne Dupont, #7 Bruno Adaptel, #23 Test KPI,
// #75 Test Redirection. Ne supprime AUCUN compte (voir CLAUDE.md, utilisateurService.js : jamais
// de suppression physique exposée, la traçabilité RGPD dépend de ces lignes — journal_audit,
// notes_dossier, pieces_justificatives, relances, rendezvous, evaluations les référencent toutes
// par FK NOT NULL).
//
// Une transaction séparée PAR COMPTE (UPDATE actif=false + entrée journal_audit
// 'utilisateur_desactivation'), comme demandé — pas une seule transaction globale, pour qu'un
// éventuel échec sur l'un des 4 comptes n'empêche pas les autres d'être traités.
//
// Purge des sessions actives de ces 4 comptes APRÈS les 4 désactivations (jamais avant) : `actif`
// n'est vérifié qu'à la connexion (voir authService.js), jamais réévalué par requête — sans cette
// purge, une session déjà ouverte resterait valide jusqu'à son expiration naturelle (2h,
// session.js). `sess` est stocké en JSON (colonne `json`, pas `jsonb`, table connect-pg-simple) :
// ->'utilisateur'->>'id' fonctionne identiquement sur les deux types.
//
// Idempotent : un compte déjà actif=false n'est pas retouché (pas de nouvelle entrée
// journal_audit pour un no-op), et une session déjà purgée ne remonte simplement plus au tour
// suivant.
//
// Usage : node scripts/desactiverComptesRoleRecruteur.js

const { obtenirKnex } = require('../src/db/knex');
const journalAudit = require('../src/core/audit/journalAudit');

const COMPTES_A_DESACTIVER = [
  { id: 4, entiteId: 1, label: 'Jeanne Dupont (recruteur@accecit.test)' },
  { id: 7, entiteId: 2, label: 'Bruno Adaptel (recruteur@adaptel.test)' },
  { id: 23, entiteId: 1, label: 'Test KPI (test.kpi@accecit.test)' },
  { id: 75, entiteId: 1, label: 'Test Redirection (test.redirection.indicateurs@accecit.test)' },
];

async function main() {
  const bd = await obtenirKnex();
  try {
    console.log('--- Désactivation des comptes ---');
    for (const compte of COMPTES_A_DESACTIVER) {
      // eslint-disable-next-line no-await-in-loop -- 4 comptes seulement, séquentiel suffisant.
      const utilisateur = await bd('utilisateurs').where({ id: compte.id }).first();
      if (!utilisateur) {
        console.log(`Compte #${compte.id} (${compte.label}) introuvable — ignoré.`);
        // eslint-disable-next-line no-continue
        continue;
      }
      if (!utilisateur.actif) {
        console.log(`Compte #${compte.id} (${compte.label}) déjà désactivé — rien à faire.`);
        // eslint-disable-next-line no-continue
        continue;
      }

      // `.select('utilisateurs.id', ...)` explicite, jamais un `.first()` sans `.select()` sur une
      // jointure utilisateurs/roles : les deux tables ont chacune une colonne `id`, et sans
      // sélection explicite, `roles.id` (colonne sélectionnée en dernier par la jointure) écrase
      // silencieusement `utilisateurs.id` dans l'objet résultat — bug constaté ici même (corrigé
      // avant la première exécution correcte de ce script, voir le correctif appliqué en base
      // après coup pour les 3 entrées déjà écrites avec le mauvais id).
      // eslint-disable-next-line no-await-in-loop
      const utilisateurSysteme = await bd('utilisateurs')
        .join('roles', 'roles.id', 'utilisateurs.role_id')
        .where({ 'utilisateurs.entite_id': compte.entiteId, 'roles.code': 'systeme' })
        .select('utilisateurs.id')
        .first();

      // eslint-disable-next-line no-await-in-loop
      await bd.transaction(async (trx) => {
        await trx('utilisateurs').where({ id: compte.id }).update({ actif: false });
        await journalAudit.enregistrerAction(trx, {
          utilisateurId: utilisateurSysteme?.id ?? null,
          entiteId: compte.entiteId,
          action: 'utilisateur_desactivation',
          tableCible: 'utilisateurs',
          cibleId: compte.id,
          donnees: {
            raison: 'Audit du rôle Recruteur (2026-08-27) — suppression du rôle en base (voir roles.assignable), plus aucune fonction dans le workflow',
            emailCompte: utilisateur.email,
            roleCodeAvant: 'recruteur',
          },
          adresseIp: 'script:audit-role-recruteur',
        });
      });
      console.log(`Compte #${compte.id} (${compte.label}) désactivé ✔`);
    }

    console.log('\n--- Purge des sessions actives de ces comptes ---');
    const ids = COMPTES_A_DESACTIVER.map((c) => c.id);
    let totalPurge = 0;
    for (const id of ids) {
      // eslint-disable-next-line no-await-in-loop
      const nbSupprimees = await bd('session').whereRaw("sess->'utilisateur'->>'id' = ?", [String(id)]).del();
      if (nbSupprimees > 0) {
        console.log(`Compte #${id} : ${nbSupprimees} session(s) active(s) purgée(s) ✔`);
        totalPurge += nbSupprimees;
      }
    }
    console.log(totalPurge > 0 ? `${totalPurge} session(s) purgée(s) au total.` : 'Aucune session active à purger.');
  } finally {
    await bd.destroy();
  }
}

main().catch((erreur) => {
  console.error('Échec ✘');
  console.error(erreur.message);
  process.exitCode = 1;
});
