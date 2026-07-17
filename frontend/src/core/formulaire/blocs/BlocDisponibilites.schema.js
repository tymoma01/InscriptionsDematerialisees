import { z } from 'zod';

const CRENEAUX = ['matin', 'midi', 'soir'];
const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const LANGUES = ['francais', 'anglais', 'autre'];

export const blocDisponibilitesSchema = z
  .object({
    disponibiliteImmediate: z.boolean(),
    dateDebut: z.string().trim().optional().default(''),
    dateFin: z.string().trim().optional().default(''),
    creneaux: z.array(z.enum(CRENEAUX)).min(1, 'Sélectionnez au moins un créneau souhaité'),
    joursDisponibles: z.array(z.enum(JOURS)).min(1, 'Sélectionnez au moins un jour disponible'),
    languesParlees: z.array(z.enum(LANGUES)).default([]),
    autreLanguePrecision: z.string().trim().optional().default(''),
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
  });
