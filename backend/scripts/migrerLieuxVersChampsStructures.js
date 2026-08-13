// Backfill ponctuel (même patron que scripts/marquerPiecesOrphelines.js) — décompose
// lieux.libelle (texte libre historique, formaté à la main avec des séparateurs " | " pour
// distinguer adresse/accès/instructions) vers les nouvelles colonnes structurées
// adresse/metro_acces/instructions (migration 047, audit du 2026-08-13). `libelle` n'est JAMAIS
// modifiée ni supprimée ici — colonne conservée pour un rollback simple tant que le nouveau schéma
// n'a pas fait ses preuves en production (voir migration 047).
//
// segments[0] -> adresse, segments[1] -> metro_acces (si présent), segments[2..] -> instructions
// (rejoints par " | " si plus de 3 segments — cas non rencontré à ce jour, 2 lieux seulement en
// base). Ce split POSITIONNEL est une heuristique, pas une garantie sémantique : rien ne dit que
// le énième segment séparé par un "|" soit vraiment "l'accès" ou "les instructions" plutôt que
// l'inverse, ni qu'une information d'accès n'ait pas été glissée à la main À L'INTÉRIEUR du
// premier segment (ex. entre parenthèses dans l'adresse elle-même) plutôt que séparée par son
// propre "|" — un split naïf ne peut pas le détecter. D'où le log explicite ci-dessous : CHAQUE
// ligne backfillée doit être relue manuellement avant mise en production, ce script ne fait aucune
// hypothèse de correction automatique au-delà de la position des séparateurs "|".
//
// Idempotent : ignore tout lieu dont `adresse` est déjà renseignée (déjà backfillé par un appel
// précédent, ou créé/corrigé depuis la bascule du code applicatif sur les champs structurés) — un
// ré-appel de ce script n'écrase donc jamais une correction manuelle déjà faite en base ou via le
// back-office (bouton crayon, ModalePlanificationTest.jsx).
//
// Usage : node scripts/migrerLieuxVersChampsStructures.js [--dry-run]

const { obtenirKnex } = require('../src/db/knex');

const DRY_RUN = process.argv.includes('--dry-run');

// Nombre de segments au-delà duquel le mapping positionnel devient statistiquement plus risqué
// (voir en-tête de fichier) — sert seulement à mettre en évidence les lignes qui méritent le plus
// d'attention à la relecture, pas à changer le comportement du split lui-même.
const SEUIL_SEGMENTS_A_RISQUE = 2;

function decomposerLibelle(libelle) {
  const segments = libelle
    .split('|')
    .map((segment) => segment.trim())
    .filter(Boolean);
  const [adresse, metroAcces, ...reste] = segments;
  return {
    adresse: adresse ?? libelle.trim(),
    metroAcces: metroAcces ?? null,
    instructions: reste.length > 0 ? reste.join(' | ') : null,
    nombreSegments: segments.length,
  };
}

async function main() {
  const bd = await obtenirKnex();
  try {
    const lieux = await bd('lieux').whereNull('adresse').orderBy('id');

    if (lieux.length === 0) {
      console.log('Aucun lieu à migrer (tous ont déjà une adresse renseignée).');
      return;
    }

    console.log(`${lieux.length} lieu(x) à migrer.`);
    if (DRY_RUN) console.log('--dry-run : aucune écriture ne sera faite.');
    console.log('');

    let nbARisque = 0;

    for (const lieu of lieux) {
      const { adresse, metroAcces, instructions, nombreSegments } = decomposerLibelle(lieu.libelle);
      const aRisque = nombreSegments > SEUIL_SEGMENTS_A_RISQUE;
      if (aRisque) nbARisque += 1;

      if (!DRY_RUN) {
        // eslint-disable-next-line no-await-in-loop -- petit volume (quelques lieux), log
        // séquentiel lisible plutôt qu'un Promise.all qui entrelacerait la sortie console.
        await bd('lieux').where({ id: lieu.id }).update({ adresse, metro_acces: metroAcces, instructions });
      }

      console.log(`${aRisque ? '⚠ ' : ''}Lieu #${lieu.id} (${lieu.code}) — À VÉRIFIER MANUELLEMENT :`);
      console.log(`  ancien libelle  : ${lieu.libelle}`);
      console.log(`  -> adresse      : ${adresse}`);
      console.log(`  -> metro_acces  : ${metroAcces ?? '(vide)'}`);
      console.log(`  -> instructions : ${instructions ?? '(vide)'}`);
      if (aRisque) {
        console.log(`  ⚠ ${nombreSegments} segments séparés par "|" détectés : le mapping positionnel est le plus`);
        console.log('    susceptible d\'être faux ici (ex. une info d\'accès imbriquée dans l\'adresse elle-même');
        console.log('    plutôt que séparée par son propre "|") — relecture prioritaire recommandée.');
      }
      console.log('');
    }

    console.log(
      `${lieux.length} lieu(x) ${DRY_RUN ? 'à backfiller (dry-run, rien écrit)' : 'backfillé(s)'}` +
        `, dont ${nbARisque} à relecture prioritaire (>${SEUIL_SEGMENTS_A_RISQUE} segments).`,
    );
    console.log("Relire chaque ligne ci-dessus avant mise en production — `libelle` reste inchangée en base,");
    console.log('donc comparable à tout moment à ce que ce script en a déduit.');
  } finally {
    await bd.destroy();
  }
}

main().catch((erreur) => {
  console.error('Échec du backfill ✘');
  console.error(erreur.message);
  process.exit(1);
});
