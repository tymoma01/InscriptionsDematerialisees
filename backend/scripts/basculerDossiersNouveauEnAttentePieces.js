// Correctif ponctuel — 20 dossiers restés au statut "nouveau" (audit 2026-08-19).
//
// Diagnostic : dossierService.inscrireCandidat écrit candidat + dossier + les 4 blocs +
// signature de charte dans UNE SEULE transaction atomique, dont la toute dernière étape fait
// passer automatiquement le dossier de "nouveau" (statut est_initial) à "en_attente_pieces" —
// depuis ce comportement, "nouveau" n'est plus jamais atteint par une inscription réelle. Le
// moteur de workflow lui-même (transitions_statut, transition_roles) n'a été introduit que le
// 21/07/2026 (commit 18f6491) ; les 20 dossiers encore à "nouveau" ont TOUS été créés avant cette
// date (16 au 20/07/2026, jamais retouchés depuis, voir date_maj = date_creation) — des dossiers
// antérieurs au système de statuts lui-même, rattachés à "nouveau" (est_initial) lors de sa mise
// en place, sans jamais rejouer la transition automatique (qui ne s'exécute qu'à l'inscription,
// jamais rétroactivement).
//
// Correctif : applique la transition réelle "nouveau -> en_attente_pieces" (codeAction
// 'inscription_soumise', vérifiée en base : seul rôle autorisé 'systeme', sans motif requis) via
// workflowEngine.appliquerTransition — même moteur que la route /transitions normale et que
// l'auto-transition d'inscrireCandidat, pas une mise à jour SQL ad hoc de dossiers.statut_id :
// garantit que historique_statuts reste cohérent avec le reste de l'application (voir aussi le
// trigger trg_sync_dossier_statut, migration 010, qui répercute automatiquement statut_id depuis
// historique_statuts — ne jamais écrire dossiers.statut_id directement). Acteur : l'utilisateur
// système de l'entité, le même qui aurait porté cette transition si elle s'était produite au bon
// moment.
//
// Sélection DYNAMIQUE des dossiers à corriger (statut_code = 'nouveau', entité ACCECIT) plutôt
// qu'une liste d'ids codée en dur : plus sûr (aucun dossier "nouveau" créé après le script ne
// serait corrigé par erreur si ce n'est pas son but, et le script échoue explicitement si le
// nombre trouvé diffère du nombre attendu par l'audit, au lieu de continuer silencieusement sur
// un jeu de données qui aurait changé entre-temps).
//
// Usage : node scripts/basculerDossiersNouveauEnAttentePieces.js
const { obtenirKnex } = require('../src/db/knex');
const workflowEngine = require('../src/core/workflow/workflowEngine');
const dossierRepository = require('../src/core/dossier/dossierRepository');

const CODE_ACTION = 'inscription_soumise';
const ROLE_CODE = 'systeme';
const NOMBRE_ATTENDU = 20; // voir audit 2026-08-19 : exactement 20 dossiers au statut "nouveau".

const COMMENTAIRE =
  'Correctif rétroactif (audit 2026-08-19) : ce dossier a été créé avant la mise en place du ' +
  'moteur de workflow (commit 18f6491, 21/07/2026) et est resté au statut "nouveau" faute de ' +
  'transition automatique à rejouer rétroactivement. La transition "nouveau -> en_attente_pieces" ' +
  'aurait normalement dû suivre immédiatement sa création, comme pour toute inscription réelle ' +
  "depuis cette date — appliquée ici a posteriori, avec le même acteur (utilisateur système).";

async function main() {
  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: 'accecit', actif: true }).first();
    if (!entite) throw new Error('Entité « accecit » introuvable ou inactive.');

    const utilisateurSysteme = await dossierRepository.trouverUtilisateurSysteme(bd, entite.id);
    if (!utilisateurSysteme) throw new Error(`Utilisateur système non configuré pour l'entité « ${entite.code} ».`);

    const dossiers = await bd('dossiers')
      .join('statuts', 'statuts.id', 'dossiers.statut_id')
      .where({ 'dossiers.entite_id': entite.id, 'statuts.code': 'nouveau' })
      .select('dossiers.id')
      .orderBy('dossiers.id');

    console.log(`Dossiers au statut "nouveau" trouvés : ${dossiers.length}`);
    if (dossiers.length !== NOMBRE_ATTENDU) {
      throw new Error(
        `Attendu ${NOMBRE_ATTENDU} dossiers d'après l'audit, ${dossiers.length} trouvés — arrêt sans rien modifier ` +
          '(le jeu de données a peut-être changé depuis l\'audit ; vérifier avant de relancer).',
      );
    }

    await bd.transaction(async (trx) => {
      for (const { id: dossierId } of dossiers) {
        const { statutDestinationId } = await workflowEngine.appliquerTransition(
          entite,
          {
            dossierId,
            codeAction: CODE_ACTION,
            commentaire: COMMENTAIRE,
            utilisateurId: utilisateurSysteme.id,
            roleCode: ROLE_CODE,
          },
          trx,
        );
        console.log(`Dossier #${dossierId} : transition "${CODE_ACTION}" appliquée, statut_destination_id=${statutDestinationId} ✔`);
      }
    });

    const restants = await bd('dossiers')
      .join('statuts', 'statuts.id', 'dossiers.statut_id')
      .where({ 'dossiers.entite_id': entite.id, 'statuts.code': 'nouveau' })
      .count('dossiers.id')
      .first();
    console.log(`\nDossiers encore au statut "nouveau" après correctif : ${restants.count} ✔`);
  } finally {
    await bd.destroy();
  }
}

main().catch((erreur) => {
  console.error('Échec du correctif ✘');
  console.error(erreur.message);
  process.exitCode = 1;
});
