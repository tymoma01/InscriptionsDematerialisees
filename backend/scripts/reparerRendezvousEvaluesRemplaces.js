// Réparation ponctuelle (audit 2026-09-26 : rendez-vous test orphelins au statut 'remplace') —
// evaluationEngine.enregistrerEvaluation appelle workflowEngine.appliquerTransition AVANT de poser
// rendezvous.statut = 'honore', et ne le fait que pour un verdict POSITIF (voir son commentaire
// "un test invalidé ... rendezvous.statut reste 'prevu'"). En réalité, pour un verdict NÉGATIF
// (invalider_test), appliquerTransition a déjà neutralisé ce même rendez-vous en 'remplace' juste
// avant (test_realise -> invalide porte neutralise_rendezvous_actifs = true, comme les statuts
// positifs) — rien ne corrige ensuite cette ligne. Le rendez-vous qui a réellement eu lieu et a été
// évalué se retrouve donc affiché comme "Remplacé" (sémantique : supplanté par un autre rendez-vous,
// ce qui est faux ici) plutôt que "Réalisé".
//
// LISTE EXPLICITE ET FIGÉE (décision utilisateur, 2026-09-26) — ce script ne sélectionne RIEN
// automatiquement, volontairement, pour ne jamais toucher un rendez-vous 'remplace' issu d'une
// VRAIE replanification (voir rendezvousService.creerRendezvous) : seule une revue au cas par cas
// (voir le rapport d'audit préalable) a validé ces 10 identifiants.
const RENDEZVOUS_CIBLES = [12, 31, 34, 35, 51, 54, 56, 60, 78, 79];

// Correctif volontairement scopé au SEUL symptôme identifié : le fond du problème
// (evaluationEngine.js, séquencement appliquerTransition / mise à 'honore') n'est PAS traité ici,
// voir le rapport d'audit — ce script ne répare que les 10 dossiers déjà connus, pas un correctif
// général.
//
// Mode simulation par défaut (aucune écriture) ; option --appliquer pour écrire réellement, dans
// une seule transaction couvrant l'ensemble des rendez-vous éligibles (tout ou rien) — un échec
// sur l'un d'eux annule l'ensemble des écritures déjà faites dans cette même exécution, plutôt que
// de laisser une réparation partielle.
//
// Idempotent : un rendez-vous déjà à 'honore' (donc déjà réparé, par ce script ou manuellement)
// n'est plus repris comme éligible au run suivant — voir determinerStatutTraitement, code
// DEJA_TRAITE.
//
// Usage :
//   node scripts/reparerRendezvousEvaluesRemplaces.js               (simulation)
//   node scripts/reparerRendezvousEvaluesRemplaces.js --appliquer   (écriture réelle)

const { obtenirKnex } = require('../src/db/knex');
const journalAudit = require('../src/core/audit/journalAudit');

const ACTION_JOURNAL_AUDIT = 'rendezvous_requalifie_honore';
const RAISON_JOURNAL_AUDIT = "test évalué, neutralisé à tort par la transition d'évaluation";
const ADRESSE_IP_SCRIPT = 'script:reparation-rdv-evalues-remplaces';

