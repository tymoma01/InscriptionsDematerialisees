// Déclenche le rappel automatique de créneau pour une entité (CLAUDE.md, besoin Accueil/
// Coordination : "confirmation de présence à un créneau avant le jour J (rappel automatique),
// pour réduire les désistements") — idempotent (voir core/rendezvous/rappelService.js), donc
// rejouable sans risque de double envoi.
//
// Mécanisme de déclenchement en production non tranché à ce stade (cron externe sur le serveur,
// tâche planifiée, Azure Function Timer...) — ce script est le point d'entrée que ce mécanisme,
// quel qu'il soit, doit invoquer périodiquement. Choix à valider avec le développeur senior/l'équipe
// infra ; en local, peut être lancé manuellement ou via une tâche cron classique
// (ex. `0 8 * * * cd .../backend && node scripts/executerRappels.js accecit`).
//
// Usage : node scripts/executerRappels.js <code_entite>

const { obtenirKnex } = require('../src/db/knex');
const { executerRappels } = require('../src/core/rendezvous/rappelService');

async function main(codeEntite) {
  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: codeEntite, actif: true }).first();
    if (!entite) {
      throw new Error(`Entité « ${codeEntite} » introuvable ou inactive.`);
    }

    const resultat = await executerRappels(entite);
    if (resultat.desactive) {
      console.log(`Rappels non exécutés : sms_actif est désactivé pour « ${codeEntite} ».`);
      return;
    }
    console.log(
      `Rappels « ${codeEntite} » : ${resultat.envoyes} envoyé(s), ${resultat.echecs} échec(s), ${resultat.ignores} ignoré(s) sans coordonnée, sur ${resultat.total} rendez-vous éligible(s).`,
    );
  } finally {
    await bd.destroy();
  }
}

const codeEntite = process.argv[2];
if (!codeEntite) {
  console.error('Usage : node scripts/executerRappels.js <code_entite>');
  process.exit(1);
}

main(codeEntite).catch((erreur) => {
  console.error('Échec de l’exécution des rappels ✘');
  console.error(erreur.message);
  process.exit(1);
});
