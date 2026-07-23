// Corrige la civilité des candidats déjà en base, backfillée avec le placeholder "À COMPLÉTER"
// par la migration 033_ajout_civilite_candidats.js (le champ n'existait pas encore dans le
// formulaire au moment de leur inscription). Pas une valeur devinée : le premier chiffre du NIR
// encode le sexe selon la norme INSEE (1 = homme, 2 = femme) — une donnée réelle déjà saisie et
// stockée (chiffrée) pour ces candidats, contrairement à leur civilité qui n'a jamais été
// collectée. Idempotent : ne cible que les lignes encore au placeholder, donc sans effet sur un
// nouveau candidat inscrit depuis l'ajout du champ Civilité au formulaire.
//
// Usage : node scripts/reconstruireCiviliteCandidats.js

const { obtenirKnex } = require('../src/db/knex');
const { dechiffrer } = require('../src/core/securite/nirCipher');

const VALEUR_PLACEHOLDER = 'À COMPLÉTER';

const CIVILITE_PAR_PREMIER_CHIFFRE = { 1: 'monsieur', 2: 'madame' };

async function reconstruireCivilite() {
  const bd = await obtenirKnex();
  try {
    const candidats = await bd('candidats').where({ civilite: VALEUR_PLACEHOLDER }).select('id', 'nir', 'nir_iv');
    console.log(`${candidats.length} candidat(s) au placeholder à corriger.`);

    let corriges = 0;
    let ignores = 0;

    for (const candidat of candidats) {
      try {
        const nirClair = await dechiffrer(candidat.nir, candidat.nir_iv);
        const premierChiffre = Number(nirClair.trim().charAt(0));
        const civilite = CIVILITE_PAR_PREMIER_CHIFFRE[premierChiffre];

        if (!civilite) {
          console.warn(
            `Candidat ${candidat.id} : premier chiffre du NIR "${premierChiffre}" non reconnu ` +
              `(attendu 1 ou 2) — laissé au placeholder, à corriger manuellement.`,
          );
          ignores += 1;
          continue;
        }

        await bd('candidats').where({ id: candidat.id }).update({ civilite });
        console.log(`Candidat ${candidat.id} : civilité corrigée -> "${civilite}" ✔`);
        corriges += 1;
      } catch (erreur) {
        console.error(`Candidat ${candidat.id} : échec du déchiffrement du NIR, ignoré (${erreur.message})`);
        ignores += 1;
      }
    }

    console.log(`Terminé : ${corriges} corrigé(s), ${ignores} ignoré(s) ✔`);
  } finally {
    await bd.destroy();
  }
}

reconstruireCivilite().catch((erreur) => {
  console.error('Échec du script ✘');
  console.error(erreur.message);
  process.exit(1);
});
