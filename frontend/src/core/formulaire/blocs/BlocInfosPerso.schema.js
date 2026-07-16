import { z } from 'zod';

// NIR : 15 chiffres (13 + clé à 2 chiffres), espaces tolérés à la saisie
const NIR_REGEX = /^\d{13}\s?\d{2}$/;

export const blocInfosPersoSchema = z.object({
  nom: z.string().trim().min(1, 'Le nom est obligatoire'),
  prenom: z.string().trim().min(1, 'Le prénom est obligatoire'),
  dateNaissance: z.string().min(1, 'La date de naissance est obligatoire'),
  nir: z
    .string()
    .trim()
    .regex(NIR_REGEX, 'Le n° de sécurité sociale doit contenir 15 chiffres'),
  situationFamiliale: z.string().min(1, 'La situation familiale est obligatoire'),
});
