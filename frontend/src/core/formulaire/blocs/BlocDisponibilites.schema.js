import { z } from 'zod';

// Deux vocabulaires de créneaux distincts selon le type de poste (hôtel : services classiques du
// secteur ; bureau : plages horaires de nettoyage/entretien) — un seul des deux sous-blocs
// affiché à la fois côté BlocDisponibilites.jsx, jamais les deux ensemble. `creneaux` reste un
// champ unique (pas creneauxHotel/creneauxBureau séparés) : voir le .refine ci-dessous, qui
// interdit un code du mauvais vocabulaire pour le typePoste choisi — la validation porte donc
// aussi bien sur "au moins un créneau" que sur "dans le bon référentiel".
const CRENEAUX_HOTEL = ['matin', 'midi', 'soir'];
const CRENEAUX_BUREAU = ['6h-9h', '9h-18h', '18h-21h'];
const CRENEAUX = [...CRENEAUX_HOTEL, ...CRENEAUX_BUREAU];
const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const LANGUES = ['francais', 'anglais', 'autre'];
const TYPES_POSTE = ['bureau', 'hotel'];
const POSTES_BUREAU = ['nettoyage', 'vitrerie', 'machiniste', 'chef_equipe', 'autres'];
const POSTES_HOTEL = ['femme_valet_chambre', 'cafetier', 'equipier', 'gouvernant'];
const COMMENT_CONNU = ['bouche_a_oreille', 'internet', 'cooptation', 'autre'];
// Bloc "Expérience" (ajout 2026-09-02) — choix unique, 'aucune' est la seule option qui ne
// déclenche pas les deux champs de précision (Lieu/Missions), voir le .refine dédié plus bas et
// experienceChampsVisibles côté BlocDisponibilites.jsx.
const EXPERIENCE = ['aucune', 'plus_6_mois', 'plus_2_ans', 'plus_5_ans'];

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
    experience: z.enum(EXPERIENCE, { required_error: "L'expérience est obligatoire" }),
    experienceLieu: z.string().trim().optional().default(''),
    experienceMissions: z.string().trim().optional().default(''),
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
  // Les créneaux cochés doivent appartenir au vocabulaire du type de poste actuellement
  // sélectionné (voir CRENEAUX_HOTEL/CRENEAUX_BUREAU ci-dessus) — ne devrait normalement jamais
  // se déclencher via l'UI (BlocDisponibilites.jsx vide `creneaux` dès que le candidat change de
  // poste, et n'expose que les cases du bon sous-bloc), garde défensive contre un payload
  // manipulé plutôt qu'un cas d'usage normal, d'où l'absence de message affiché dédié (même
  // logique que les autres .refine() de ce fichier, dont le message ne remonte pas dans `errors`
  // ici — voir BlocDisponibilites.jsx).
  .refine(
    (valeurs) => {
      const codesAutorises = valeurs.typePoste === 'bureau' ? CRENEAUX_BUREAU : CRENEAUX_HOTEL;
      return valeurs.creneaux.every((code) => codesAutorises.includes(code));
    },
    { message: 'Créneaux invalides pour le type de poste sélectionné', path: ['creneaux'] },
  )
  // Côté bureau, "9h-18h" ne peut jamais être coché seul : au moins "6h-9h" ou "18h-21h" est
  // obligatoire (couvre aussi le cas rien-coché-du-tout, déjà bloqué par le .min(1) ci-dessus,
  // mais avec son propre message plus précis affiché quand ce .min(1) est déjà satisfait — voir
  // erreurCreneauxBureau, BlocDisponibilites.jsx).
  .refine(
    (valeurs) =>
      valeurs.typePoste !== 'bureau' || valeurs.creneaux.includes('6h-9h') || valeurs.creneaux.includes('18h-21h'),
    {
      message: 'Sélectionnez au moins un créneau 6h-9h ou 18h-21h (9h-18h seul ne suffit pas)',
      path: ['creneaux'],
    },
  )
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
  // Lieu/Missions obligatoires dès que "Expérience" vaut autre chose que "Pas d'expérience"
  // ('aucune') — les deux champs de précision affichés par experienceChampsVisibles,
  // BlocDisponibilites.jsx.
  .refine((valeurs) => valeurs.experience === 'aucune' || valeurs.experienceLieu !== '', {
    message: 'Veuillez préciser le lieu de cette expérience',
    path: ['experienceLieu'],
  })
  .refine((valeurs) => valeurs.experience === 'aucune' || valeurs.experienceMissions !== '', {
    message: 'Veuillez préciser la ou les mission(s) effectuée(s)',
    path: ['experienceMissions'],
  })
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
