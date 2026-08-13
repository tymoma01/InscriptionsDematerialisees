// Correctif ponctuel — lieu #4 "Hôtel du Cadran" (entité ACCECIT).
//
// Diagnostic (voir audit du 2026-08-13 et scripts/migrerLieuxVersChampsStructures.js, exécuté le
// même jour) : le backfill automatique découpe lieux.libelle sur ses séparateurs "|", mais l'info
// métro de ce lieu était imbriquée ENTRE PARENTHÈSES à l'intérieur du premier segment (l'adresse)
// plutôt que séparée par son propre "|" — le split positionnel a donc mal réparti les 3 segments
// restants sur adresse/metro_acces/instructions :
//
//   ancien libelle : "Hôtel du Cadran - 14 Rue de Valadon, 75007 Paris (Métro: Ecole Militaire -
//                      Ligne 8) | Muni(e) de votre pièce d'identité originale | Appuyez sur
//                      l'interphone et dites * TEST * pour ACCECIT"
//   backfill (faux) : adresse="...Paris (Métro: Ecole Militaire - Ligne 8)"
//                      metro_acces="Muni(e) de votre pièce d'identité originale"  <- en réalité une instruction
//                      instructions="Appuyez sur l'interphone et dites * TEST * pour ACCECIT"
//
// Correction manuelle (décision utilisateur, 2026-08-13) : extrait le métro de l'adresse, regroupe
// les deux consignes candidat (pièce d'identité + interphone) dans `instructions` — c'est ce champ
// qui est exclu de l'email formateur (voir formatageEmail.formaterLignesLieuHtml,
// inclureInstructions: false), donc les deux doivent y être réunies pour rester exclues du bon
// côté. `libelle`/`code` restent inchangés (gelés, voir migration 047 — comparaison possible à
// tout moment avec la valeur d'origine).
//
// Idempotent : si `adresse` a déjà la valeur corrigée au moment de l'exécution, ne fait rien
// (voir garde-fou ci-dessous) plutôt que d'écraser une éventuelle correction déjà appliquée
// autrement (ex. via le bouton crayon de ModalePlanificationTest.jsx).
//
// Usage : node scripts/corrigerLieu4HotelDuCadran.js

const { obtenirKnex } = require('../src/db/knex');

const LIEU_ID = 4;

const ADRESSE_AVANT = 'Hôtel du Cadran - 14 Rue de Valadon, 75007 Paris (Métro: Ecole Militaire - Ligne 8)';
const METRO_ACCES_AVANT = "Muni(e) de votre pièce d'identité originale";
const INSTRUCTIONS_AVANT = "Appuyez sur l'interphone et dites * TEST * pour ACCECIT";

const ADRESSE_APRES = 'Hôtel du Cadran - 14 Rue de Valadon, 75007 Paris';
const METRO_ACCES_APRES = 'Métro Ecole Militaire - Ligne 8';
const INSTRUCTIONS_APRES = "Muni(e) de votre pièce d'identité originale. Appuyez sur l'interphone et dites * TEST * pour ACCECIT";

async function main() {
  const bd = await obtenirKnex();
  try {
    const lieu = await bd('lieux').where({ id: LIEU_ID }).first();
    if (!lieu) {
      throw new Error(`Lieu #${LIEU_ID} introuvable — arrêt sans rien modifier.`);
    }

    if (lieu.adresse === ADRESSE_APRES && lieu.metro_acces === METRO_ACCES_APRES && lieu.instructions === INSTRUCTIONS_APRES) {
      console.log(`Lieu #${LIEU_ID} déjà corrigé — rien à faire.`);
      return;
    }

    if (lieu.adresse !== ADRESSE_AVANT || lieu.metro_acces !== METRO_ACCES_AVANT || lieu.instructions !== INSTRUCTIONS_AVANT) {
      throw new Error(
        `Lieu #${LIEU_ID} : état actuel différent de celui attendu avant correctif (adresse="${lieu.adresse}", ` +
          `metro_acces="${lieu.metro_acces}", instructions="${lieu.instructions}") — arrêt sans rien modifier, ` +
          'ce script ne corrige que ce cas précis (voir scripts/migrerLieuxVersChampsStructures.js).',
      );
    }

    console.log(`Lieu #${LIEU_ID} avant correctif :`);
    console.log(`  adresse      : ${lieu.adresse}`);
    console.log(`  metro_acces  : ${lieu.metro_acces}`);
    console.log(`  instructions : ${lieu.instructions}`);

    await bd('lieux')
      .where({ id: LIEU_ID })
      .update({ adresse: ADRESSE_APRES, metro_acces: METRO_ACCES_APRES, instructions: INSTRUCTIONS_APRES });

    console.log(`\nLieu #${LIEU_ID} après correctif :`);
    console.log(`  adresse      : ${ADRESSE_APRES}`);
    console.log(`  metro_acces  : ${METRO_ACCES_APRES}`);
    console.log(`  instructions : ${INSTRUCTIONS_APRES}`);
    console.log(`\nLieu #${LIEU_ID} corrigé ✔ (libelle/code inchangés)`);
  } finally {
    await bd.destroy();
  }
}

main().catch((erreur) => {
  console.error('Échec du correctif ✘');
  console.error(erreur.message);
  process.exitCode = 1;
});
