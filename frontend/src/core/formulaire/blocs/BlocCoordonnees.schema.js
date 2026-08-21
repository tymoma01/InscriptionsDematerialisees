import { z } from 'zod';

// Téléphone français : 10 chiffres commençant par 0, espaces tolérés à la saisie
const TELEPHONE_REGEX = /^0[1-9](\s?\d{2}){4}$/;

// Lettres (accents compris), espaces, tirets et apostrophes uniquement — pas de chiffres
const NOM_REGEX = /^[A-Za-zÀ-ÖØ-öø-ÿ' -]+$/;

// Code postal français : 5 chiffres
const CODE_POSTAL_REGEX = /^\d{5}$/;

export const blocCoordonneesSchema = z.object({
  adresse: z.string().trim().min(1, "Le numéro et le nom de rue sont obligatoires"),
  codePostal: z.string().trim().regex(CODE_POSTAL_REGEX, 'Le code postal doit contenir 5 chiffres'),
  ville: z
    .string()
    .trim()
    .min(1, 'La ville est obligatoire')
    .regex(NOM_REGEX, 'La ville ne peut contenir que des lettres, espaces, tirets ou apostrophes'),
  telephone: z
    .string()
    .trim()
    .regex(TELEPHONE_REGEX, 'Le téléphone doit être un numéro français à 10 chiffres'),
  email: z.string().trim().email('Adresse email invalide'),
  contactUrgenceNom: z
    .string()
    .trim()
    .min(1, "Le nom du contact d'urgence est obligatoire")
    .regex(NOM_REGEX, "Le nom du contact d'urgence ne peut contenir que des lettres, espaces, tirets ou apostrophes"),
  contactUrgenceTelephone: z
    .string()
    .trim()
    .regex(TELEPHONE_REGEX, "Le téléphone du contact d'urgence doit être un numéro français à 10 chiffres"),
});
