const { z } = require('zod');
const { obtenirKnex } = require('../../db/knex');
const { chiffrer, hasherNirPourUnicite } = require('../securite/nirCipher');
const dossierRepository = require('./dossierRepository');
const workflowRepository = require('../workflow/workflowRepository');
const { TYPES_POSTE, POSTES_BUREAU, POSTES_HOTEL } = require('./postesConstantes');

// Codes des contraintes UNIQUE posées par la migration 032_ajout_email_nir_hash_candidats —
// sert de filet de sécurité si deux inscriptions concurrentes passent toutes les deux la
// vérification préalable (trouverCandidatParNirHash/trouverCandidatParEmail ci-dessous) avant
// qu'aucune des deux n'ait encore inséré : la contrainte DB reste alors la seule à even
// détecter le doublon, et son erreur brute Postgres est traduite ici en message clair plutôt
// que de remonter telle quelle jusqu'au gestionnaire d'erreurs générique (500 opaque).
const CONTRAINTE_UNIQUE_EMAIL = 'candidats_entite_id_email_unique';
const CONTRAINTE_UNIQUE_NIR_HASH = 'candidats_entite_id_nir_hash_unique';

// Erreur métier distincte de z.ZodError (données mal formées) : signale une donnée valide mais
// déjà utilisée par un autre dossier — candidats.routes.js la traduit en 409 (Conflict) plutôt
// que 400, avec un message directement affichable au candidat.
class ErreurInscriptionConflit extends Error {
  constructor(message, champ) {
    super(message);
    this.name = 'ErreurInscriptionConflit';
    this.champ = champ; // 'nir' | 'email'
  }
}

