// Données de test locales — à remplacer par un appel API (GET des types de pièces actifs pour
// l'entité, table `types_pieces`) le jour où cette route sera exposée côté back ; aucune ne
// l'expose encore aujourd'hui (voir backend/scripts/seedTypesPieces.js, qui amorce directement
// ces mêmes codes en base). Même patron que formulaireConfig.accecit.js pour la config des
// blocs du formulaire : CaptureTablette.jsx ne connaît que la forme { code, libelle, obligatoire },
// jamais ces valeurs ACCECIT en dur (voir Modularité, CLAUDE.md).
// obligatoire : true uniquement sur carte_identite/carte_vitale (décision produit, 2026-08-10) —
// rib et justificatif_domicile étaient obligatoires jusque-là, désormais optionnelles au même
// titre que justificatif_experience/attestation_mutuelle qui l'étaient déjà. Ne conditionne que le
// bouton "Valider et planifier un test" de CaptureTablette.jsx (piecesObligatoiresCompletes) —
// aucune validation backend ne s'appuie sur ce flag (voir pieces.routes.js/
// pieceJustificativeService.js : `types_pieces` n'y sert qu'à résoudre code/libelle, jamais à
// bloquer une transition).
export const typesPiecesConfigAccecitTest = [
  { code: 'carte_identite', libelle: "Carte d'identité ou Carte de Séjour", obligatoire: true },
  { code: 'carte_vitale', libelle: 'Carte Vitale ou Attestation de Sécurité Sociale', obligatoire: true },
  { code: 'rib', libelle: "Relevé d'identité bancaire (RIB)", obligatoire: false },
  { code: 'justificatif_domicile', libelle: 'Justificatif de domicile', obligatoire: false },
  { code: 'justificatif_experience', libelle: "Justificatif d'expériences", obligatoire: false },
  { code: 'attestation_mutuelle', libelle: 'Attestation Mutuelle', obligatoire: false },
];
