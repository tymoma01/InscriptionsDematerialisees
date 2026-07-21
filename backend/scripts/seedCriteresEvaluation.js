// Amorce les critères d'évaluation du test d'une entité dans `criteres_evaluation` (table déjà
// existante, migration 019) — codes ci-dessous cités explicitement par CLAUDE.md pour ACCECIT
// ("hygiène, assiduité, respect des consignes, temps moyens de service"), configurables par
// entité, pas une liste figée valable pour toute entité (voir Modularité, CLAUDE.md — même
// patron que scripts/seedTypesPieces.js). Idempotent.
//
// Usage : node scripts/seedCriteresEvaluation.js <code_entite>

const { obtenirKnex } = require('../src/db/knex');

const CRITERES_ACCECIT = [
  { code: 'hygiene', libelle: 'Hygiène', ordre: 1 },
  { code: 'assiduite', libelle: 'Assiduité', ordre: 2 },
  { code: 'respect_consignes', libelle: 'Respect des consignes', ordre: 3 },
  { code: 'temps_service', libelle: 'Temps moyens de service', ordre: 4 },
];

async function seedCriteresEvaluation(codeEntite) {
  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: codeEntite }).first();
    if (!entite) {
      throw new Error(`Entité « ${codeEntite} » introuvable — exécuter d'abord scripts/seedEntite.js`);
    }

    for (const critere of CRITERES_ACCECIT) {
      const existant = await bd('criteres_evaluation').where({ entite_id: entite.id, code: critere.code }).first();
      if (existant) {
        await bd('criteres_evaluation')
          .where({ id: existant.id })
          .update({ libelle: critere.libelle, ordre: critere.ordre });
        console.log(`Critère « ${critere.code} » déjà présent pour « ${codeEntite} » (id=${existant.id}) — mis à jour ✔`);
        continue;
      }

      const [inseree] = await bd('criteres_evaluation')
        .insert({ entite_id: entite.id, ...critere })
        .returning('id');
      console.log(`Critère « ${critere.code} » créé pour « ${codeEntite} » (id=${inseree.id}) ✔`);
    }
  } finally {
    await bd.destroy();
  }
}

const codeEntite = process.argv[2];
if (!codeEntite) {
  console.error('Usage : node scripts/seedCriteresEvaluation.js <code_entite>');
  process.exit(1);
}

seedCriteresEvaluation(codeEntite).catch((erreur) => {
  console.error('Échec du seed ✘');
  console.error(erreur.message);
  process.exit(1);
});
