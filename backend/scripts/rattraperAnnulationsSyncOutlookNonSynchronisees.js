// Correction ponctuelle (même patron que scripts/corrigerRendezvousDesynchronises.js, dossier
// #127/#84) suite à l'audit du 2026-09-21 : syncCalendrierManuelService.js (annulation détectée
// via le calendrier Outlook) posait rendezvous.statut='annule' SANS jamais composer avec
// workflowEngine.appliquerTransition — contrairement au chemin UI équivalent (PATCH
// /rendezvous/:id, corrigé le même jour). Tout dossier dont le rendez-vous de test a été annulé
// via la synchronisation Outlook AVANT ce correctif reste donc bloqué en "Test planifié" à
// l'infini : le mécanisme corrigé ne se redéclenche que sur un NOUVEL événement (une nouvelle
// annulation), jamais rétroactivement sur les dossiers déjà dans cet état — ce script comble
// l'écart une fois, pour les dossiers déjà concernés au moment de l'audit (12 en PROD : #27, #29,
// #30, #37, #41, #42, #52, #53, #60, #62, #73, #85).
//
// Réutilise EXACTEMENT la même fonction de décision que le code corrigé
// (rendezvousService.resoudreTransitionAnnulationTest) plutôt que de redéfinir son propre critère
// ici — un dossier qui ne remplirait plus les conditions (déjà refermé autrement entre-temps) est
// donc automatiquement ignoré, sans double logique à maintenir en parallèle.
//
// Sélection dynamique (pas une liste de 12 id figée en dur) : tout dossier ENCORE test_planifie
// portant au moins un rendez-vous type='test' statut='annule' — mêmes deux critères que
// rendezvousRepository.listerRendezvousTestNonRealisesAutomatiquement pour rester cohérent avec
// le reste du module. Idempotent : un dossier déjà corrigé (ou dont le cas ne s'applique plus,
// resoudreTransitionAnnulationTest renvoyant []) ne réapparaît plus/n'est pas modifié au run
// suivant — rejouable sans risque en cas de doute.
//
// Usage : node scripts/rattraperAnnulationsSyncOutlookNonSynchronisees.js <code_entite>

const { obtenirKnex } = require('../src/db/knex');
const dossierRepository = require('../src/core/dossier/dossierRepository');
const rendezvousService = require('../src/core/rendezvous/rendezvousService');
const workflowEngine = require('../src/core/workflow/workflowEngine');
const journalAudit = require('../src/core/audit/journalAudit');
const { ROLES } = require('../src/core/auth/rbac');

async function main(codeEntite) {
  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: codeEntite }).first();
    if (!entite) {
      throw new Error(`Entité « ${codeEntite} » introuvable — exécuter d'abord scripts/seedEntite.js`);
    }

    const utilisateurSysteme = await dossierRepository.trouverUtilisateurSysteme(bd, entite.id);
    if (!utilisateurSysteme) {
      throw new Error(`Utilisateur système non configuré pour l'entité « ${codeEntite} » (voir scripts/seedUtilisateurSysteme.js).`);
    }

    // Un seul rendez-vous 'annule' suffit par dossier pour interroger resoudreTransitionAnnulationTest
    // (elle ne dépend que du dossier et du type_rdv, pas de CE rendez-vous précis) — GROUP BY d.id +
    // min(r.id) : si un même dossier a plusieurs rendez-vous 'annule', ne le traiter qu'une fois.
    const candidats = await bd('rendezvous as r')
      .join('dossiers as d', 'd.id', 'r.dossier_id')
      .join('statuts as s', 's.id', 'd.statut_id')
      .where({ 'd.entite_id': entite.id, 'r.type_rdv': 'test', 'r.statut': 'annule', 's.code': 'test_planifie' })
      .groupBy('d.id')
      .select('d.id as dossier_id')
      .select(bd.raw('min(r.id) as rendezvous_id'));

    if (candidats.length === 0) {
      console.log(`Aucun dossier à rattraper pour « ${codeEntite} » ✔`);
      return;
    }

    let corriges = 0;
    let ignores = 0;
    let echecs = 0;

    for (const { dossier_id: dossierId, rendezvous_id: rendezvousId } of candidats) {
      try {
        const resultat = await bd.transaction(async (trx) => {
          const transitions = await rendezvousService.resoudreTransitionAnnulationTest(entite, { dossierId, rendezvousId }, trx);
          if (transitions.length === 0) {
            return false;
          }

          for (const { codeAction, commentaire } of transitions) {
            await workflowEngine.appliquerTransition(
              entite,
              { dossierId, codeAction, commentaire, utilisateurId: utilisateurSysteme.id, roleCode: ROLES.SYSTEME },
              trx,
            );

            await journalAudit.enregistrerAction(trx, {
              utilisateurId: utilisateurSysteme.id,
              entiteId: entite.id,
              action: 'dossier_transition_test_non_realise_annulation_rattrapage',
              tableCible: 'historique_statuts',
              cibleId: dossierId,
              donnees: { dossierId, rendezvousId, codeAction },
            });
          }
          return true;
        });

        if (resultat) {
          corriges += 1;
          console.log(`Dossier #${dossierId} : test_planifie -> test_non_realise (rendez-vous #${rendezvousId} annulé) ✔`);
        } else {
          ignores += 1;
          console.log(`Dossier #${dossierId} : ignoré (la transition ne s'applique plus — déjà refermé autrement entre-temps).`);
        }
      } catch (erreur) {
        console.error(`Dossier #${dossierId} : échec ✘`, erreur.message);
        echecs += 1;
      }
    }

    console.log(`\n${corriges} corrigé(s), ${ignores} ignoré(s), ${echecs} échec(s), sur ${candidats.length} dossier(s) candidat(s).`);
  } finally {
    await bd.destroy();
  }
}

const codeEntite = process.argv[2];
if (!codeEntite) {
  console.error('Usage : node scripts/rattraperAnnulationsSyncOutlookNonSynchronisees.js <code_entite>');
  process.exit(1);
}

main(codeEntite).catch((erreur) => {
  console.error('Échec du rattrapage ✘');
  console.error(erreur.message);
  process.exit(1);
});
