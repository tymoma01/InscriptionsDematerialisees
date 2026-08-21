// Script de test manuel — pas un test automatisé (voir src/integrations/smartof/*.test.js, qui
// mockent tout) : appelle réellement l'API SmartOF (authentification + /api/entreprise/list +
// /api/apprenant/create) via les vrais secrets Key Vault, pour vérifier de bout en bout que
// smartOfClient.js parle bien à SmartOF et que le candidat créé apparaît bien dans l'interface
// (https://academyable.smartof.app).
//
// 1. Liste les entreprises réelles (customId + entrepriseUid + nom) — sert à trancher la question
//    ouverte "customId (ENT-0002/ENT-0003) ou entrepriseUid en dur ?" (voir entite.config.json,
//    smartof_config.entreprises_par_role) en confrontant les deux à la vraie réponse SmartOF.
// 2. Crée un apprenant de TEST (nom/prénom explicitement marqués "TEST", même convention que le
//    dossier #69 ACCECIT, candidat de test) lié à l'entreprise "ENT-0003" — à retrouver puis
//    supprimer/archiver manuellement dans SmartOF après vérification, ce script ne nettoie rien
//    lui-même.
//
// Usage : node scripts/testerSmartOfApprenant.js
const smartOfClient = require('../src/integrations/smartof/smartOfClient');

const CUSTOM_ID_ENTREPRISE_CIBLE = 'ENT-0003'; // ACCECIT Hôtellerie, voir entite.config.json

async function main() {
  console.log('--- POST /api/entreprise/list ---');
  const entreprises = await smartOfClient.listerEntreprises();
  for (const entreprise of entreprises) {
    console.log(`customId=${entreprise.customId}  entrepriseUid=${entreprise.entrepriseUid}  nom="${entreprise.meta?.nom}"`);
  }

  const cible = entreprises.find((entreprise) => entreprise.customId === CUSTOM_ID_ENTREPRISE_CIBLE);
  if (!cible) {
    throw new Error(`Entreprise de customId "${CUSTOM_ID_ENTREPRISE_CIBLE}" introuvable dans la liste ci-dessus.`);
  }
  console.log(`\nEntreprise cible retenue : customId=${cible.customId} -> entrepriseUid=${cible.entrepriseUid}`);

  console.log('\n--- POST /api/apprenant/create ---');
  const champsPersonnalisesVides = Object.fromEntries(
    Array.from({ length: 20 }, (_, index) => [`custom_field_${index + 1}`, '']),
  );
  const payload = {
    // customId réellement obligatoire côté SmartOF (testé le 2026-08-21 : omis -> 400 "customId
    // Required", SmartOF ne génère PAS lui-même la séquence APP-00XX pour une création via l'API,
    // contrairement à leur interface web) — voir smartOfMapper.js (customId = id du dossier
    // ACCECIT) pour la valeur utilisée en usage réel.
    customId: `TEST-SCRIPT-MANUEL-${Date.now()}`,
    email: 'test-integration-accecit@example.com',
    custom_fields: champsPersonnalisesVides,
    meta: {
      nom: 'TEST INTEGRATION',
      nomUsage: 'TEST INTEGRATION',
      prenom: 'SCRIPT',
      fonction: '',
      lieuActivite: '',
      dateNaissance: '2000-01-01',
      tel: '0600000000',
      adresse: { rue: '', complementAdresse: '', codePostal: '', ville: '' },
      // 'Monsieur' plutôt que 'Non renseigné' (valeur d'origine) : vérifie que ce champ remonte
      // bien côté SmartOF (retour utilisateur 2026-08-21, premier apprenant de test créé avec
      // 'Non renseigné' — civilité pas visible côté SmartOF avec cette valeur).
      civilite: 'Monsieur',
      numeroCompteComptable: '',
      statutBPF: '',
    },
    entrepriseUids: [cible.entrepriseUid],
    archived: false,
  };

  const apprenant = await smartOfClient.creerApprenant(payload);
  console.log('Apprenant créé ✔');
  console.log(apprenant);
  console.log(
    `\nÀ vérifier manuellement : https://academyable.smartof.app (chercher "TEST INTEGRATION" ou apprenantUid=${apprenant.apprenantUid}).`,
  );
}

main().catch((erreur) => {
  console.error('Échec ✘');
  console.error(erreur.message);
  process.exit(1);
});