const TELEPHONE_REGEX = /^0[1-9](\s?\d{2}){4}$/;
const NIR_REGEX = /^\d{13}\s?\d{2}$/;
const NOM_REGEX = /^[A-Za-zÀ-ÖØ-öø-ÿ' -]+$/;
const CODE_POSTAL_REGEX = /^\d{5}$/;
// Deux vocabulaires de créneaux distincts selon le type de poste — même contrat que
// BlocDisponibilites.schema.js (CRENEAUX_HOTEL/CRENEAUX_BUREAU) côté front, revalidé ici.
const CRENEAUX_HOTEL = ['matin', 'midi', 'soir'];
const CRENEAUX_BUREAU = ['6h-9h', '9h-18h', '18h-21h'];
const CRENEAUX = [...CRENEAUX_HOTEL, ...CRENEAUX_BUREAU];
const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const LANGUES = ['francais', 'anglais', 'autre'];
const COMMENT_CONNU = ['bouche_a_oreille', 'internet', 'cooptation', 'autre'];
const OUI_NON = ['oui', 'non'];
const CHOIX_DIFFUSION = ['autorise', 'refuse'];
const MENTION_CHARTE_ATTENDUE = 'lu et approuvé'.normalize('NFC');

// Même contrat que les schémas front (BlocInfosPerso.schema.js / BlocCoordonnees.schema.js /
// BlocDisponibilites.schema.js), revalidé côté serveur — la validation front ne suffit jamais
// à sécuriser une écriture en base.
const donneesInscriptionSchema = z
  .object({
    civilite: z.enum(['monsieur', 'madame']),
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
    codePostal: z.string().trim().regex(CODE_POSTAL_REGEX),
    ville: z.string().trim().min(1).regex(NOM_REGEX),
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
    typePoste: z.enum(TYPES_POSTE),
    posteBureau: z.array(z.enum(POSTES_BUREAU)).default([]),
    posteHotel: z.array(z.enum(POSTES_HOTEL)).default([]),
    commentConnu: z.enum(COMMENT_CONNU),
    commentConnuPrecision: z.string().trim().optional().default(''),
    cas1CmuC: z.enum(OUI_NON),
    cas2Acs: z.enum(OUI_NON),
    cas3MutuelleIndividuelle: z.enum(OUI_NON),
    cas4MutuelleCollective: z.enum(OUI_NON),
    certificationAucuneDispense: z.boolean().default(false),
    consentementDiffusion: z.enum(CHOIX_DIFFUSION),
    signatureImage: z.string().optional().default(''),
    charteMention: z.string().trim(),
    charteSignatureImage: z.string().min(1, 'La signature électronique est obligatoire'),
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
  })
  // Au moins un poste bureau requis si le type de poste recherché est "Bureau"
  .refine((donnees) => donnees.typePoste !== 'bureau' || donnees.posteBureau.length > 0, {
    message: 'Sélectionnez au moins un poste',
    path: ['posteBureau'],
  })
  // Au moins un poste hôtel requis si le type de poste recherché est "Hôtel"
  .refine((donnees) => donnees.typePoste !== 'hotel' || donnees.posteHotel.length > 0, {
    message: 'Sélectionnez au moins un poste',
    path: ['posteHotel'],
  })
  // Disponibilité samedi ET dimanche obligatoire pour l'hôtellerie (activité du week-end) — même
  // règle que BlocDisponibilites.schema.js côté front, revalidée ici : la validation front ne
  // suffit jamais à sécuriser une écriture en base.
  .refine(
    (donnees) => donnees.typePoste !== 'hotel' || (donnees.joursDisponibles.includes('samedi') && donnees.joursDisponibles.includes('dimanche')),
    {
      message: 'Les postes en hôtellerie nécessitent une disponibilité le week-end (samedi et dimanche)',
      path: ['joursDisponibles'],
    },
  )
  // Les créneaux soumis doivent appartenir au vocabulaire du type de poste (voir
  // CRENEAUX_HOTEL/CRENEAUX_BUREAU ci-dessus) — même garde défensive que le front
  // (BlocDisponibilites.schema.js) contre un payload manipulé.
  .refine(
    (donnees) => {
      const codesAutorises = donnees.typePoste === 'bureau' ? CRENEAUX_BUREAU : CRENEAUX_HOTEL;
      return donnees.creneaux.every((code) => codesAutorises.includes(code));
    },
    { message: 'Créneaux invalides pour le type de poste sélectionné', path: ['creneaux'] },
  )
  // Côté bureau, "9h-18h" ne peut jamais être coché seul : au moins "6h-9h" ou "18h-21h" est
  // obligatoire — même règle que BlocDisponibilites.schema.js côté front, revalidée ici.
  .refine(
    (donnees) =>
      donnees.typePoste !== 'bureau' || donnees.creneaux.includes('6h-9h') || donnees.creneaux.includes('18h-21h'),
    {
      message: 'Sélectionnez au moins un créneau 6h-9h ou 18h-21h (9h-18h seul ne suffit pas)',
      path: ['creneaux'],
    },
  )
  // Précision obligatoire uniquement si "Internet" ou "Autre" est sélectionné
  .refine(
    (donnees) => !['internet', 'autre'].includes(donnees.commentConnu) || donnees.commentConnuPrecision !== '',
    {
      message: 'Veuillez préciser',
      path: ['commentConnuPrecision'],
    },
  )
  // La certification n'est possible que si les 4 cas de dispense sont tous à "Non"
  .refine(
    (donnees) =>
      !donnees.certificationAucuneDispense ||
      [donnees.cas1CmuC, donnees.cas2Acs, donnees.cas3MutuelleIndividuelle, donnees.cas4MutuelleCollective].every(
        (cas) => cas === 'non',
      ),
    {
      message: "La certification n'est possible que si les 4 cas de dispense sont à « Non »",
      path: ['certificationAucuneDispense'],
    },
  )
  // La signature n'est demandée/obligatoire que si le candidat autorise la diffusion
  .refine((donnees) => donnees.consentementDiffusion !== 'autorise' || donnees.signatureImage !== '', {
    message: 'La signature électronique est obligatoire',
    path: ['signatureImage'],
  })
  // La mention recopiée doit correspondre exactement à « Lu et Approuvé » (insensible à la
  // casse et aux espaces superflus). `.normalize('NFC')` évite qu'un accent saisi sous sa
  // forme décomposée (clavier tactile/IME) ne soit à tort traité comme une faute de frappe —
  // même correctif que BlocCharte.schema.js côté front.
  .refine((donnees) => donnees.charteMention.normalize('NFC').toLowerCase() === MENTION_CHARTE_ATTENDUE, {
    message: 'Merci de recopier exactement la mention « Lu et Approuvé »',
    path: ['charteMention'],
  });

// Assemble candidat (bloc infos_perso) + dossier + données du bloc coordonnées dans une
// seule transaction : soit tout est enregistré, soit rien ne l'est (pas de candidat orphelin
// sans dossier en cas d'échec à mi-parcours).
async function inscrireCandidat(entite, donneesBrutes) {
  const donnees = donneesInscriptionSchema.parse(donneesBrutes);
  const nirSansEspaces = donnees.nir.replace(/\s/g, '');
  const { nirChiffre, iv } = await chiffrer(nirSansEspaces);
  // Hash déterministe (HMAC-SHA256) distinct du chiffrement AES-256-GCM ci-dessus : seul lui
  // permet une recherche d'unicité par égalité (voir core/securite/nirCipher.js) — jamais
  // stocké ni comparé en clair.
  const nirHash = await hasherNirPourUnicite(nirSansEspaces);

  const bd = await obtenirKnex();
  return bd.transaction(async (trx) => {
    // Vérification préalable (message clair, cas normal) — la contrainte UNIQUE en base reste
    // le filet de sécurité contre une course entre deux inscriptions concurrentes (voir plus bas).
    const candidatNirExistant = await dossierRepository.trouverCandidatParNirHash(trx, entite.id, nirHash);
    if (candidatNirExistant) {
      throw new ErreurInscriptionConflit(
        'Ce numéro de sécurité sociale est déjà utilisé par un autre dossier.',
        'nir',
      );
    }

    const candidatEmailExistant = await dossierRepository.trouverCandidatParEmail(trx, entite.id, donnees.email);
    if (candidatEmailExistant) {
      throw new ErreurInscriptionConflit('Cet email est déjà utilisé par un autre dossier.', 'email');
    }

    let candidatId;
    try {
      candidatId = await dossierRepository.insererCandidat(trx, {
        entiteId: entite.id,
        civilite: donnees.civilite,
        nom: donnees.nom,
        nomNaissance: donnees.nomNaissance,
        lieuNaissance: donnees.lieuNaissance,
        nationalite: donnees.nationalite,
        prenom: donnees.prenom,
        dateNaissance: donnees.dateNaissance,
        situationFamiliale: donnees.situationFamiliale,
        nirChiffre,
        nirIv: iv,
        nirHash,
        email: donnees.email,
      });
    } catch (erreurInsertion) {
      // code 23505 = violation de contrainte UNIQUE Postgres — n'arrive ici qu'en cas de course
      // entre deux inscriptions concurrentes passées toutes les deux la vérification ci-dessus
      // avant qu'aucune n'ait encore inséré.
      if (erreurInsertion.code === '23505' && erreurInsertion.constraint === CONTRAINTE_UNIQUE_NIR_HASH) {
        throw new ErreurInscriptionConflit(
          'Ce numéro de sécurité sociale est déjà utilisé par un autre dossier.',
          'nir',
        );
      }
      if (erreurInsertion.code === '23505' && erreurInsertion.constraint === CONTRAINTE_UNIQUE_EMAIL) {
        throw new ErreurInscriptionConflit('Cet email est déjà utilisé par un autre dossier.', 'email');
      }
      throw erreurInsertion;
    }

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
        codePostal: donnees.codePostal,
        ville: donnees.ville,
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
        typePoste: donnees.typePoste,
        posteBureau: donnees.posteBureau,
        posteHotel: donnees.posteHotel,
        commentConnu: donnees.commentConnu,
        commentConnuPrecision: donnees.commentConnuPrecision,
      },
    });

    await dossierRepository.enregistrerDonneesBloc(trx, {
      dossierId,
      blocCode: 'mutuelle',
      donnees: {
        cas1CmuC: donnees.cas1CmuC,
        cas2Acs: donnees.cas2Acs,
        cas3MutuelleIndividuelle: donnees.cas3MutuelleIndividuelle,
        cas4MutuelleCollective: donnees.cas4MutuelleCollective,
        certificationAucuneDispense: donnees.certificationAucuneDispense,
      },
    });

    // L'horodatage de la signature est celui du serveur au moment de l'enregistrement — jamais
    // un timestamp envoyé par le client (même principe que les signatures de charte, voir
    // architecture-technique.md §1.7).
    await dossierRepository.enregistrerDonneesBloc(trx, {
      dossierId,
      blocCode: 'consentement_rgpd',
      donnees: {
        consentementDiffusion: donnees.consentementDiffusion,
        signatureImage: donnees.consentementDiffusion === 'autorise' ? donnees.signatureImage : null,
        dateSignature: donnees.consentementDiffusion === 'autorise' ? new Date().toISOString() : null,
      },
    });

    // Signature de la charte : stockée dans chartes/signatures_charte, pas dans
    // dossier_donnees_formulaire — ce n'est pas une donnée de bloc générique mais une preuve
    // légale liée à une version précise de la charte (voir CLAUDE.md, section signature
    // électronique). La mention recopiée n'est pas persistée : ce n'est qu'une confirmation de
    // lecture (gate), la preuve légale repose sur le tracé et le lien vers la charte signée.
    const charteActive = await dossierRepository.trouverCharteActive(trx, entite.id);
    if (!charteActive) {
      throw new Error(`Aucune charte active configurée pour l'entité « ${entite.code} ».`);
    }

    const charteSignatureBuffer = Buffer.from(
      donnees.charteSignatureImage.replace(/^data:image\/\w+;base64,/, ''),
      'base64',
    );

    await dossierRepository.enregistrerSignatureCharte(trx, {
      candidatId,
      charteId: charteActive.id,
      signatureImage: charteSignatureBuffer,
    });

    // Fin des étapes du formulaire : SI l'entité configure une transition 'inscription_soumise'
    // depuis le statut initial (transitions_statut), le dossier avance automatiquement — sinon
    // (workflow v5 ACCECIT, audit 2026-08-21) il reste au statut initial ("Inscrit"/nouveau),
    // volontairement observable désormais, jusqu'à ce qu'un agent capture la première pièce
    // justificative (voir pieceJustificativeService.uploaderPieceJustificative, codeAction
    // premiere_piece_chargee). Recherche générique via workflowRepository — CE fichier ne doit
    // connaître ni "en_attente_pieces" ni aucun autre code de statut en dur (Modularité, CLAUDE.md) :
    // le comportement varie déjà par entité PUREMENT via la présence ou l'absence de cette ligne de
    // configuration (voir workflow.config.json d'Adaptel, qui la garde telle quelle — comportement
    // inchangé pour cette entité). Aucun agent n'est connecté à cette étape (le candidat saisit
    // lui-même, voir candidats.routes.js) : l'acteur tracé dans historique_statuts, quand la
    // transition existe, est l'utilisateur système de l'entité, pas un choix arbitraire, pour que
    // la traçabilité RGPD reste exacte.
    const transitionInscriptionSoumise = await workflowRepository.trouverTransition(
      trx,
      entite.id,
      statutInitial.id,
      'inscription_soumise',
    );
    if (transitionInscriptionSoumise) {
      const utilisateurSysteme = await dossierRepository.trouverUtilisateurSysteme(trx, entite.id);
      if (!utilisateurSysteme) {
        throw new Error(`Utilisateur système non configuré pour l'entité « ${entite.code} ».`);
      }
      await dossierRepository.enregistrerChangementStatut(trx, {
        dossierId,
        statutId: transitionInscriptionSoumise.statut_destination_id,
        utilisateurId: utilisateurSysteme.id,
        commentaire: 'Inscription soumise par le candidat — passage automatique en attente de pièces justificatives.',
      });
    }

    return { candidatId, dossierId };
  });
}

