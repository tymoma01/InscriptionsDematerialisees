import { z } from 'zod';
import { NATIONALITES } from './nationalites';

// NIR : 15 chiffres (13 + clé à 2 chiffres), espaces tolérés à la saisie
const NIR_REGEX = /^\d{13}\s?\d{2}$/;

// Nom de naissance : lettres uniquement (accents, tirets et apostrophes tolérés)
const LETTRES_REGEX = /^[A-Za-zÀ-ÖØ-öø-ÿ' -]+$/;

export const blocInfosPersoSchema = z.object({
  nom: z.string().trim().min(1, 'Le nom est obligatoire'),
  // Facultatif : vide accepté, mais lettres uniquement si renseigné
  nomNaissance: z
    .string()
    .trim()
    .refine((valeur) => valeur === '' || LETTRES_REGEX.test(valeur), {
      message: 'Le nom de naissance ne doit contenir que des lettres',
    }),
  lieuNaissance: z.string().trim().min(1, 'Le lieu de naissance est obligatoire'),
  // Doit correspondre à une option de la liste déroulante (voir nationalites.js), plus de texte libre
  nationalite: z.enum(NATIONALITES, { errorMap: () => ({ message: 'La nationalité est obligatoire' }) }),
  prenom: z.string().trim().min(1, 'Le prénom est obligatoire'),
  dateNaissance: z.string().min(1, 'La date de naissance est obligatoire'),
  nir: z
    .string()
    .trim()
    .regex(NIR_REGEX, 'Le n° de sécurité sociale doit contenir 15 chiffres'),
  situationFamiliale: z.string().min(1, 'La situation familiale est obligatoire'),
});
