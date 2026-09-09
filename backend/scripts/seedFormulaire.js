// Amorce l'activation/ordre des blocs du formulaire d'inscription d'une entité à partir de son
// formulaire.config.json (voir architecture-technique.md §1.3 : les *.config.json servent de
// source de seed, jamais lus directement par le moteur applicatif — même principe que
// scripts/seedStatuts.js pour workflow.config.json). Idempotent.
//
// Ne seed QUE entite_blocs_formulaire (activation/ordre/étape/largeur pour CETTE entité) — le
// catalogue global des blocs que le moteur sait réellement afficher (code + libellé, un par
// composant du blocRegistry.js front) reste porté par scripts/seedBlocsDisponibles.js, exécuté
// avant celui-ci : un bloc_code absent de blocs_disponibles fait échouer l'insertion (FK), avec un
// message clair ci-dessous plutôt qu'une erreur SQL brute.
//
// Usage : node scripts/seedFormulaire.js <code_entite>

const path = require('path');
const { obtenirKnex } = require('../src/db/knex');

async function seedFormulaire(codeEntite) {
  const config = require(path.join(__dirname, '..', 'src', 'entites', codeEntite, 'formulaire.config.json'));
  const blocs = config.blocs || [];

  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: codeEntite }).first();
    if (!entite) {
      throw new Error(`Entité « ${codeEntite} » introuvable — exécuter d'abord scripts/seedEntite.js`);
    }

    for (const bloc of blocs) {
      const blocDisponible = await bd('blocs_disponibles').where({ code: bloc.code }).first();
      if (!blocDisponible) {
        throw new Error(
          `Bloc « ${bloc.code} » absent de blocs_disponibles — exécuter d'abord scripts/seedBlocsDisponibles.js`,
        );
      }

      const existant = await bd('entite_blocs_formulaire')
        .where({ entite_id: entite.id, bloc_code: bloc.code })
        .first();
      const valeurs = {
        actif: Boolean(bloc.actif),
        etape: bloc.etape,
        ordre: bloc.ordre,
        largeur: bloc.largeur ?? null,
      };
      if (existant) {
        await bd('entite_blocs_formulaire').where({ id: existant.id }).update(valeurs);
        console.log(`Bloc « ${bloc.code} » déjà présent pour « ${codeEntite} » (id=${existant.id}) — mis à jour ✔`);
      } else {
        const [inseree] = await bd('entite_blocs_formulaire')
          .insert({ entite_id: entite.id, bloc_code: bloc.code, ...valeurs })
          .returning('id');
        console.log(`Bloc « ${bloc.code} » activé pour « ${codeEntite} » (id=${inseree.id}) ✔`);
      }
    }
  } finally {
    await bd.destroy();
  }
}

const codeEntite = process.argv[2];
if (!codeEntite) {
  console.error('Usage : node scripts/seedFormulaire.js <code_entite>');
  process.exit(1);
}

seedFormulaire(codeEntite).catch((erreur) => {
  console.error('Échec du seed ✘');
  console.error(erreur.message);
  process.exit(1);
});