// Pure, sans accès base — c'est CETTE fonction que le test unitaire couvre (voir
// reparerRendezvousEvaluesRemplaces.test.js). Reflète exactement les 4 conditions du point 2 de la
// demande, dans l'ordre où elles sont vérifiées : statut actuel = 'remplace' ; type_rdv = 'test' ;
// au moins une évaluation liée ; aucun rendez-vous test plus récent sur le même dossier.
//
// Cas 'honore' distingué en amont (DEJA_TRAITE) plutôt que de tomber dans le IGNORE générique
// "statut actuel différent de remplace" : c'est le seul état que CE script lui-même produit en
// sortie, donc le seul cas où "ignoré" doit se lire comme "déjà traité" plutôt que "hors périmètre".
function determinerStatutTraitement({ rendezvous, aEvaluation, aRendezvousTestPlusRecent }) {
  if (!rendezvous) {
    return { code: 'INTROUVABLE' };
  }
  if (rendezvous.statut === 'honore') {
    return { code: 'DEJA_TRAITE' };
  }
  if (rendezvous.statut !== 'remplace') {
    return { code: 'IGNORE', raison: `statut actuel « ${rendezvous.statut} » (attendu « remplace »)` };
  }
  if (rendezvous.type_rdv !== 'test') {
    return { code: 'IGNORE', raison: `type_rdv « ${rendezvous.type_rdv} » (attendu « test »)` };
  }
  if (!aEvaluation) {
    return { code: 'IGNORE', raison: 'aucune évaluation liée à ce rendez-vous' };
  }
  if (aRendezvousTestPlusRecent) {
    return { code: 'IGNORE', raison: 'un rendez-vous test plus récent existe sur ce dossier' };
  }
  return { code: 'ELIGIBLE' };
}

// entite_id vient du dossier (rendezvous n'en porte pas directement) — nécessaire pour l'entrée
// journal_audit (entite_id NOT NULL, migration 023).
async function chargerContexte(bd, rendezvousId) {
  const rendezvous = await bd('rendezvous as r')
    .join('dossiers as d', 'r.dossier_id', 'd.id')
    .where('r.id', rendezvousId)
    .select('r.id', 'r.dossier_id', 'r.statut', 'r.type_rdv', 'r.motif_id', 'd.entite_id')
    .first();
  if (!rendezvous) {
    return { rendezvous: null };
  }

  const [evaluation, rendezvousPlusRecent] = await Promise.all([
    bd('evaluations').where({ rendezvous_id: rendezvousId }).first(),
    bd('rendezvous').where({ dossier_id: rendezvous.dossier_id, type_rdv: 'test' }).andWhere('id', '>', rendezvousId).first(),
  ]);

  return {
    rendezvous,
    aEvaluation: Boolean(evaluation),
    aRendezvousTestPlusRecent: Boolean(rendezvousPlusRecent),
  };
}

// Résolu une fois par entité rencontrée (même convention que
// scripts/desactiverComptesRoleRecruteur.js) — utilisateur_id de l'entrée journal_audit, plutôt que
// null, pour rester cohérent avec les autres actions "système" déjà journalisées de cette façon.
async function resoudreUtilisateurSysteme(bd, entiteId, cache) {
  if (cache.has(entiteId)) return cache.get(entiteId);
  const utilisateur = await bd('utilisateurs')
    .join('roles', 'roles.id', 'utilisateurs.role_id')
    .where({ 'utilisateurs.entite_id': entiteId, 'roles.code': 'systeme' })
    .select('utilisateurs.id')
    .first();
  cache.set(entiteId, utilisateur?.id ?? null);
  return utilisateur?.id ?? null;
}

