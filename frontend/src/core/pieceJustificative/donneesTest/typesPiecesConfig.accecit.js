// Données de test locales — à remplacer par un appel API (GET des types de pièces actifs pour
// l'entité, table `types_pieces`) le jour où cette route sera exposée côté back ; aucune ne
// l'expose encore aujourd'hui (voir backend/scripts/seedTypesPieces.js, qui amorce directement
// ces mêmes codes en base). Même patron que formulaireConfig.accecit.js pour la config des
// blocs du formulaire : CaptureTablette.jsx ne connaît que la forme
// { code, libelle, obligatoire, captureUniquement, codeVerso }, jamais ces valeurs ACCECIT en dur
// (voir Modularité, CLAUDE.md).
// obligatoire : true sur photo_identite/carte_identite/carte_vitale (décision produit,
// 2026-08-10 puis 2026-08-17) — rib et justificatif_domicile étaient obligatoires jusque-là,
// désormais optionnelles au même titre que justificatif_experience/attestation_mutuelle qui
// l'étaient déjà. Ne conditionne que le bouton "Valider et planifier un test" de
// CaptureTablette.jsx (piecesObligatoiresCompletes) — aucune validation backend ne s'appuie sur
// ce flag (voir pieces.routes.js/pieceJustificativeService.js : `types_pieces` n'y sert qu'à
// résoudre code/libelle, jamais à bloquer une transition).
// captureUniquement : true uniquement sur photo_identite — masque le bouton "Choisir un fichier"
// (PanneauCapture, CaptureTablette.jsx), pour empêcher l'upload d'une photo déjà existante. Revalidé
// côté serveur (types_pieces.capture_uniquement, migration 048 — voir son commentaire pour les
// limites explicites de ce contrôle, une garde partielle sur le Content-Type du fichier envoyé,
// pas une preuve de capture réelle).
// codeVerso : présent uniquement sur carte_identite — pointe vers un second code de pièce
// (carte_identite_verso, bien réel en base/stockage, voir seedTypesPieces.js) proposé en
// complément OPTIONNEL une fois le recto/document principal capturé, jamais comme entrée
// séparée de cette liste (CaptureTablette.jsx l'exclut volontairement de ce tableau, donc des
// compteurs "X / Y pièces capturées"/pièces obligatoires, qui ne parcourent que ce tableau — voir
// son commentaire d'en-tête). Revient le 2026-08-17 sur une scission recto/verso en deux pièces
// obligatoires DISTINCTES tentée puis annulée le même jour : carte_identite reste la seule pièce
// de la liste, le verso n'étant qu'un complément qui lui est rattaché.
export const typesPiecesConfigAccecitTest = [
  { code: 'photo_identite', libelle: "Photo d'identité", obligatoire: true, captureUniquement: true },
  { code: 'carte_identite', libelle: "Carte d'identité ou Carte de Séjour", obligatoire: true, codeVerso: 'carte_identite_verso' },
  { code: 'carte_vitale', libelle: 'Carte Vitale ou Attestation de Sécurité Sociale', obligatoire: true },
  { code: 'rib', libelle: "Relevé d'identité bancaire (RIB)", obligatoire: false },
  { code: 'justificatif_domicile', libelle: 'Justificatif de domicile', obligatoire: false },
  { code: 'justificatif_experience', libelle: "Justificatif d'expériences", obligatoire: false },
  { code: 'attestation_mutuelle', libelle: 'Attestation Mutuelle', obligatoire: false },
];
