// Amorce les types de pièces justificatives d'une entité dans `types_pieces` — table déjà
// existante (migration 014), configurable par entité (voir Modularité, CLAUDE.md) : les codes
// ci-dessous sont ceux d'ACCECIT, pas une liste figée valable pour toute entité. Idempotent.
//
// Usage : node scripts/seedTypesPieces.js <code_entite>

const { obtenirKnex } = require('../src/db/knex');

// obligatoire : true uniquement sur carte_identite/carte_vitale (décision produit, 2026-08-10) —
// même changement que frontend/src/core/pieceJustificative/donneesTest/typesPiecesConfig.accecit.js,
// répercuté ici pour rester cohérent même si `types_pieces.obligatoire` n'est aujourd'hui lu par
// aucune validation backend (voir le commentaire de ce fichier front). Ce script est idempotent
// sur l'existence d'une ligne (voir seedTypesPieces ci-dessous), donc sans effet sur une ligne déjà
// insérée en base avec l'ancienne valeur : à corriger manuellement (UPDATE) sur un environnement
// déjà seedé, pas quelque chose que ré-exécuter ce script fera pour vous.
const TYPES_PIECES_ACCECIT = [
  { code: 'carte_identite', libelle: "Pièce d'identité", obligatoire: true },
  { code: 'carte_vitale', libelle: 'Carte vitale', obligatoire: true },
  { code: 'rib', libelle: 'RIB', obligatoire: false },
  { code: 'justificatif_domicile', libelle: 'Justificatif de domicile', obligatoire: false },
  { code: 'justificatif_experience', libelle: "Justificatif d'expérience", obligatoire: false },
  { code: 'attestation_mutuelle', libelle: 'Attestation mutuelle', obligatoire: false },
];

async function seedTypesPieces(codeEntite) {
  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: codeEntite }).first();
    if (!entite) {
      throw new Error(`Entité « ${codeEntite} » introuvable — exécuter d'abord scripts/seedEntite.js`);
    }

    for (const typePiece of TYPES_PIECES_ACCECIT) {
      const existant = await bd('types_pieces').where({ entite_id: entite.id, code: typePiece.code }).first();
      if (existant) {
        console.log(`Type de pièce « ${typePiece.code} » déjà présent pour « ${codeEntite} » (id=${existant.id}) ✔`);
        continue;
      }

      const [inseree] = await bd('types_pieces')
        .insert({ entite_id: entite.id, ...typePiece })
        .returning('id');
      console.log(`Type de pièce « ${typePiece.code} » créé pour « ${codeEntite} » (id=${inseree.id}) ✔`);
    }
  } finally {
    await bd.destroy();
  }
}

const codeEntite = process.argv[2];
if (!codeEntite) {
  console.error('Usage : node scripts/seedTypesPieces.js <code_entite>');
  process.exit(1);
}

seedTypesPieces(codeEntite).catch((erreur) => {
  console.error('Échec du seed ✘');
  console.error(erreur.message);
  process.exit(1);
});
