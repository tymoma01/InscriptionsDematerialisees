const db = require('../../db/knex');
const dossierRepository = require('../../core/dossier/dossierRepository');
const smartOfClient = require('./smartOfClient');
const { construirePayloadApprenant } = require('./smartOfMapper');

// Orchestration de la création du profil candidat côté SmartOF (CLAUDE.md, étape 9 : "une fois le
// test validé, appel à l'API SmartOF pour créer directement le profil du candidat côté
// formation") — déclenché par evaluationEngine.enregistrerEvaluation quand la transition
// appliquée est `valider_envoi_formation` (verdict positif d'un Formateur avec orientation
// "Envoi en formation", voir son commentaire d'en-tête). Rien n'est déclenché ici pour un
// Inspecteur (postes bureau) : son verdict positif va toujours vers `valider_pret_embauche`, pas
// `valider_envoi_formation` (voir evaluationEngine.js) — décision utilisateur 2026-08-21 de ne
// couvrir que le chemin Formateur/Hôtellerie pour cette première version, la correspondance
// rôle -> customId d'entreprise ci-dessous restant écrite de façon générique pour être prête le
// jour où ce périmètre s'étend.
//
// Module optionnel par entité (voir Modularité, CLAUDE.md et docs/architecture-technique.md
// §3.1) : ne connaît aucun statut ni codeAction du moteur de workflow, reçoit `entite` et
// `dossierId` déjà résolus par l'appelant. N'échoue JAMAIS bruyamment vers son appelant — un
// incident SmartOF (API down, credentials expirés, entreprise introuvable...) ne doit jamais faire
// échouer la soumission d'une évaluation côté ACCECIT (même esprit que
// EnTeteBackOffice.gererDeconnexion, "non bloquant") : toute erreur est journalisée puis avalée
// ici, jamais propagée à evaluationEngine.
async function envoyerCandidatEnFormation(entite, { dossierId, roleCode }) {
  if (!entite.smartof_actif) {
    return;
  }

  try {
    const customIdEntreprise = entite.smartof_config?.entreprises_par_role?.[roleCode];
    if (!customIdEntreprise) {
      console.error(
        `SmartOF : aucune entreprise configurée pour le rôle "${roleCode}" (entite.smartof_config.entreprises_par_role, entité « ${entite.code} ») — dossier #${dossierId} non envoyé.`,
      );
      return;
    }

    const bd = await db.obtenirKnex();
    const inscription = await dossierRepository.trouverInscriptionCompleteParDossierId(bd, entite.id, dossierId);
    if (!inscription) {
      console.error(`SmartOF : dossier #${dossierId} introuvable pour l'entité « ${entite.code} » — envoi annulé.`);
      return;
    }

    // Résolution par customId (ex. "ENT-0003"), pas par meta.nom ("ACCECIT Hôtellerie") : le
    // customId est l'identifiant métier stable qu'un administrateur SmartOF attribue à
    // l'entreprise à sa création — contrairement au nom affiché, qui peut être renommé dans
    // SmartOF sans que quiconque pense à répercuter le changement ici (décision utilisateur,
    // 2026-08-21). L'entrepriseUid (le vrai UUID SmartOF) n'est lui jamais stocké côté ACCECIT :
    // /api/entreprise/list reste appelé à chaque envoi plutôt que de le mettre en cache, pour
    // rester correct même si SmartOF recrée un jour la fiche entreprise avec un nouvel UID.
    const entreprises = await smartOfClient.listerEntreprises();
    const entreprise = entreprises.find((candidate) => candidate.customId === customIdEntreprise);
    if (!entreprise) {
      console.error(
        `SmartOF : aucune entreprise de customId "${customIdEntreprise}" trouvée côté SmartOF (/api/entreprise/list) — dossier #${dossierId} non envoyé. Vérifier entites.smartof_config ou le customId exact côté SmartOF.`,
      );
      return;
    }

    const payload = construirePayloadApprenant({ dossierId, inscription, entrepriseUid: entreprise.entrepriseUid });
    const apprenant = await smartOfClient.creerApprenant(payload);

    await bd('smartof_sync').insert({
      dossier_id: dossierId,
      smartof_candidat_id: apprenant.apprenantUid,
      statut_sync: 'envoye',
      payload_envoye: JSON.stringify(payload),
    });
  } catch (erreur) {
    console.error(`SmartOF : échec de la création de l'apprenant pour le dossier #${dossierId}.`, erreur);
  }
}

module.exports = { envoyerCandidatEnFormation };
