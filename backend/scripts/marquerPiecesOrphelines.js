// Migration ponctuelle (même patron que scripts/migrerWorkflowAccecitV4.js) — suite du diagnostic
// et du correctif du 2026-08-06 sur pieceJustificativeService.listerPiecesJustificativesAvecContenu
// (export ZIP, dossier #82 puis scan complet des 48 dossiers ACCECIT : 29 pièces sur 7 dossiers
// #48/#56/#57/#70/#71/#72/#82 pointent vers un item OneDrive introuvable, conséquence du bug de
// chemin non préfixé par type corrigé le 2026-07-31 — voir azureOneDriveConnector.js).
//
// Ce script réutilise exactement la même logique de détection que l'export ZIP (tente le
// téléchargement de chaque pièce, capture l'échec) plutôt que de rejouer la liste figée du scan
// précédent : rejoue le scan à l'exécution, donc reste correct même si de nouvelles pièces sont
// devenues orphelines entretemps, et ne dépend d'aucune liste d'ids codée en dur ici.
//
// Ne touche qu'aux pièces actuellement 'valide' ou 'en_attente' (jamais 'rejete', jugement humain
// déjà posé, ni 'orpheline', déjà marquée) — voir migration 046 pour la distinction 'orpheline' vs
// 'rejete'. Idempotent : une pièce déjà 'orpheline' est ignorée, un fichier qui redevient
// accessible (item restauré) n'est PAS repassé automatiquement à 'valide'/'en_attente' par ce
// script (pas son rôle - un humain doit re-vérifier une pièce qui redevient disponible).
//
// Pose aussi une note système sur chaque dossier où au moins une pièce est détectée orpheline
// PAR CE PASSAGE (pas les dossiers déjà marqués lors d'une exécution précédente — une pièce déjà
// 'orpheline' est exclue de la requête ci-dessous, donc jamais revérifiée ni renotée) — même
// patron que dossierService.js/rappelService.js pour l'acteur système
// (dossierRepository.trouverUtilisateurSysteme) et notesDossierRepository.ajouterNote pour la
// note elle-même (système de notes déjà utilisé par le back-office, Validation.jsx/NotesDossier.jsx).
//
// Usage : node scripts/marquerPiecesOrphelines.js [--dry-run]

const { obtenirKnex } = require('../src/db/knex');
const storageFactory = require('../src/integrations/stockage/storageFactory');
const pieceJustificativeRepository = require('../src/core/dossier/pieceJustificativeRepository');
const dossierRepository = require('../src/core/dossier/dossierRepository');
const notesDossierRepository = require('../src/core/dossier/notesDossierRepository');

const DRY_RUN = process.argv.includes('--dry-run');

// Regroupée ici (plutôt qu'en ligne dans main()) pour rester testable/lisible indépendamment de
// la boucle de détection : un texte par dossier, une ligne par pièce concernée.
function construireContenuNote(piecesDuDossier) {
  const lignes = piecesDuDossier.map((piece) => `- ${piece.type_piece_code} (${piece.nom_fichier})`);
  return (
    `Pièce(s) justificative(s) à recapturer : le fichier d'origine a été perdu côté stockage documentaire ` +
    `(export ZIP en échec, diagnostic du 2026-08-06) et ne peut plus être récupéré. Merci de recontacter ` +
    `le candidat pour reprendre la ou les pièces suivantes :\n${lignes.join('\n')}`
  );
}

async function main() {
  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: 'accecit', actif: true }).first();
    if (!entite) {
      throw new Error('Entité « accecit » introuvable ou inactive.');
    }

    const connecteur = storageFactory(entite.connecteur_stockage);

    const pieces = await bd('pieces_justificatives')
      .join('dossiers', 'dossiers.id', 'pieces_justificatives.dossier_id')
      .join('types_pieces', 'types_pieces.id', 'pieces_justificatives.type_piece_id')
      .where('dossiers.entite_id', entite.id)
      .whereIn('pieces_justificatives.statut_verification', ['en_attente', 'valide'])
      .select(
        'pieces_justificatives.id',
        'pieces_justificatives.dossier_id',
        'pieces_justificatives.nom_fichier',
        'pieces_justificatives.reference_stockage',
        'pieces_justificatives.statut_verification',
        'types_pieces.code as type_piece_code',
      )
      .orderBy('pieces_justificatives.dossier_id');

    console.log(`${pieces.length} pièce(s) à vérifier (statut actuel en_attente/valide) pour l'entité « accecit ».`);
    if (DRY_RUN) console.log('--dry-run : aucune écriture ne sera faite.\n');

    let nbOrphelines = 0;
    const piecesParDossier = new Map();

    for (const piece of pieces) {
      try {
        await connecteur.download(piece.reference_stockage);
      } catch (erreur) {
        nbOrphelines += 1;
        if (!piecesParDossier.has(piece.dossier_id)) piecesParDossier.set(piece.dossier_id, []);
        piecesParDossier.get(piece.dossier_id).push(piece);
        console.log(
          `Orpheline : pièce #${piece.id} (dossier #${piece.dossier_id}, ${piece.type_piece_code}, ` +
            `${piece.nom_fichier}) — ${erreur.message}`,
        );
        if (!DRY_RUN) {
          await pieceJustificativeRepository.mettreAJourStatutVerification(bd, piece.id, {
            statutVerification: 'orpheline',
            dateVerification: new Date(),
          });
        }
      }
    }

    console.log(
      `\n${nbOrphelines} pièce(s) orpheline(s) sur ${piecesParDossier.size} dossier(s)` +
        (DRY_RUN ? ' (dry-run, rien écrit)' : ' marquée(s) « orpheline » en base') +
        ' ✔',
    );
    if (piecesParDossier.size > 0) {
      console.log('Dossiers concernés :', [...piecesParDossier.keys()].sort((a, b) => a - b).join(', '));
    }

    if (!DRY_RUN && piecesParDossier.size > 0) {
      const utilisateurSysteme = await dossierRepository.trouverUtilisateurSysteme(bd, entite.id);
      if (!utilisateurSysteme) {
        throw new Error(`Utilisateur système non configuré pour l'entité « ${entite.code} » — notes non posées.`);
      }
      for (const [dossierId, piecesDuDossier] of piecesParDossier) {
        await notesDossierRepository.ajouterNote(bd, {
          dossierId,
          auteurId: utilisateurSysteme.id,
          contenu: construireContenuNote(piecesDuDossier),
        });
        console.log(`Note posée sur le dossier #${dossierId} (${piecesDuDossier.length} pièce(s)).`);
      }
    }
  } finally {
    await bd.destroy();
  }
}

main().catch((erreur) => {
  console.error('Échec du script ✘');
  console.error(erreur.message);
  process.exit(1);
});

// Exporté pour réutilisation ponctuelle (voir note de suivi manuelle pour les 30 pièces déjà
// marquées le 2026-08-06, avant l'ajout de cette étape de notification à ce script) — n'affecte
// pas l'exécution directe ci-dessus (node scripts/marquerPiecesOrphelines.js).
module.exports = { construireContenuNote };
