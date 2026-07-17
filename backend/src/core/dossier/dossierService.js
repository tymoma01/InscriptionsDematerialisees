const { z } = require('zod');
const { obtenirKnex } = require('../../db/knex');
const { chiffrer } = require('../securite/nirCipher');
const dossierRepository = require('./dossierRepository');

const TELEPHONE_REGEX = /^0[1-9](\s?\d{2}){4}$/;
const NIR_REGEX = /^\d{13}\s?\d{2}$/;
const NOM_REGEX = /^[A-Za-zÀ-ÖØ-öø-ÿ' -]+$/;
const CRENEAUX = ['matin', 'midi', 'soir'];
const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const LANGUES = ['francais', 'anglais', 'autre'];

// Même contrat que les schémas front (BlocInfosPerso.schema.js / BlocCoordonnees.schema.js /
// BlocDisponibilites.schema.js), revalidé côté serveur — la validation front ne suffit jamais
// à sécuriser une écriture en base.
const donneesInscriptionSchema = z
  .object({
    nom: z.string().trim().min(1),
    // Facultatif : vide/absent accepté, mais lettres uniquement si renseigné
    nomNaissance: z
      .string()
      .trim()
      .nullish()
      .transform((valeur) => valeur ?? '')
      .refine((valeur) => valeur === '' || NOM_REGEX.test(valeur), {
        message: 'Le nom de naissance ne doit contenir que des lettres',
      }),
    lieuNaissance: z.string().trim().min(1),
    nationalite: z.string().trim().min(1).regex(NOM_REGEX),
    prenom: z.string().trim().min(1),
    dateNaissance: z.string().min(1),
    nir: z.string().trim().regex(NIR_REGEX),
    situationFamiliale: z.string().min(1),
    adresse: z.string().trim().min(1),
    telephone: z.string().trim().regex(TELEPHONE_REGEX),
    email: z.string().trim().email(),
    contactUrgenceNom: z.string().trim().min(1).regex(NOM_REGEX),
    contactUrgenceTelephone: z.string().trim().regex(TELEPHONE_REGEX),
    disponibiliteImmediate: z.boolean(),
    dateDebut: z.string().trim().optional().default(''),
    dateFin: z.string().trim().optional().default(''),
    creneaux: z.array(z.enum(CRENEAUX)).min(1),
    joursDisponibles: z.array(z.enum(JOURS)).min(1),
    languesParlees: z.array(z.enum(LANGUES)).default([]),
    autreLanguePrecision: z.string().trim().optional().default(''),
  })
  // Date de début/fin obligatoires uniquement si le candidat n'est pas disponible immédiatement
  .refine((donnees) => donnees.disponibiliteImmediate || donnees.dateDebut !== '', {
    message: "La date de début est obligatoire si la disponibilité n'est pas immédiate",
    path: ['dateDebut'],
  })
  .refine((donnees) => donnees.disponibiliteImmediate || donnees.dateFin !== '', {
    message: "La date de fin est obligatoire si la disponibilité n'est pas immédiate",
    path: ['dateFin'],
  })
  // Précision obligatoire uniquement si "Autre" est coché parmi les langues parlées
  .refine((donnees) => !donnees.languesParlees.includes('autre') || donnees.autreLanguePrecision !== '', {
    message: 'Veuillez préciser la langue',
    path: ['autreLanguePrecision'],
  });

// Assemble candidat (bloc infos_perso) + dossier + données du bloc coordonnées dans une
// seule transaction : soit tout est enregistré, soit rien ne l'est (pas de candidat orphelin
// sans dossier en cas d'échec à mi-parcours).
async function inscrireCandidat(entite, donneesBrutes) {
  const donnees = donneesInscriptionSchema.parse(donneesBrutes);
  const nirSansEspaces = donnees.nir.replace(/\s/g, '');
  const { nirChiffre, iv } = await chiffrer(nirSansEspaces);

  const bd = await obtenirKnex();
  return bd.transaction(async (trx) => {
    const candidatId = await dossierRepository.insererCandidat(trx, {
      entiteId: entite.id,
      nom: donnees.nom,
      nomNaissance: donnees.nomNaissance,
      lieuNaissance: donnees.lieuNaissance,
      nationalite: donnees.nationalite,
      prenom: donnees.prenom,
      dateNaissance: donnees.dateNaissance,
      situationFamiliale: donnees.situationFamiliale,
      nirChiffre,
      nirIv: iv,
    });

    const statutInitial = await dossierRepository.trouverStatutInitial(trx, entite.id);
    if (!statutInitial) {
      throw new Error(`Aucun statut initial configuré pour l'entité « ${entite.code} ».`);
    }

    const dossierId = await dossierRepository.creerDossier(trx, {
      candidatId,
      entiteId: entite.id,
      statutId: statutInitial.id,
    });

    await dossierRepository.enregistrerDonneesBloc(trx, {
      dossierId,
      blocCode: 'coordonnees',
      donnees: {
        adresse: donnees.adresse,
        telephone: donnees.telephone,
        email: donnees.email,
        contactUrgenceNom: donnees.contactUrgenceNom,
        contactUrgenceTelephone: donnees.contactUrgenceTelephone,
      },
    });

    await dossierRepository.enregistrerDonneesBloc(trx, {
      dossierId,
      blocCode: 'disponibilites',
      donnees: {
        disponibiliteImmediate: donnees.disponibiliteImmediate,
        dateDebut: donnees.dateDebut,
        dateFin: donnees.dateFin,
        creneaux: donnees.creneaux,
        joursDisponibles: donnees.joursDisponibles,
        languesParlees: donnees.languesParlees,
        autreLanguePrecision: donnees.autreLanguePrecision,
      },
    });

    return { candidatId, dossierId };
  });
}

module.exports = { inscrireCandidat };
