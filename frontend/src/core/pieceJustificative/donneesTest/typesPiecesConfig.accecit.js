// Données de test locales — à remplacer par un appel API (GET des types de pièces actifs pour
// l'entité, table `types_pieces`) le jour où cette route sera exposée côté back ; aucune ne
// l'expose encore aujourd'hui (voir backend/scripts/seedTypesPieces.js, qui amorce directement
// ces mêmes codes en base). Même patron que formulaireConfig.accecit.js pour la config des
// blocs du formulaire : CaptureTablette.jsx ne connaît que la forme
// { code, libelle, obligatoire, captureUniquement, codeVerso }, jamais ces valeurs ACCECIT en dur
// (voir Modularité, CLAUDE.md).
// obligatoire : true sur photo_identite/carte_identite/carte_vitale/rib/justificatif_domicile
// (décision produit, 2026-08-10 puis 2026-08-17, puis 2026-09-11 qui revient sur ce dernier
// changement — rib et justificatif_domicile redeviennent obligatoires, comme avant le 2026-08-17)
// — seuls justificatif_experience/attestation_mutuelle/autres restent optionnels. Conditionne le
// bouton "Valider et planifier un test" de CaptureTablette.jsx (piecesObligatoiresCompletes), MAIS
// AUSSI une vraie transition backend automatique (audit 2026-09-11, corrige le commentaire
// précédent qui affirmait le contraire) : voir pieceJustificativeRepository.
// toutesPiecesObligatoiresPresentes, qui lit CETTE MÊME colonne obligatoire en base
// (types_pieces.obligatoire, tenue à jour séparément — voir backend/scripts/seedTypesPieces.js,
// script non ré-exécutable pour changer une valeur déjà seedée, un UPDATE manuel est nécessaire)
// pour déclencher la transition 'pieces_completes' (en_attente_pieces -> test_non_planifie) dès
// que toutes les pièces obligatoires de l'entité sont chargées.
// multiple : true uniquement sur "autres" (migration 062, demande utilisateur 2026-09-10) — seul
// type qui accepte autant de documents que voulu pour un même dossier, avec renommage possible de
// chacun, au lieu du slot unique "Reprendre/Supprimer" des autres types (voir CaptureTablette.jsx,
// bloc dédié aux types `multiple`). Toujours en dernier de la liste (convention, pas une
// contrainte technique) : une entrée fourre-tout se lit naturellement après les pièces nommées.
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
  { code: 'rib', libelle: "Relevé d'identité bancaire (RIB)", obligatoire: true },
  { code: 'justificatif_domicile', libelle: 'Justificatif de domicile', obligatoire: true },
  { code: 'justificatif_experience', libelle: "Justificatif d'expériences", obligatoire: false },
  { code: 'attestation_mutuelle', libelle: 'Attestation Mutuelle', obligatoire: false },
  { code: 'autres', libelle: 'Autres documents', obligatoire: false, multiple: true },
];