async function main() {
  const appliquer = process.argv.includes('--appliquer');
  const bd = await obtenirKnex();
  const cacheUtilisateurSysteme = new Map();

  try {
    console.log(
      appliquer
        ? '=== MODE APPLICATION — écriture réelle ==='
        : '=== MODE SIMULATION — aucune écriture (relancer avec --appliquer pour appliquer) ===',
    );

    const decisions = [];
    for (const rendezvousId of RENDEZVOUS_CIBLES) {
      // eslint-disable-next-line no-await-in-loop -- 10 identifiants fixes, séquentiel suffisant.
      const contexte = await chargerContexte(bd, rendezvousId);
      const decision = determinerStatutTraitement(contexte);
      decisions.push({ rendezvousId, contexte, decision });

      switch (decision.code) {
        case 'INTROUVABLE':
          console.log(`Rendez-vous #${rendezvousId} : introuvable — ignoré.`);
          break;
        case 'DEJA_TRAITE':
          console.log(`Rendez-vous #${rendezvousId} : déjà traité (statut déjà « honore ») — rien à faire.`);
          break;
        case 'IGNORE':
          console.log(`Rendez-vous #${rendezvousId} : ignoré (${decision.raison}).`);
          break;
        case 'ELIGIBLE':
          console.log(
            `Rendez-vous #${rendezvousId} (dossier #${contexte.rendezvous.dossier_id}) : ` +
              `${appliquer ? 'sera requalifié' : 'SERAIT requalifié'} « remplace » -> « honore » (motif_id -> NULL).`,
          );
          break;
        default:
          break;
      }
    }

    const eligibles = decisions.filter((d) => d.decision.code === 'ELIGIBLE');

    if (!appliquer) {
      console.log(
        `\nSimulation terminée : ${eligibles.length}/${RENDEZVOUS_CIBLES.length} rendez-vous seraient requalifiés. ` +
          'Relancer avec --appliquer pour écrire réellement.',
      );
      return;
    }

    if (eligibles.length === 0) {
      console.log('\nAucun rendez-vous éligible — rien à appliquer.');
      return;
    }

    let nbAppliques = 0;
    await bd.transaction(async (trx) => {
      for (const { rendezvousId } of eligibles) {
        // Reconfirmé sous verrou dans la transaction (plutôt que de faire confiance à la lecture
        // faite plus haut, hors transaction) : entre la simulation et l'écriture, un autre
        // processus a pu déjà traiter ce rendez-vous — évite une double requalification, jamais
        // une simple hypothèse d'état figé.
        // eslint-disable-next-line no-await-in-loop
        const rendezvousVerrouille = await trx('rendezvous').where({ id: rendezvousId }).forUpdate().first();
        // eslint-disable-next-line no-await-in-loop
        const contexteActuel = await chargerContexte(trx, rendezvousId);
        const decisionActuelle = determinerStatutTraitement({
          rendezvous: rendezvousVerrouille,
          aEvaluation: contexteActuel.aEvaluation,
          aRendezvousTestPlusRecent: contexteActuel.aRendezvousTestPlusRecent,
        });
        if (decisionActuelle.code !== 'ELIGIBLE') {
          console.log(`Rendez-vous #${rendezvousId} : état changé depuis la simulation — ignoré au moment d'écrire.`);
          // eslint-disable-next-line no-continue
          continue;
        }

        // eslint-disable-next-line no-await-in-loop
        const utilisateurSystemeId = await resoudreUtilisateurSysteme(trx, rendezvousVerrouille.entite_id, cacheUtilisateurSysteme);

        // eslint-disable-next-line no-await-in-loop
        await trx('rendezvous').where({ id: rendezvousId }).update({ statut: 'honore', motif_id: null });

        // eslint-disable-next-line no-await-in-loop
        await journalAudit.enregistrerAction(trx, {
          utilisateurId: utilisateurSystemeId,
          entiteId: rendezvousVerrouille.entite_id,
          action: ACTION_JOURNAL_AUDIT,
          tableCible: 'rendezvous',
          cibleId: rendezvousId,
          donnees: {
            dossierId: rendezvousVerrouille.dossier_id,
            statutAvant: 'remplace',
            statutApres: 'honore',
            raison: RAISON_JOURNAL_AUDIT,
          },
          adresseIp: ADRESSE_IP_SCRIPT,
        });

        console.log(`Rendez-vous #${rendezvousId} (dossier #${rendezvousVerrouille.dossier_id}) : requalifié « remplace » -> « honore » ✔`);
        nbAppliques += 1;
      }
    });

    console.log(`\n${nbAppliques}/${RENDEZVOUS_CIBLES.length} rendez-vous requalifié(s) ✔`);
  } finally {
    await bd.destroy();
  }
}

module.exports = { determinerStatutTraitement, RENDEZVOUS_CIBLES };

if (require.main === module) {
  main().catch((erreur) => {
    console.error('Échec de la réparation ✘');
    console.error(erreur.message);
    process.exit(1);
  });
}
