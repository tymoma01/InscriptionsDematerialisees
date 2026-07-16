// Amorce uniquement le statut initial ('nouveau') d'une entité, condition minimale pour que
// dossierService.js puisse créer un dossier (voir trouverStatutInitial). Volontairement limité
// à ce seul statut : la machine à états complète (transitions_statut, motifs) reste un point
// ouvert de revue avec le développeur senior (docs/schema-bdd-proposition.md, point ouvert n°1/2)
// — pas à figer ici via un script d'amorçage ponctuel. Idempotent.
//
// Usage : node scripts/seedStatutInitial.js <code_entite>

const { obtenirKnex } = require('../src/db/knex');

async function seedStatutInitial(codeEntite) {
  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: codeEntite }).first();
    if (!entite) {
      throw new Error(`Entité « ${codeEntite} » introuvable — exécuter d'abord scripts/seedEntite.js`);
    }

    const existant = await bd('statuts').where({ entite_id: entite.id, code: 'nouveau' }).first();
    if (existant) {
      console.log(`Statut « nouveau » déjà présent pour « ${codeEntite} » (id=${existant.id}) ✔`);
      return;
    }

    const [inseree] = await bd('statuts')
      .insert({
        entite_id: entite.id,
        code: 'nouveau',
        libelle: 'Nouveau',
        ordre: 1,
        est_initial: true,
        est_final: false,
      })
      .returning('id');
    console.log(`Statut « nouveau » créé pour « ${codeEntite} » (id=${inseree.id}) ✔`);
  } finally {
    await bd.destroy();
  }
}

const codeEntite = process.argv[2];
if (!codeEntite) {
  console.error('Usage : node scripts/seedStatutInitial.js <code_entite>');
  process.exit(1);
}

seedStatutInitial(codeEntite).catch((erreur) => {
  console.error('Échec du seed ✘');
  console.error(erreur.message);
  process.exit(1);
});