// Vérification ponctuelle d'unicité (NIR ou email), appelée au blur du champ concerné avant la
// soumission finale (voir candidats.routes.js POST /disponibilite) — même logique de recherche
// que les vérifications préalables d'inscrireCandidat ci-dessus, mais sans écriture et sans
// jamais exposer au front autre chose qu'un booléen (ne pas révéler l'identité du dossier en
// conflit, voir CLAUDE.md/RGPD). Une valeur qui ne respecte pas encore le format attendu n'est
// pas considérée en conflit : la validation de format reste du ressort des schémas front/zod.
async function verifierDisponibilite(entite, champ, valeurBrute) {
  const bd = await obtenirKnex();

  if (champ === 'nir') {
    if (!NIR_REGEX.test(valeurBrute.trim())) {
      return true;
    }
    const nirHash = await hasherNirPourUnicite(valeurBrute.replace(/\s/g, ''));
    const candidatExistant = await dossierRepository.trouverCandidatParNirHash(bd, entite.id, nirHash);
    return !candidatExistant;
  }

  const email = valeurBrute.trim();
  if (!z.string().email().safeParse(email).success) {
    return true;
  }
  const candidatExistant = await dossierRepository.trouverCandidatParEmail(bd, entite.id, email);
  return !candidatExistant;
}

