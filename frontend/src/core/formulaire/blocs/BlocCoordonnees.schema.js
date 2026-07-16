import { z } from 'zod';

// Téléphone français : 10 chiffres commençant par 0, espaces tolérés à la saisie
const TELEPHONE_REGEX = /^0[1-9](\s?\d{2}){4}$/;

export const blocCoordonneesSchema = z.object({
  adresse: z.string().trim().min(1, "L'adresse est obligatoire"),
  telephone: z
    .string()
    .trim()
    .regex(TELEPHONE_REGEX, 'Le téléphone doit être un numéro français à 10 chiffres'),
  email: z.string().trim().email('Adresse email invalide'),
  contactUrgenceNom: z.string().trim().min(1, "Le nom du contact d'urgence est obligatoire"),
  contactUrgenceTelephone: z
    .string()
    .trim()
    .regex(TELEPHONE_REGEX, "Le téléphone du contact d'urgence doit être un numéro français à 10 chiffres"),
});
