import { z } from 'zod';

const CRENEAUX = ['matin', 'midi', 'soir'];
const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const LANGUES = ['francais', 'anglais', 'autre'];
const TYPES_POSTE = ['bureau', 'hotel'];
const POSTES_BUREAU = ['nettoyage', 'vitrerie', 'machiniste', 'chef_equipe', 'autres'];
const POSTES_HOTEL = ['femme_valet_chambre', 'cafetier', 'equipier', 'gouvernant'];
const COMMENT_CONNU = ['bouche_a_oreille', 'internet', 'cooptation', 'autre'];

export const blocDisponibilitesSchema = z
  .object({
    disponibiliteImmediate: z.boolean(),
    dateDebut: z.string().trim().optional().default(''),
    dateFin: z.string().trim().optional().default(''),
    creneaux: z.array(z.enum(CRENEAUX)).min(1, 'Sélectionnez au moins un créneau souhaité'),
    joursDisponibles: z.array(z.enum(JOURS)).min(1, 'Sélectionnez au moins un jour disponible'),
    languesParlees: z.array(z.enum(LANGUES)).default([]),
    autreLanguePrecision: z.string().trim().optional().default(''),
    typePoste: z.enum(TYPES_POSTE, { required_error: 'Le type de poste recherché est obligatoire' }),
    posteBureau: z.array(z.enum(POSTES_BUREAU)).default([]),
    autrePosteBureauPrecision: z.string().trim().optional().default(''),
    posteHotel: z.array(z.enum(POSTES_HOTEL)).default([]),
    commentConnu: z.enum(COMMENT_CONNU, { required_error: 'Merci de préciser comment vous nous avez connu' }),
    commentConnuPrecision: z.string().trim().optional().default(''),
  })
  // Date de début/fin obligatoires uniquement si le candidat n'est pas disponible immédiatement
  .refine((valeurs) => valeurs.disponibiliteImmediate || valeurs.dateDebut !== '', {
    message: "La date de début est obligatoire si la disponibilité n'est pas immédiate",
    path: ['dateDebut'],
  })
  .refine((valeurs) => valeurs.disponibiliteImmediate || valeurs.dateFin !== '', {
    message: "La date de fin est obligatoire si la disponibilité n'est pas immédiate",
    path: ['dateFin'],
  })
  // Précision obligatoire uniquement si "Autre" est coché parmi les langues parlées
  .refine((valeurs) => !valeurs.languesParlees.includes('autre') || valeurs.autreLanguePrecision !== '', {
    message: 'Veuillez préciser la langue',
    path: ['autreLanguePrecision'],
  })
  // Au moins un poste bureau requis si le type de poste recherché est "Bureau"
  .refine((valeurs) => valeurs.typePoste !== 'bureau' || valeurs.posteBureau.length > 0, {
    message: 'Sélectionnez au moins un poste',
    path: ['posteBureau'],
  })
  // Précision obligatoire uniquement si "Autres" est coché parmi les postes bureau
  .refine((valeurs) => !valeurs.posteBureau.includes('autres') || valeurs.autrePosteBureauPrecision !== '', {
    message: 'Veuillez préciser le poste',
    path: ['autrePosteBureauPrecision'],
  })
  // Au moins un poste hôtel requis si le type de poste recherché est "Hôtel"
  .refine((valeurs) => valeurs.typePoste !== 'hotel' || valeurs.posteHotel.length > 0, {
    message: 'Sélectionnez au moins un poste',
    path: ['posteHotel'],
  })
  // Disponibilité samedi ET dimanche obligatoire pour l'hôtellerie (activité du week-end) —
  // n'ajoute pas ces jours automatiquement si le candidat change de "Hôtel" vers "Bureau" (voir
  // BlocDisponibilites.jsx, aucun reset sur joursDisponibles) : uniquement la validation qui se
  // relâche, les jours déjà cochés restent tels quels.
  .refine(
    (valeurs) =>
      valeurs.typePoste !== 'hotel' ||
      (valeurs.joursDisponibles.includes('samedi') && valeurs.joursDisponibles.includes('dimanche')),
    {
      message: 'Les postes en hôtellerie nécessitent une disponibilité le week-end (samedi et dimanche)',
      path: ['joursDisponibles'],
    },
  )
  // Précision obligatoire pour "Internet", "Autre" et "Cooptation" — les 3 options où le champ
  // "Précisez" est affiché (voir commentConnuPrecisionVisible, BlocDisponibilites.jsx)
  .refine(
    (valeurs) =>
      !['internet', 'autre', 'cooptation'].includes(valeurs.commentConnu) ||
      valeurs.commentConnuPrecision !== '',
    {
      message: 'Veuillez préciser',
      path: ['commentConnuPrecision'],
    },
  );