// Postes recherchés exposés à plat (postesBureau/postesHotel) pour la colonne "Poste" des
// tableaux de bord — même patron que evaluationEngine.listerRendezvousAEvaluer, qui fait la même
// extraction depuis le même bloc 'disponibilites' (voir dossierRepository.listerDossiers).
//
// candidat_telephone/candidat_email extraits du bloc 'coordonnees' au même titre, pour les
// colonnes "Téléphone"/"Email" du tableau de bord (voir DossierList.jsx) — null si le bloc n'a
// pas encore été rempli (dossier tout juste créé).
async function listerDossiers(entite, { statutCode } = {}) {
  const bd = await obtenirKnex();
  const dossiers = await dossierRepository.listerDossiers(bd, entite.id, { statutCode });
  return dossiers.map(({ donnees_disponibilites, donnees_coordonnees, ...reste }) => ({
    ...reste,
    postesBureau: donnees_disponibilites?.posteBureau ?? [],
    postesHotel: donnees_disponibilites?.posteHotel ?? [],
    candidat_telephone: donnees_coordonnees?.telephone ?? null,
    candidat_email: donnees_coordonnees?.email ?? null,
  }));
}

// Un seul dossier, avec statut et nom/prénom du candidat déjà joints (voir
// trouverDossierAvecStatutParId) — sert par exemple à afficher le nom du candidat en en-tête de
// l'écran de capture de pièces (CaptureTablette.jsx), sans dupliquer une requête candidats à
// part. undefined si le dossier n'existe pas pour cette entité (même filtre IDOR que le reste de
// ce module) : à la route d'appel de traduire ça en 404.
//
// postesBureau/postesHotel extraits ici, même patron que listerDossiers ci-dessus — sert à
// VerificationPieces.jsx pour transmettre les postes déclarés du dossier à la sélection de
// poste(s) testé(s) de ModalePlanificationTest.jsx (via CaptureTablette.jsx).
async function obtenirDossier(entite, dossierId) {
  const bd = await obtenirKnex();
  const dossier = await dossierRepository.trouverDossierAvecStatutParId(bd, entite.id, dossierId);
  if (!dossier) return dossier;
  const { donnees_disponibilites, ...reste } = dossier;
  return {
    ...reste,
    postesBureau: donnees_disponibilites?.posteBureau ?? [],
    postesHotel: donnees_disponibilites?.posteHotel ?? [],
  };
}

