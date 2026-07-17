import { z } from 'zod';

const MENTION_ATTENDUE = 'lu et approuvé';

export const blocCharteSchema = z.object({
  // Correspondance stricte à la mention exacte, insensible à la casse
  charteMention: z
    .string()
    .trim()
    .refine((valeur) => valeur.toLowerCase() === MENTION_ATTENDUE, {
      message: 'Merci de recopier exactement la mention « Lu et Approuvé »',
    }),
  charteSignatureImage: z.string().min(1, 'La signature électronique est obligatoire'),
});
