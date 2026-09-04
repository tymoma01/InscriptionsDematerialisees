import { z } from 'zod';

// Insensible aux accents en plus de la casse (décision utilisateur, 2026-09-04) : un candidat qui
// recopie "lu et approuve" sans accent doit être accepté au même titre que "Lu et Approuvé".
// `.normalize('NFD')` décompose chaque lettre accentuée en lettre de base + diacritique
// combinant, que `\p{Diacritic}` retire ensuite — plus robuste qu'énumérer les variantes
// possibles à la main. Même correctif que dossierService.js côté back.
function normaliserMentionCharte(valeur) {
  return valeur
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}
const MENTION_ATTENDUE = normaliserMentionCharte('lu et approuvé');

export const blocCharteSchema = z.object({
  // Correspondance à la mention attendue, insensible à la casse, aux accents et aux espaces
  // superflus (voir normaliserMentionCharte ci-dessus).
  charteMention: z
    .string()
    .trim()
    .refine((valeur) => normaliserMentionCharte(valeur) === MENTION_ATTENDUE, {
      message: 'Merci de recopier exactement la mention « Lu et Approuvé »',
    }),
  charteSignatureImage: z.string().min(1, 'La signature électronique est obligatoire'),
});
