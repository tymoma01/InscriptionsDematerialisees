// Rattrapage manuel/ponctuel — même logique que le filet de sécurité horaire (voir
// src/core/rendezvous/rattrapageAnnulationTestService.js, démarré automatiquement par
// src/jobs/rattrapageAnnulationTestCron.js en dev et en prod) : renommé le 2026-09-21 (ex-
// rattraperAnnulationsSyncOutlookNonSynchronisees.js) une fois le filet de sécurité devenu
// générique — reste utile pour forcer une correction immédiate sans attendre le prochain passage
// horaire (ex. juste après un déploiement, pour rattraper d'un coup les dossiers déjà bloqués au
// moment de l'audit), même rôle que scripts/executerBasculeTestNonRealise.js pour
// basculeTestNonRealiseService.js.
//
// Usage : node scripts/rattraperAnnulationsTestNonSynchronisees.js <code_entite>

const { obtenirKnex } = require('../src/db/knex');
const { executerRattrapageAnnulationTest } = require('../src/core/rendezvous/rattrapageAnnulationTestService');

async function main(codeEntite) {
  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: codeEntite, actif: true }).first();
    if (!entite) {
      throw new Error(`Entité « ${codeEntite} » introuvable ou inactive.`);
    }

    const resultat = await executerRattrapageAnnulationTest(entite);
    console.log(
      `Rattrapage « ${codeEntite} » : ${resultat.corriges} corrigé(s), ${resultat.ignores} ignoré(s), ` +
        `${resultat.echecs} échec(s), sur ${resultat.total} dossier(s) candidat(s).`,
    );
  } finally {
    await bd.destroy();
  }
}

const codeEntite = process.argv[2];
if (!codeEntite) {
  console.error('Usage : node scripts/rattraperAnnulationsTestNonSynchronisees.js <code_entite>');
  process.exit(1);
}

main(codeEntite).catch((erreur) => {
  console.error('Échec du rattrapage ✘');
  console.error(erreur.message);
  process.exit(1);
});
