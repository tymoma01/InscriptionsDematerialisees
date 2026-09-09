import { z } from 'zod';
import { NATIONALITES } from './nationalites';

// NIR : 15 chiffres (13 + clé à 2 chiffres), espaces tolérés à la saisie. Exportée : réutilisée
// par BlocInfosPerso.jsx pour la validation croisée NIR / civilité / date de naissance (voir
// calculerErreurCoherenceNir là-bas — implémentée en dehors du schéma zod, pas via .refine() :
// react-hook-form + zodResolver s'est révélé peu fiable pour rafraîchir une erreur croisée sur un
// champ quand c'est un AUTRE champ dont dépend le refine qui change, voir le commentaire détaillé
// dans BlocInfosPerso.jsx).
export const NIR_REGEX = /^\d{13}\s?\d{2}$/;

// Nom de naissance : lettres uniquement (accents, tirets et apostrophes tolérés)
const LETTRES_REGEX = /^[A-Za-zÀ-ÖØ-öø-ÿ' -]+$/;

// Nationalité uniquement (audit 2026-09-09, même regex dédié que dossierService.js côté
// backend) : LETTRES_REGEX ci-dessus rejetterait "Congolaise (Congo-Brazzaville)"/"Congolaise
// (RDC)" (nationalites.js) — parenthèses légitimes pour désambiguïser deux pays distincts
// partageant le même gentilé, pas une valeur mal formée. Le .refine() ci-dessous ne sert qu'à
// rattraper une future entrée mal formée dans nationalites.js AVANT soumission (z.enum
// ci-dessous garantit déjà l'appartenance à la liste, mais pas la validité de ses caractères) —
// avec les 197 valeurs actuelles, ce refine ne peut jamais échouer.
const NATIONALITE_REGEX = /^[A-Za-zÀ-ÖØ-öø-ÿ' ()-]+$/;

export const blocInfosPersoSchema = z.object({
  civilite: z.enum(['monsieur', 'madame'], { required_error: 'La civilité est obligatoire' }),
  nom: z.string().trim().min(1, 'Le nom est obligatoire'),
  // Facultatif : vide accepté, mais lettres uniquement si renseigné
  nomNaissance: z
    .string()
    .trim()
    .refine((valeur) => valeur === '' || LETTRES_REGEX.test(valeur), {
      message: 'Le nom de naissance ne doit contenir que des lettres',
    }),
  lieuNaissance: z.string().trim().min(1, 'Le lieu de naissance est obligatoire'),
  // Doit correspondre à une option de la liste déroulante (voir nationalites.js), plus de texte
  // libre — .refine() supplémentaire (voir NATIONALITE_REGEX ci-dessus) : filet de sécurité
  // avant soumission, jamais pris en défaut par la liste actuelle, mais évite qu'une future
  // valeur mal formée n'atteigne le bouton "Valider" sans erreur visible.
  nationalite: z
    .enum(NATIONALITES, { errorMap: () => ({ message: 'La nationalité est obligatoire' }) })
    .refine((valeur) => NATIONALITE_REGEX.test(valeur), {
      message: 'La nationalité contient un caractère non autorisé.',
    }),
  prenom: z.string().trim().min(1, 'Le prénom est obligatoire'),
  dateNaissance: z.string().min(1, 'La date de naissance est obligatoire'),
  // Facultatif (décision utilisateur, 2026-09-04) : vide accepté, mais format NIR (15 chiffres)
  // respecté si renseigné — revalidé côté serveur (voir dossierService.js).
  nir: z
    .string()
    .trim()
    .refine((valeur) => valeur === '' || NIR_REGEX.test(valeur), {
      message: 'Le n° de sécurité sociale doit contenir 15 chiffres',
    }),
  situationFamiliale: z.string().min(1, 'La situation familiale est obligatoire'),
});