async function listerStatuts(entite) {
  const bd = await obtenirKnex();
  return dossierRepository.listerStatuts(bd, entite.id);
}

// Section repliable "Informations d'inscription complètes" de la fiche dossier (Validation.jsx/
// Relances.jsx) — undefined si le dossier n'existe pas pour cette entité, à la route d'appel de
// traduire ça en 404 (même contrat que obtenirDossier ci-dessus).
async function obtenirInscriptionComplete(entite, dossierId) {
  const bd = await obtenirKnex();
  return dossierRepository.trouverInscriptionCompleteParDossierId(bd, entite.id, dossierId);
}

// Schéma du bouton "Modifier" (InformationsInscription.jsx, correction d'une erreur de saisie de
// l'accueil/de l'admin après coup) — SOUS-ENSEMBLE volontairement dupliqué de
// donneesInscriptionSchema plutôt que factorisé avec lui (voir CLAUDE.md, conventions du projet :
// duplication déjà la norme ailleurs dans ce fichier/ces pages plutôt qu'une abstraction
// partagée) : donneesInscriptionSchema est un chemin sensible (chiffrement NIR, signature légale
// de charte, consentement RGPD horodaté) qu'on préfère ne jamais toucher pour les besoins d'un
// écran d'édition annexe — un refactor commun aurait fait courir un risque de régression sur
// l'inscription elle-même pour un gain de lisibilité marginal ici.
//
// Volontairement ABSENTS (donc jamais modifiables par cette voie) :
// - nir : jamais exposé après inscription (CLAUDE.md, Contraintes RGPD — déchiffrement serveur
//   réservé aux usages qui en ont explicitement besoin, la correction d'état civil n'en fait pas
//   partie) ; une erreur de NIR nécessite une procédure à part, hors périmètre de ce bouton.
// - consentementDiffusion/signatureImage/charteMention/charteSignatureImage : preuve légale
//   horodatée au moment de l'inscription (voir enregistrerSignatureCharte) — un bouton "Modifier"
//   générique ne doit jamais pouvoir la réécrire après coup.
// Mêmes règles de validation (formats + contraintes croisées) que donneesInscriptionSchema sur
// les champs qu'elle couvre bel et bien, revalidées ici à l'identique.
const modificationInscriptionSchema = z
  .object({
    civilite: z.enum(['monsieur', 'madame']),
    nom: z.string().trim().min(1),
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
    situationFamiliale: z.string().min(1),
    adresse: z.string().trim().min(1),
    codePostal: z.string().trim().regex(CODE_POSTAL_REGEX),
    ville: z.string().trim().min(1).regex(NOM_REGEX),
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
    typePoste: z.enum(TYPES_POSTE),
    posteBureau: z.array(z.enum(POSTES_BUREAU)).default([]),
    posteHotel: z.array(z.enum(POSTES_HOTEL)).default([]),
    commentConnu: z.enum(COMMENT_CONNU),
    commentConnuPrecision: z.string().trim().optional().default(''),
    cas1CmuC: z.enum(OUI_NON),
    cas2Acs: z.enum(OUI_NON),
    cas3MutuelleIndividuelle: z.enum(OUI_NON),
    cas4MutuelleCollective: z.enum(OUI_NON),
    certificationAucuneDispense: z.boolean().default(false),
  })
  .refine((donnees) => donnees.disponibiliteImmediate || donnees.dateDebut !== '', {
    message: "La date de début est obligatoire si la disponibilité n'est pas immédiate",
    path: ['dateDebut'],
  })
  .refine((donnees) => donnees.disponibiliteImmediate || donnees.dateFin !== '', {
    message: "La date de fin est obligatoire si la disponibilité n'est pas immédiate",
    path: ['dateFin'],
  })
  .refine((donnees) => !donnees.languesParlees.includes('autre') || donnees.autreLanguePrecision !== '', {
    message: 'Veuillez préciser la langue',
    path: ['autreLanguePrecision'],
  })
  .refine((donnees) => donnees.typePoste !== 'bureau' || donnees.posteBureau.length > 0, {
    message: 'Sélectionnez au moins un poste',
    path: ['posteBureau'],
  })
  .refine((donnees) => donnees.typePoste !== 'hotel' || donnees.posteHotel.length > 0, {
    message: 'Sélectionnez au moins un poste',
    path: ['posteHotel'],
  })
  .refine(
    (donnees) => donnees.typePoste !== 'hotel' || (donnees.joursDisponibles.includes('samedi') && donnees.joursDisponibles.includes('dimanche')),
    {
      message: 'Les postes en hôtellerie nécessitent une disponibilité le week-end (samedi et dimanche)',
      path: ['joursDisponibles'],
    },
  )
  .refine(
    (donnees) => {
      const codesAutorises = donnees.typePoste === 'bureau' ? CRENEAUX_BUREAU : CRENEAUX_HOTEL;
      return donnees.creneaux.every((code) => codesAutorises.includes(code));
    },
    { message: 'Créneaux invalides pour le type de poste sélectionné', path: ['creneaux'] },
  )
  .refine(
    (donnees) =>
      donnees.typePoste !== 'bureau' || donnees.creneaux.includes('6h-9h') || donnees.creneaux.includes('18h-21h'),
    {
      message: 'Sélectionnez au moins un créneau 6h-9h ou 18h-21h (9h-18h seul ne suffit pas)',
      path: ['creneaux'],
    },
  )
  .refine(
    (donnees) => !['internet', 'autre'].includes(donnees.commentConnu) || donnees.commentConnuPrecision !== '',
    {
      message: 'Veuillez préciser',
      path: ['commentConnuPrecision'],
    },
  )
  .refine(
    (donnees) =>
      !donnees.certificationAucuneDispense ||
      [donnees.cas1CmuC, donnees.cas2Acs, donnees.cas3MutuelleIndividuelle, donnees.cas4MutuelleCollective].every(
        (cas) => cas === 'non',
      ),
    {
      message: "La certification n'est possible que si les 4 cas de dispense sont à « Non »",
      path: ['certificationAucuneDispense'],
    },
  );

