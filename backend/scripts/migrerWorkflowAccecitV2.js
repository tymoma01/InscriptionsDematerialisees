// Migration ponctuelle (pas un seed rejouable indéfiniment comme scripts/seedStatuts.js) pour le
// passage à la machine à états v2 d'ACCECIT (suppression de l'étape "en_attente_verification" en
// tant que statut séparé, vérification des pièces désormais inline/visuelle par l'accueil).
//
// scripts/seedStatuts.js est purement additif (n'efface jamais une ligne `transitions_statut`
// absente du nouveau workflow.config.json) — nécessaire pour ne jamais perdre l'historique d'une
// entité qui aurait simplement retiré une transition. Mais ça laisse ici un risque concret : sans
// nettoyage, un dossier encore à en_attente_pieces verrait DEUX actions possibles (l'ancienne
// "pieces_completes" vers l'étape de vérification disparue, ET la nouvelle "planifier_test"
// directe) — ce script supprime donc explicitement les 4 lignes devenues obsolètes, jamais les
// statuts eux-mêmes (les lignes `statuts` restent en base, ne serait-ce que pour les FK
// historique_statuts des dossiers déjà rejete/valide via l'ancien parcours).
//
// Migre aussi le seul dossier actuellement bloqué sur ce statut disparu (verifié en base avant
// d'écrire ce script : dossier id 45 "Case RoleTest3", entité accecit) vers en_attente_pieces —
// confirmé explicitement avec la responsable de projet avant exécution. Écrit via
// dossierRepository.enregistrerChangementStatut (déclenche le trigger trg_sync_dossier_statut,
// voir migration 010) plutôt qu'un UPDATE direct sur dossiers.statut_id, pour garder une trace
// dans historique_statuts comme tout autre changement de statut.
//
// Idempotent au sens où le réexécuter ne fait plus rien une fois passé une première fois (les
// lignes obsolètes n'existent plus, aucun dossier n'est plus à en_attente_verification) — mais ce
// n'est pas un script à conserver dans un cycle de seed régulier comme scripts/seedStatuts.js.
//
// Usage : node scripts/migrerWorkflowAccecitV2.js

const { obtenirKnex } = require('../src/db/knex');
const dossierRepository = require('../src/core/dossier/dossierRepository');

// email de l'administrateur ACCECIT existant (voir scripts/seedUtilisateur.js) — utilisé comme
// auteur de la migration dans historique_statuts.utilisateur_id (colonne NOT NULL), faute d'un
// meilleur candidat pour un changement de statut décidé techniquement plutôt que par un agent.
const EMAIL_ADMIN_ACCECIT = 'admin@accecit.test';

const TRANSITIONS_OBSOLETES = [
  { codeAction: 'pieces_completes', statutOrigine: 'en_attente_pieces', statutDestination: 'en_attente_verification' },
  { codeAction: 'valider_dossier', statutOrigine: 'en_attente_verification', statutDestination: 'valide' },
  { codeAction: 'rejeter_dossier', statutOrigine: 'en_attente_verification', statutDestination: 'rejete' },
  { codeAction: 'planifier_test', statutOrigine: 'en_attente_verification', statutDestination: 'test_planifie' },
];

async function main() {
  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: 'accecit' }).first();
    if (!entite) {
      throw new Error('Entité « accecit » introuvable — exécuter scripts/seedEntite.js.');
    }

    const idStatut = async (code) => {
      const statut = await bd('statuts').where({ entite_id: entite.id, code }).first();
      return statut ? statut.id : null;
    };

    console.log('--- Nettoyage des transitions obsolètes (workflow v1 -> v2) ---');
    for (const { codeAction, statutOrigine, statutDestination } of TRANSITIONS_OBSOLETES) {
      const statutOrigineId = await idStatut(statutOrigine);
      const statutDestinationId = await idStatut(statutDestination);
      const transition = await bd('transitions_statut')
        .where({
          entite_id: entite.id,
          code_action: codeAction,
          statut_origine_id: statutOrigineId,
          statut_destination_id: statutDestinationId,
        })
        .first();

      if (!transition) {
        console.log(`Transition « ${codeAction} » (${statutOrigine} -> ${statutDestination}) déjà absente — rien à faire.`);
        continue;
      }

      const nbRoles = await bd('transition_roles').where({ transition_id: transition.id }).del();
      await bd('transitions_statut').where({ id: transition.id }).del();
      console.log(
        `Transition « ${codeAction} » (${statutOrigine} -> ${statutDestination}, id=${transition.id}) supprimée avec ${nbRoles} rôle(s) associé(s) ✔`,
      );
    }

    console.log('--- Retrait du rôle SYSTEME sur test_realise (remplacé par FORMATEUR/ADMIN) ---');
    const roleSysteme = await bd('roles').where({ code: 'systeme' }).first();
    const transitionTestRealise = await bd('transitions_statut')
      .where({ entite_id: entite.id, code_action: 'test_realise' })
      .first();
    if (roleSysteme && transitionTestRealise) {
      const nbSupprimes = await bd('transition_roles')
        .where({ transition_id: transitionTestRealise.id, role_id: roleSysteme.id })
        .del();
      console.log(nbSupprimes > 0 ? 'Rôle SYSTEME retiré de test_realise ✔' : 'Rôle SYSTEME déjà absent de test_realise.');
    }

    console.log('--- Migration des dossiers bloqués sur en_attente_verification ---');
    const statutEnAttenteVerification = await bd('statuts')
      .where({ entite_id: entite.id, code: 'en_attente_verification' })
      .first();
    const statutEnAttentePieces = await bd('statuts').where({ entite_id: entite.id, code: 'en_attente_pieces' }).first();
    const admin = await bd('utilisateurs').where({ email: EMAIL_ADMIN_ACCECIT }).first();

    if (!statutEnAttenteVerification) {
      console.log('Statut « en_attente_verification » introuvable — rien à migrer.');
    } else if (!admin) {
      throw new Error(`Utilisateur « ${EMAIL_ADMIN_ACCECIT} » introuvable — nécessaire pour tracer la migration.`);
    } else {
      const dossiersConcernes = await bd('dossiers').where({
        entite_id: entite.id,
        statut_id: statutEnAttenteVerification.id,
      });

      if (dossiersConcernes.length === 0) {
        console.log('Aucun dossier à en_attente_verification — rien à migrer.');
      }

      for (const dossier of dossiersConcernes) {
        await dossierRepository.enregistrerChangementStatut(bd, {
          dossierId: dossier.id,
          statutId: statutEnAttentePieces.id,
          utilisateurId: admin.id,
          commentaire:
            'Migration technique vers la machine à états v2 : l\'étape "en_attente_verification" est retirée du ' +
            'workflow (vérification des pièces désormais inline par l\'accueil) — dossier ramené à ' +
            '"en_attente_pieces" en attendant une nouvelle planification de test.',
        });
        console.log(`Dossier id=${dossier.id} migré vers en_attente_pieces ✔`);
      }
    }
  } finally {
    await bd.destroy();
  }
}

main().catch((erreur) => {
  console.error('Échec de la migration ✘');
  console.error(erreur.message);
  process.exit(1);
});
