// Correction de disponibilité "Validé - prêt à l'embauche" — jamais la
// déclaration d'origine du candidat (bloc 'disponibilites' de dossier_donnees_formulaire, JSONB),
// qui reste inchangée : voir disponibiliteEmbaucheRepository.js/migration 065.
const { z } = require('zod');
const db = require('../../db/knex');
const dossierRepository = require('./dossierRepository');
const disponibiliteEmbaucheRepository = require('./disponibiliteEmbaucheRepository');
const journalAudit = require('../audit/journalAudit');

const REGEX_DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;
// Comparaison lexicographique valide sur des dates AAAA-MM-JJ (même ordre que l'ordre
// chronologique réel) — pas de conversion Date() nécessaire pour ce seul .refine.
const STATUT_CIBLE = 'valide_pret_embauche';
const ACTION_JOURNAL_AUDIT = 'disponibilite_embauche_corrigee';

// Date de fin facultative (comme la déclaration d'origine, voir BlocDisponibilites.schema.js) —
// contrairement à elle, la date de DÉBUT est ICI toujours obligatoire (jamais de notion
// "immédiate" pour une correction, voir dossierService.calculerDisponibiliteEffective) : demande
// utilisateur explicite, la fenêtre de correction préremplit simplement ce champ avec la date du
// jour côté front quand la déclaration d'origine était immédiate, mais la valeur ENVOYÉE reste
// toujours une date concrète.
const schemaCorrection = z
  .object({
    dateDebut: z
      .string()
      .trim()
      .regex(REGEX_DATE_ISO, 'La date de début est obligatoire (AAAA-MM-JJ).'),
    // `.nullable()` en plus de `.optional()` (bug 2026-09-28) : le front envoie explicitement
    // `dateFin: null` en JSON quand le champ est laissé vide (voir ModaleDisponibiliteEmbauche.jsx),
    // jamais un simple champ absent — or `.optional()` seul n'accepte que `undefined`, pas `null`
    // (distinction Zod classique), ce qui faisait échouer .parse() avec un ZodError sur un cas
    // pourtant parfaitement valide ("pas de date de fin"). Les trois formes (absente, null, chaîne
    // vide) sont désormais acceptées et normalisées en `null`.
    dateFin: z
      .string()
      .trim()
      .nullable()
      .optional()
      .transform((valeur) => (valeur ? valeur : null))
      .refine((valeur) => valeur === null || REGEX_DATE_ISO.test(valeur), {
        message: 'Date de fin invalide (AAAA-MM-JJ).',
      }),
    commentaire: z.string().trim().min(1, 'Un commentaire est obligatoire.'),
  })
  // Contrôle SERVEUR (demande utilisateur explicite, en plus du contrôle interface) : jamais de
  // confiance dans la seule validation front pour une règle métier qui touche à l'intégrité de la
  // donnée stockée.
  .refine((valeurs) => valeurs.dateFin === null || valeurs.dateFin >= valeurs.dateDebut, {
    message: 'La date de fin ne peut pas être antérieure à la date de début.',
    path: ['dateFin'],
  });

// Même patron que ErreurTransitionInvalide (workflowEngine.js)/ErreurPieceJustificativeInvalide :
// erreur métier distincte d'une Error générique, traduite en 400 par la route plutôt que de
// tomber dans le gestionnaire d'erreurs générique.
class ErreurDisponibiliteEmbaucheInvalide extends Error {
  constructor(message) {
    super(message);
    this.name = 'ErreurDisponibiliteEmbaucheInvalide';
  }
}

// "Ancienne" période (pour la trace journal_audit, point B4 "ancienne et nouvelle période") : la
// dernière correction si elle existe, sinon la déclaration d'origine — EXACTEMENT le même calcul
// que dossierService.calculerDisponibiliteEffective (dupliqué ici plutôt que réutilisé, voir
// CLAUDE.md conventions du projet : ce module n'a par ailleurs aucune dépendance vers
// dossierService).
function calculerPeriodeAvant(donneesDeclarees, derniereCorrection) {
  if (derniereCorrection) {
    return { dateDebut: derniereCorrection.date_debut, dateFin: derniereCorrection.date_fin ?? null };
  }
  return {
    dateDebut: donneesDeclarees?.disponibiliteImmediate ? null : donneesDeclarees?.dateDebut || null,
    dateFin: donneesDeclarees?.dateFin || null,
  };
}

// dossierId vient toujours de l'URL (voir dossiers.routes.js) : jamais traité sans confirmer au
// préalable qu'il appartient à l'entité résolue par entiteContext, même filtre IDOR que le reste
// de ce module (trouverDossierAvecStatutParId, scopé entite.id).
//
// Réservé aux dossiers ACTUELLEMENT "Validé - prêt à l'embauche" (STATUT_CIBLE) : cette
// correction n'a de sens que pour ce statut précis (filtre "Disponibilité des candidats prêts à
// l'embauche", Dossiers candidats) — un dossier à tout autre statut est refusé explicitement
// plutôt que d'accepter silencieusement une correction sans objet.
async function corrigerDisponibiliteEmbauche(entite, dossierId, donneesBrutes, { utilisateurId, adresseIp }) {
  const donnees = schemaCorrection.parse(donneesBrutes);

  const bd = await db.obtenirKnex();
  const dossier = await dossierRepository.trouverDossierAvecStatutParId(bd, entite.id, dossierId);
  // `undefined` (pas une exception) pour "introuvable" — même convention que
  // dossierService.modifierInscription : la route traduit ça en 404, jamais en 400 (une ressource
  // absente n'est pas une donnée invalide).
  if (!dossier) {
    return undefined;
  }
  if (dossier.statut_code !== STATUT_CIBLE) {
    throw new ErreurDisponibiliteEmbaucheInvalide(
      `Ce dossier n'est pas au statut "Validé - prêt à l'embauche" (statut actuel : "${dossier.statut_libelle}").`,
    );
  }

  const derniereCorrection = await disponibiliteEmbaucheRepository.trouverDerniereCorrection(bd, dossierId);
  const periodeAvant = calculerPeriodeAvant(dossier.donnees_disponibilites, derniereCorrection);

  return bd.transaction(async (trx) => {
    const [correction] = await disponibiliteEmbaucheRepository.enregistrerCorrection(trx, {
      dossierId,
      dateDebut: donnees.dateDebut,
      dateFin: donnees.dateFin,
      commentaire: donnees.commentaire,
      utilisateurId,
    });

    // Traçabilité (B4, demande utilisateur explicite) — même transaction que l'écriture
    // ci-dessus (tout ou rien), même convention que workflowEngine (audit 2026-09-26,
    // rendezvous_neutralise_transition) : une action aussi sensible que la correction d'une
    // donnée déclarative candidat ne doit jamais rester silencieuse.
    await journalAudit.enregistrerAction(trx, {
      utilisateurId,
      entiteId: entite.id,
      action: ACTION_JOURNAL_AUDIT,
      tableCible: 'disponibilites_embauche_corrigees',
      cibleId: correction.id,
      donnees: {
        dossierId,
        dateDebutAvant: periodeAvant.dateDebut,
        dateFinAvant: periodeAvant.dateFin,
        dateDebutApres: donnees.dateDebut,
        dateFinApres: donnees.dateFin,
        commentaire: donnees.commentaire,
      },
      adresseIp,
    });

    return correction;
  });
}

module.exports = { corrigerDisponibiliteEmbauche, ErreurDisponibiliteEmbaucheInvalide };