// Bouton "Modifier" de la section "Informations d'inscription complètes" (InformationsInscription.jsx)
// — corrige une erreur de saisie du candidat à l'inscription, jamais utilisé par le candidat
// lui-même (voir dossiers.routes.js pour la restriction RBAC : Accueil/Coordination + Admin
// uniquement). dossierId résolu -> candidat_id avant toute écriture, même filtre IDOR que le
// reste de ce module (trouverDossierParId, scopé entite.id) : un dossierId d'une autre entité
// renvoie undefined plutôt que de laisser fuiter/écraser les données d'un candidat qui n'est pas
// le sien.
async function modifierInscription(entite, dossierId, donneesBrutes) {
  const donnees = modificationInscriptionSchema.parse(donneesBrutes);

  const bd = await obtenirKnex();
  return bd.transaction(async (trx) => {
    const dossier = await dossierRepository.trouverDossierParId(trx, entite.id, dossierId);
    if (!dossier) return undefined;

    // Email potentiellement modifié : même contrôle d'unicité qu'à l'inscription (voir
    // inscrireCandidat ci-dessus), mais EXCLUANT le candidat courant — conserver son propre email
    // inchangé ne doit jamais se lire comme un conflit avec lui-même.
    const candidatEmailExistant = await dossierRepository.trouverCandidatParEmail(trx, entite.id, donnees.email);
    if (candidatEmailExistant && candidatEmailExistant.id !== dossier.candidat_id) {
      throw new ErreurInscriptionConflit('Cet email est déjà utilisé par un autre dossier.', 'email');
    }

    await dossierRepository.mettreAJourCandidat(trx, dossier.candidat_id, {
      civilite: donnees.civilite,
      nom: donnees.nom,
      nomNaissance: donnees.nomNaissance,
      lieuNaissance: donnees.lieuNaissance,
      nationalite: donnees.nationalite,
      prenom: donnees.prenom,
      dateNaissance: donnees.dateNaissance,
      situationFamiliale: donnees.situationFamiliale,
      email: donnees.email,
    });

    await dossierRepository.mettreAJourDonneesBloc(trx, {
      dossierId,
      blocCode: 'coordonnees',
      donnees: {
        adresse: donnees.adresse,
        codePostal: donnees.codePostal,
        ville: donnees.ville,
        telephone: donnees.telephone,
        email: donnees.email,
        contactUrgenceNom: donnees.contactUrgenceNom,
        contactUrgenceTelephone: donnees.contactUrgenceTelephone,
      },
    });

    await dossierRepository.mettreAJourDonneesBloc(trx, {
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
        typePoste: donnees.typePoste,
        posteBureau: donnees.posteBureau,
        posteHotel: donnees.posteHotel,
        commentConnu: donnees.commentConnu,
        commentConnuPrecision: donnees.commentConnuPrecision,
      },
    });

    await dossierRepository.mettreAJourDonneesBloc(trx, {
      dossierId,
      blocCode: 'mutuelle',
      donnees: {
        cas1CmuC: donnees.cas1CmuC,
        cas2Acs: donnees.cas2Acs,
        cas3MutuelleIndividuelle: donnees.cas3MutuelleIndividuelle,
        cas4MutuelleCollective: donnees.cas4MutuelleCollective,
        certificationAucuneDispense: donnees.certificationAucuneDispense,
      },
    });

    return dossierRepository.trouverInscriptionCompleteParDossierId(trx, entite.id, dossierId);
  });
}

module.exports = {
  inscrireCandidat,
  verifierDisponibilite,
  listerDossiers,
  listerStatuts,
  obtenirDossier,
  obtenirInscriptionComplete,
  modifierInscription,
  ErreurInscriptionConflit,
};
