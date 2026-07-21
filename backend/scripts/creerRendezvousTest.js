// Outil de développement — crée un rendez-vous ('prevu') pour un dossier existant, uniquement
// pour pouvoir tester le rappel automatique (executerRappels.js) et l'écran d'évaluation
// formateur tant qu'aucune UI/route de planification n'existe encore (voir
// pages/coordination/Planification.jsx, stub vide). Pas un script de seed d'entité comme les
// autres scripts/seed*.js — n'a pas vocation à être rejoué en production.
//
// formateurId reste optionnel (rendez-vous 'test' non assigné sinon) — nécessaire pour tester
// GET /api/evaluations/a-faire, qui filtre justement par formateur assigné.
//
// Usage : node scripts/creerRendezvousTest.js <dossierId> <typeRdv> <dateHeureISO> [formateurId]
// Exemple : node scripts/creerRendezvousTest.js 42 test 2026-07-22T09:00:00+02:00 8

const { obtenirKnex } = require('../src/db/knex');

async function main(dossierId, typeRdv, dateHeureIso, formateurId) {
  const bd = await obtenirKnex();
  try {
    const dossier = await bd('dossiers').where({ id: dossierId }).first();
    if (!dossier) {
      throw new Error(`Dossier "${dossierId}" introuvable.`);
    }

    const [rendezvous] = await bd('rendezvous')
      .insert({
        dossier_id: dossierId,
        type_rdv: typeRdv,
        date_heure: dateHeureIso,
        statut: 'prevu',
        formateur_id: formateurId ?? null,
      })
      .returning('id');
    console.log(`Rendez-vous créé (id=${rendezvous.id}) pour le dossier ${dossierId} le ${dateHeureIso} ✔`);
  } finally {
    await bd.destroy();
  }
}

const [dossierId, typeRdv, dateHeureIso, formateurId] = process.argv.slice(2);
if (!dossierId || !typeRdv || !dateHeureIso) {
  console.error('Usage : node scripts/creerRendezvousTest.js <dossierId> <typeRdv> <dateHeureISO> [formateurId]');
  process.exit(1);
}

main(dossierId, typeRdv, dateHeureIso, formateurId).catch((erreur) => {
  console.error('Échec ✘');
  console.error(erreur.message);
  process.exit(1);
});
