import { z } from 'zod';

const MENTION_ATTENDUE = 'lu et approuvé'.normalize('NFC');

export const blocCharteSchema = z.object({
  // Correspondance stricte à la mention exacte, insensible à la casse et aux espaces
  // superflus. `.normalize('NFC')` évite qu'un accent saisi sous sa forme décomposée
  // (ex. clavier tactile/IME produisant "e" + accent combinant plutôt que "é" précomposé)
  // ne soit à tort traité comme une faute de frappe.
  charteMention: z
    .string()
    .trim()
    .refine((valeur) => valeur.normalize('NFC').toLowerCase() === MENTION_ATTENDUE, {
      message: 'Merci de recopier exactement la mention « Lu et Approuvé »',
    }),
  charteSignatureImage: z.string().min(1, 'La signature électronique est obligatoire'),
});
