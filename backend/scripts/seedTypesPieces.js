// Amorce les types de pièces justificatives d'une entité dans `types_pieces` — table déjà
// existante (migration 014), configurable par entité (voir Modularité, CLAUDE.md) : les codes
// ci-dessous sont ceux d'ACCECIT, pas une liste figée valable pour toute entité. Idempotent.
//
// Usage : node scripts/seedTypesPieces.js <code_entite>

const { obtenirKnex } = require('../src/db/knex');

// Source de vérité : la table types_pieces (lue par GET /api/types-pieces). Ce script ne fait
// qu'amorcer une base vide ; il est idempotent sur l'existence d'une ligne et ne modifie donc
// jamais une ligne existante — tout changement de valeur passe par une migration (ex. 076).
//
// obligatoire : conditionne le bouton « Valider et planifier un test » ET la transition
// automatique 'pieces_completes' (pieceJustificativeRepository.toutesPiecesObligatoiresPresentes).
//
// capture_uniquement : true seulement sur photo_identite (migration 048) — seul "Prendre une
// photo" doit être proposé pour cette pièce (voir CaptureTablette.jsx et la garde associée dans
// pieceJustificativeService.js, uploaderPieceJustificative).
//
// carte_identite_verso : type de pièce à part entière côté base/stockage (mêmes garanties
// d'unicité/traçabilité par dossier qu'un type normal, voir pieceJustificativeRepository.js),
// mais délibérément absent de la liste principale de pièces côté front
// (référencé par `code_verso` sur l'entrée carte_identite, jamais un élément de la liste
// renvoyée par GET /api/types-pieces) : obligatoire=false, jamais compté
// dans "X / Y pièces capturées" ni dans les pièces obligatoires (2026-08-17, revient sur une
// scission recto/verso en deux pièces DISTINCTES tentée puis annulée le même jour — carte_identite
// reste la seule pièce "recto", le verso n'étant qu'un complément optionnel qui lui est rattaché).
const TYPES_PIECES_ACCECIT = [
  { code: 'photo_identite', ordre: 1, libelle: "Photo d'identité", obligatoire: true, capture_uniquement: true },
  { code: 'carte_identite', ordre: 2, libelle: "Carte d'identité ou Carte de Séjour", obligatoire: true, code_verso: 'carte_identite_verso' },
  { code: 'carte_identite_verso', ordre: 2, libelle: 'Carte d’identité ou Carte de Séjour - Verso (optionnel)', obligatoire: false },
  { code: 'carte_vitale', ordre: 3, libelle: 'Carte Vitale ou Attestation de Sécurité Sociale', obligatoire: true },
  { code: 'rib', ordre: 4, libelle: "Relevé d'identité bancaire (RIB)", obligatoire: true },
  { code: 'justificatif_domicile', ordre: 5, libelle: 'Justificatif de domicile', obligatoire: true },
  { code: 'justificatif_experience', ordre: 6, libelle: "Justificatif d'expériences", obligatoire: false },
  { code: 'attestation_mutuelle', ordre: 7, libelle: 'Attestation Mutuelle', obligatoire: false },
  // Seul type qui accepte plusieurs documents pour un même dossier.
  { code: 'autres', ordre: 8, libelle: 'Autres documents', obligatoire: false, multiple: true },
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
