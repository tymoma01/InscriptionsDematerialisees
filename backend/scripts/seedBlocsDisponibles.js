// Amorce le catalogue global `blocs_disponibles` à partir de blocRegistry.js (frontend) —
// une ligne par bloc que le moteur sait afficher/valider, indépendamment de toute entité
// (voir architecture-technique.md §1.4 : activation/ordre/config restent dans
// entite_blocs_formulaire, jamais ici). Idempotent : ré-exécutable sans dupliquer les lignes.
//
// Usage : node scripts/seedBlocsDisponibles.js

const { obtenirKnex } = require('../src/db/knex');

const BLOCS = [
  { code: 'infos_perso', libelle: 'Informations personnelles' },
  { code: 'coordonnees', libelle: 'Coordonnées' },
];

async function seedBlocsDisponibles() {
  const bd = await obtenirKnex();
  try {
    for (const bloc of BLOCS) {
      const existant = await bd('blocs_disponibles').where({ code: bloc.code }).first();
      if (existant) {
        await bd('blocs_disponibles').where({ code: bloc.code }).update({ libelle: bloc.libelle });
        console.log(`Bloc « ${bloc.code} » déjà présent (id=${existant.id}) — mis à jour ✔`);
      } else {
        const [inseree] = await bd('blocs_disponibles').insert(bloc).returning('id');
        console.log(`Bloc « ${bloc.code} » créé (id=${inseree.id}) ✔`);
      }
    }
  } finally {
    await bd.destroy();
  }
}

seedBlocsDisponibles().catch((erreur) => {
  console.error('Échec du seed ✘');
  console.error(erreur.message);
  process.exit(1);
});
