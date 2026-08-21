const db = require('../../db/knex');
const dossierRepository = require('../dossier/dossierRepository');
const notesDossierRepository = require('../dossier/notesDossierRepository');
const rendezvousRepository = require('./rendezvousRepository');
const motifRepository = require('../motifs/motifRepository');
const utilisateurRepository = require('../auth/utilisateurRepository');
const lieuRepository = require('../lieux/lieuRepository');
const { ROLES } = require('../auth/rbac');

const CATEGORIE_MOTIF_DESISTEMENT = 'desistement';

// Un même formateur peut désormais évaluer jusqu'à 2 candidats sur un même créneau exact (ajout
// métier — auparavant 1 seul) : constante simple plutôt que pilotée par la config d'entité, cette
// demande ne visait qu'ACCECIT et ne mentionne aucune variation par entité.
const CAPACITE_MAX_FORMATEUR_PAR_CRENEAU = 2;

// Workflow v4 (retrait de en_attente_verdict, responsable de projet, 2026-07-31) : la
// replanification reste possible à tout moment tant que le dossier est test_planifie, SAUF dans
// les DELAI_MIN_REPLANIFICATION_MINUTES minutes précédant le rendez-vous actuel — passé ce seuil,
// le formateur peut déjà être en train d'évaluer le candidat, et une replanification créerait un
// nouveau rendez-vous sans que personne n'ait prévenu ni le formateur ni le candidat déjà sur
// place. Ne s'applique volontairement PAS à une replanification depuis test_non_realise/invalide
// (voir verifierDelaiAvantReplanification ci-dessous) : dans ces deux cas le formateur a déjà agi
// sur l'ancien rendez-vous (absence constatée ou test évalué), il n'y a plus de créneau en cours à
// protéger — seule une replanification qui laisse le dossier en test_planifie (donc le même
// rendez-vous encore "en attente") est concernée.
const DELAI_MIN_REPLANIFICATION_MINUTES = 30;
const CODE_ACTION_REPLANIFIER_TEST = 'replanifier_test';
const STATUT_PROTEGE_PAR_DELAI_REPLANIFICATION = 'test_planifie';

// 'honore' (audit 2026-08-20, dossiers #89/#91/#85/#74/#69) : posé uniquement par
// evaluationEngine.enregistrerEvaluation quand une évaluation valide fait aboutir le dossier à
// valide_pret_embauche/valide_envoi_formation — le test a réellement eu lieu et conclu
// positivement, distinct de 'confirme' (présence confirmée À L'AVANCE, avant le test, jamais un
// constat a posteriori). Jamais choisi par un agent via changerStatutRendezvous ce jour (pas de
// bouton dédié) : listé ici pour que la validation de forme l'accepte quand
// evaluationEngine l'écrit via rendezvousRepository.mettreAJourStatutRendezvous.
const STATUTS_AUTORISES = ['prevu', 'confirme', 'absent', 'annule', 'honore'];
// Statuts qui constituent un désistement (CLAUDE.md, besoin Accueil/Coordination : "motif de
// désistement enregistré systématiquement, pour objectiver le phénomène et nourrir le futur
// tableau de bord") — 'absent' (non présenté le jour J) et 'annule' (désistement annoncé à
// l'avance) sont les deux façons dont un candidat ne donne pas suite à un rendez-vous.
const STATUTS_DESISTEMENT = ['absent', 'annule'];

// Statut technique posé automatiquement (jamais choisi par un agent — absent de
// STATUTS_AUTORISES/statutBodySchema ci-dessus, changerStatutRendezvous le rejetterait) sur
// l'ancien rendez-vous actif d'un dossier quand un nouveau rendez-vous du même type est créé (voir
// creerRendezvous ci-dessous) — corrige la cause racine des doublons observés en base (audit du
// 2026-08-13, dossier #88, rendez-vous 61-65) : jusqu'ici, aucune transition ne referme jamais
// l'ancien rendez-vous lors d'une replanification, les deux restaient 'prevu' en parallèle.
// N'a AUCUN effet sur categoriserStatutRendezvous/le panneau historique (voir plus bas) : "Replanifié"
// y était déjà déduit de "ce n'est pas le plus récent actif", jamais de la valeur exacte de
// `statut` — un rendez-vous à STATUT_REMPLACE continue donc de s'afficher "Replanifié" sans aucun
// changement de ce côté.
const STATUT_REMPLACE = 'remplace';

// Erreurs métier distinctes d'une Error générique (500 opaque) : rendezvous.routes.js les
// traduit en 400/409 avec un message directement affichable à l'agent — même principe que
// ErreurInscriptionConflit dans dossierService.js.
class ErreurFormateurInvalide extends Error {
  constructor(message) {
    super(message);
    this.name = 'ErreurFormateurInvalide';
  }
}

class ErreurCreneauPris extends Error {
  constructor(message) {
    super(message);
    this.name = 'ErreurCreneauPris';
  }
}

class ErreurDatePassee extends Error {
  constructor(message) {
    super(message);
    this.name = 'ErreurDatePassee';
  }
}

class ErreurReplanificationTropTardive extends Error {
  constructor(message) {
    super(message);
    this.name = 'ErreurReplanificationTropTardive';
  }
}

class ErreurLieuInvalide extends Error {
  constructor(message) {
    super(message);
    this.name = 'ErreurLieuInvalide';
  }
}

class ErreurRendezvousDossierClos extends Error {
  constructor(message) {
    super(message);
    this.name = 'ErreurRendezvousDossierClos';
  }
}

// Audit du 2026-08-20 (dossier #32, RDV #82) : "Marquer absent" appliqué à un rendez-vous encore
// à venir (date_heure future) — rien ne l'empêchait. Une absence ne peut être constatée qu'une
// fois le créneau passé ; 'confirme'/'annule' restent autorisés à tout moment (une annulation
// s'annonce typiquement À L'AVANCE, contrairement à une absence qui se CONSTATE après coup).
class ErreurRendezvousDateNonPassee extends Error {
  constructor(message) {
    super(message);
    this.name = 'ErreurRendezvousDateNonPassee';
  }
}

// Statuts de DOSSIER (pas de rendez-vous) au-delà desquels une action sur le rendez-vous de test
// associé n'a plus de sens : le dossier a déjà quitté test_planifie vers une issue (non réalisé,
// invalidé après évaluation, ou verdict final positif) — Confirmer la présence/Marquer absent/
// Marquer annulé porteraient alors sur un rendez-vous déjà tranché autrement (audit du 2026-08-20,
// dossier #84 : dossier basculé en test_non_realise par la tâche automatique, rendez-vous resté
// affiché "Prévu" avec ces 3 boutons toujours actifs, aucune vérification serveur ne les
// bloquait). Codes ACCECIT en dur, même patron que STATUTS_REPLANIFIABLES
// (frontend/pages/recruteur/Validation.jsx) : à faire évoluer en configuration si une autre entité
// réutilise ce composant (voir Modularité, CLAUDE.md) — copie tenue identique côté front, voir
// GestionRendezvous.jsx.
const STATUTS_DOSSIER_RENDEZVOUS_CLOS = ['test_non_realise', 'invalide', 'valide_envoi_formation', 'valide_pret_embauche'];

// dossierId vient toujours de l'URL (voir rendezvous.routes.js) : jamais traité sans confirmer
// au préalable qu'il appartient à l'entité résolue par entiteContext, même faille IDOR déjà
// corrigée pour les pièces justificatives et les relances.
async function verifierDossierAppartientEntite(bd, entite, dossierId) {
  const dossier = await dossierRepository.trouverDossierParId(bd, entite.id, dossierId);
  if (!dossier) {
    throw new Error(`Dossier "${dossierId}" introuvable pour l'entité « ${entite.code} ».`);
  }
}

async function listerRendezvous(entite, dossierId) {
  const bd = await db.obtenirKnex();
  await verifierDossierAppartientEntite(bd, entite, dossierId);
  return rendezvousRepository.listerRendezvousParDossier(bd, dossierId);
}

// Le cœur du besoin : passer un rendez-vous à 'absent' ou 'annule' SANS motif valide échoue —
// « systématiquement » n'est pas une option laissée à l'agent, c'est une règle imposée ici,
// jamais contournable depuis le front (même principe que la revalidation serveur des autres
// règles métier du projet — la validation front ne suffit jamais à elle seule).
async function changerStatutRendezvous(entite, { dossierId, rendezvousId, statut, motifCode }, bdExistante = null) {
  if (!STATUTS_AUTORISES.includes(statut)) {
    throw new Error(`Statut de rendez-vous "${statut}" invalide (attendu : ${STATUTS_AUTORISES.join(', ')}).`);
  }

  const bd = bdExistante ?? (await db.obtenirKnex());

  // Remplace verifierDossierAppartientEntite (même vérification IDOR) : récupère en plus le code
  // et le libellé de statut du dossier, nécessaires pour le garde-fou
  // STATUTS_DOSSIER_RENDEZVOUS_CLOS ci-dessous, sans requête séparée.
  const dossier = await dossierRepository.trouverDossierAvecStatutParId(bd, entite.id, dossierId);
  if (!dossier) {
    throw new Error(`Dossier "${dossierId}" introuvable pour l'entité « ${entite.code} ».`);
  }
  // Défense en profondeur : GestionRendezvous.jsx masque déjà ces boutons dans ce cas, mais rien
  // n'empêchait jusqu'ici un appel API direct (ou un clic sur un bouton resté affiché par une
  // page non rafraîchie) de réussir silencieusement — voir audit du 2026-08-20.
  if (STATUTS_DOSSIER_RENDEZVOUS_CLOS.includes(dossier.statut_code)) {
    throw new ErreurRendezvousDossierClos(
      `Ce test est déjà clôturé (${dossier.statut_libelle}) : action sur le rendez-vous indisponible.`,
    );
  }

  const rendezvous = await rendezvousRepository.trouverRendezvousParId(bd, entite.id, rendezvousId);
  if (!rendezvous || rendezvous.dossier_id !== Number(dossierId)) {
    throw new Error(`Rendez-vous "${rendezvousId}" introuvable pour le dossier "${dossierId}".`);
  }

  // 'absent' seulement : une absence se CONSTATE après le créneau, jamais avant (voir
  // ErreurRendezvousDateNonPassee ci-dessus) — 'confirme'/'annule' restent autorisés à tout
  // moment, aucune contrainte de date sur eux.
  if (statut === 'absent' && new Date(rendezvous.date_heure) >= new Date()) {
    throw new ErreurRendezvousDateNonPassee(
      "Impossible de marquer ce rendez-vous absent : le créneau n'est pas encore passé.",
    );
  }

  let motifId = null;
  if (STATUTS_DESISTEMENT.includes(statut)) {
    if (!motifCode) {
      throw new Error(`Un motif de désistement est obligatoire pour passer un rendez-vous au statut "${statut}".`);
    }
    const motif = await motifRepository.trouverMotifParCode(bd, entite.id, CATEGORIE_MOTIF_DESISTEMENT, motifCode);
    if (!motif) {
      throw new Error(`Motif de désistement "${motifCode}" non configuré pour l'entité « ${entite.code} ».`);
    }
    motifId = motif.id;
  }
  // Un statut hors désistement ('prevu'/'confirme') repart d'un motif nul : un motif de
  // désistement resterait trompeur si le rendez-vous est ensuite reprogrammé/reconfirmé.

  return rendezvousRepository.mettreAJourStatutRendezvous(bd, rendezvousId, { statut, motifId });
}

async function listerMotifsDesistement(entite) {
  const bd = await db.obtenirKnex();
  return motifRepository.listerMotifsParCategorie(bd, entite.id, CATEGORIE_MOTIF_DESISTEMENT);
}

// Vue d'ensemble des rendez-vous de test de l'entité, tous dossiers confondus (page
// Planification côté Coordination) — contrairement à listerRendezvous ci-dessus, ne prend pas de
// dossierId : rien à vérifier côté IDOR, la portée est déjà l'entité entière (voir
// entiteContext), pas un dossier précis.
// Postes recherchés exposés à plat (postesBureau/postesHotel) pour la colonne "Poste" de
// Planification.jsx — même patron que dossierService.listerDossiers.
async function listerRendezvousTest(entite, { aVenirSeulement, formateurId, dateDebut, dateFin } = {}) {
  const bd = await db.obtenirKnex();
  const rendezvous = await rendezvousRepository.listerRendezvousTest(bd, entite.id, {
    aVenirSeulement,
    formateurId,
    dateDebut,
    dateFin,
  });
  return rendezvous.map(({ donnees_disponibilites, ...reste }) => ({
    ...reste,
    postesBureau: donnees_disponibilites?.posteBureau ?? [],
    postesHotel: donnees_disponibilites?.posteHotel ?? [],
  }));
}

// Historique des rendez-vous de test, pour un ou plusieurs dossiers (page Planification côté
// Coordination, bouton "Voir l'historique des rendez-vous sélectionnés") — contrairement à
// listerRendezvousTest ci-dessus (une ligne par rendez-vous À VENIR, tous dossiers confondus),
// couvre TOUT l'historique (passé et futur) des dossiers demandés, utile pour visualiser d'un
// coup d'œil les tentatives de test successives d'un candidat (cas de replanification multiple,
// ex. dossiers #74/#88 identifiés lors de l'audit du 2026-08-13).
//
// `rendezvous.statut` (colonne DB : 'prevu'|'confirme'|'absent'|'annule', voir
// rendezvousService.STATUTS_AUTORISES) ne porte AUCUNE valeur "honoré"/"réalisé" — un test conduit
// se déduit uniquement de l'EXISTENCE d'une ligne `evaluations` liée (evaluations.rendezvous_id,
// migration 020), jamais mise à jour sur `rendezvous.statut` lui-même (voir
// evaluationEngine.enregistrerEvaluation, qui n'écrit que dans `evaluations` + la transition de
// statut du DOSSIER, jamais rendezvous.statut). Et aucune transition ne referme non plus
// automatiquement un ancien rendez-vous encore 'prevu'/'confirme' lors d'une replanification (voir
// trouverRendezvousTestActifDossier ci-dessus, déjà commenté sur ce point) : un dossier replanifié
// plusieurs fois accumule donc plusieurs lignes 'prevu' pour un même dossier, dont une seule
// (la plus récente) représente réellement le créneau attendu — les autres sont implicitement
// "Replanifié", sans qu'aucune colonne ne le dise explicitement en base.
const CATEGORIES_STATUT_HISTORIQUE = Object.freeze({
  A_VENIR: 'a_venir',
  HONORE: 'honore',
  MANQUE: 'manque',
  ANNULE: 'annule',
  REPLANIFIE: 'replanifie',
  // Rendez-vous 'prevu'/'confirme' encore actif (le plus récent de son dossier) mais dont la date
  // est déjà passée sans qu'aucune évaluation n'ait été enregistrée ni qu'un statut 'absent' n'ait
  // été posé — ni "à venir" (date passée) ni "manqué"/"honoré" (aucune action enregistrée) : reste
  // une action en attente côté Accueil/Coordination ou formateur, distincte des 5 catégories
  // demandées mais nécessaire pour ne pas mentir sur une date passée en l'affichant "à venir".
  A_TRAITER: 'a_traiter',
});

// `estRendezvousActif` : vrai si CE rendez-vous est le plus récent parmi les 'prevu'/'confirme'
// sans évaluation de son dossier (voir trouverRendezvousTestActifDossier) — calculé une fois par
// dossier par l'appelant, pas ici (cette fonction reste une pure fonction de catégorisation).
function categoriserStatutRendezvous(rendezvous, estRendezvousActif) {
  if (rendezvous.evaluation_id) return CATEGORIES_STATUT_HISTORIQUE.HONORE;
  if (rendezvous.statut === 'annule') return CATEGORIES_STATUT_HISTORIQUE.ANNULE;
  if (rendezvous.statut === 'absent') return CATEGORIES_STATUT_HISTORIQUE.MANQUE;
  if (!estRendezvousActif) return CATEGORIES_STATUT_HISTORIQUE.REPLANIFIE;
  return new Date(rendezvous.date_heure).getTime() > Date.now()
    ? CATEGORIES_STATUT_HISTORIQUE.A_VENIR
    : CATEGORIES_STATUT_HISTORIQUE.A_TRAITER;
}

// Renvoie { rendezvous, notes } plutôt qu'un simple tableau de rendez-vous — `notes` (notes_dossier,
// voir notesDossierRepository.listerNotesParDossiers) est une liste à part, PAS rattachée à un
// rendez-vous précis (aucune colonne rendezvous_id sur notes_dossier) : impossible de savoir avec
// certitude à quel rendez-vous une note donnée se rapporte. Décision utilisateur du 2026-08-13 :
// affichées séparément, une fois par candidat (PanneauHistoriqueRendezvous.jsx, bloc "Notes du
// dossier"), plutôt que sous une ligne de rendez-vous précise en devinant un rattachement — le
// motif (annulé/absent) et le commentaire d'évaluation, eux, sont bien rattachés à un rendez-vous
// exact (voir rendezvousRepository.listerHistoriqueRendezvousParDossiers) et restent donc portés
// par chaque ligne de `rendezvous` (motif_libelle/evaluation_commentaire).
async function listerHistoriqueRendezvousDossiers(entite, dossierIds) {
  if (dossierIds.length === 0) return { rendezvous: [], notes: [] };

  const bd = await db.obtenirKnex();
  const [rendezvous, notes] = await Promise.all([
    rendezvousRepository.listerHistoriqueRendezvousParDossiers(bd, entite.id, dossierIds),
    notesDossierRepository.listerNotesParDossiers(bd, entite.id, dossierIds),
  ]);

  // Regroupe par dossier pour déterminer, par dossier, quel rendez-vous est "actif" (voir
  // catégorisation ci-dessus) — même définition que trouverRendezvousTestActifDossier (le plus
  // récent parmi 'prevu'/'confirme' sans évaluation), appliquée ici en mémoire sur la liste déjà
  // chargée plutôt que par un aller-retour DB supplémentaire par dossier.
  const parDossier = new Map();
  for (const rdv of rendezvous) {
    if (!parDossier.has(rdv.dossier_id)) parDossier.set(rdv.dossier_id, []);
    parDossier.get(rdv.dossier_id).push(rdv);
  }

  const idActifParDossier = new Map();
  for (const [dossierId, rendezvousDuDossier] of parDossier) {
    const actif = rendezvousDuDossier
      .filter((rdv) => !rdv.evaluation_id && ['prevu', 'confirme'].includes(rdv.statut))
      .reduce(
        (plusRecent, rdv) => (!plusRecent || new Date(rdv.date_heure) > new Date(plusRecent.date_heure) ? rdv : plusRecent),
        null,
      );
    idActifParDossier.set(dossierId, actif?.id ?? null);
  }

  return {
    rendezvous: rendezvous.map((rdv) => ({
      ...rdv,
      statutCategorise: categoriserStatutRendezvous(rdv, rdv.id === idActifParDossier.get(rdv.dossier_id)),
    })),
    notes,
  };
}

// Planifie un nouveau rendez-vous pour un dossier (ex. rendez-vous de test, CLAUDE.md étape
// "Envoi en test" : "attribution selon poste et disponibilité, date fixée, notification envoyée
// au formateur concerné"). Ne déclenche aucune transition de statut du dossier ici — c'est une
// action distincte (voir transitions.routes.js, codeAction "planifier_test" pour ACCECIT),
// exactement comme changerStatutRendezvous ci-dessus ne touche jamais dossiers.statut non plus.
//
// bdExistante : voir le commentaire équivalent dans workflowEngine.appliquerTransition — permet
// à planificationRendezvousService de faire participer cette création à une transaction déjà
// ouverte, pour que la création du rendez-vous et la transition de statut qui suit réussissent
// ou échouent ensemble.
// postesSelectionnes (Phase 1, informatif — voir evaluationEngine.resoudrePosteCode) : défaut
// tableau vide, même défaut que la colonne `rendezvous.postes_selectionnes` (migration 039) —
// jamais validé contre les postes réellement déclarés du dossier ici, ce module ne connaît pas ce
// vocabulaire (voir Modularité, CLAUDE.md) ; une valeur incohérente reste sans conséquence
// puisque purement informative pour le formateur, jamais utilisée pour une décision d'accès.
async function creerRendezvous(
  entite,
  { dossierId, typeRdv, dateHeure, formateurId, lieuId, postesSelectionnes = [], notePlanification },
  bdExistante = null,
) {
  // Ne jamais se fier uniquement au front (calendrier grisé + <input min>, voir
  // CalendrierDisponibiliteFormateur.jsx/ModalePlanificationTest.jsx) — même principe que les
  // autres règles métier de ce module (voir changerStatutRendezvous ci-dessus). Comparaison
  // d'instants réels (Date#getTime()), pas de dates calendaires : dateHeure est un datetime ISO
  // complet avec fuseau (voir creationRendezvousSchema, .datetime({offset:true})), donc "avant
  // maintenant" ne dépend d'aucun fuseau horaire particulier ici — contrairement au calendrier
  // front, qui doit lui choisir un fuseau (Europe/Paris) pour décider quel jour est "aujourd'hui".
  if (new Date(dateHeure).getTime() < Date.now()) {
    throw new ErreurDatePassee("La date du rendez-vous ne peut pas être antérieure à aujourd'hui.");
  }

  const bd = bdExistante ?? (await db.obtenirKnex());
  await verifierDossierAppartientEntite(bd, entite, dossierId);

  let formateurIdValide = null;
  if (formateurId != null) {
    const formateur = await utilisateurRepository.trouverUtilisateurParId(bd, entite.id, formateurId);
    // INSPECTEUR accepté ici aussi (assignation à un test bureau) — le champ reste nommé
    // formateur_id en base (colonne historique, voir migration 018), mais porte indifféremment un
    // formateur (hôtel) ou un inspecteur (bureau) depuis l'ajout de ce second rôle. Aucune
    // vérification ici que le poste du dossier correspond bien au rôle assigné (scope "bureau
    // uniquement" de l'inspecteur reste procédural, pas technique — voir rbac.js).
    if (!formateur || ![ROLES.FORMATEUR, ROLES.INSPECTEUR].includes(formateur.role_code)) {
      throw new ErreurFormateurInvalide(
        `Utilisateur "${formateurId}" introuvable ou n'a pas le rôle formateur/inspecteur pour l'entité « ${entite.code} ».`,
      );
    }
    formateurIdValide = formateur.id;

    // Un même formateur ne peut pas être assigné à plus de CAPACITE_MAX_FORMATEUR_PAR_CRENEAU
    // rendez-vous 'prevu'/'confirme' au même horaire exact — voir
    // rendezvousRepository.compterRendezvousFormateurAuCreneau.
    const nombreDejaPresents = await rendezvousRepository.compterRendezvousFormateurAuCreneau(
      bd,
      formateurIdValide,
      dateHeure,
    );
    if (nombreDejaPresents >= CAPACITE_MAX_FORMATEUR_PAR_CRENEAU) {
      throw new ErreurCreneauPris(
        `Ce formateur a déjà ${CAPACITE_MAX_FORMATEUR_PAR_CRENEAU} rendez-vous prévus à ce créneau (créneau complet).`,
      );
    }
  }

  let lieuIdValide = null;
  if (lieuId != null) {
    const lieu = await lieuRepository.trouverLieuParId(bd, entite.id, lieuId);
    if (!lieu || !lieu.actif) {
      throw new ErreurLieuInvalide(`Lieu "${lieuId}" introuvable ou inactif pour l'entité « ${entite.code} ».`);
    }
    lieuIdValide = lieu.id;
  }

  // Neutralise l'éventuel rendez-vous du même type déjà actif ('prevu'/'confirme') pour ce
  // dossier, puis crée le nouveau — les deux dans la MÊME transaction, jamais l'un sans l'autre.
  // Corrige la cause racine des doublons observés (audit du 2026-08-13, dossier #88, rendez-vous
  // 61-65) : jusqu'ici, replanifier ne referme jamais l'ancien rendez-vous, les deux restaient
  // 'prevu' en parallèle, avec un statut/formateur/motif identique dans certains cas. Règle métier
  // validée avec Florence : la replanification reste libre et sans restriction tant que le dossier
  // est en test_planifie — ce correctif ne bloque JAMAIS la création, il neutralise seulement ce
  // qui devient obsolète UNE FOIS que la nouvelle création a de toute façon déjà réussi les
  // vérifications ci-dessus. Aucune suppression : seul `statut` passe à STATUT_REMPLACE (voir
  // rendezvousRepository.neutraliserRendezvousActifsDossier), toutes les autres colonnes (date,
  // formateur, motif éventuel) restent intactes pour la traçabilité et l'historique par dossier —
  // categoriserStatutRendezvous continue de l'afficher "Replanifié" dans le panneau historique
  // sans aucun changement de ce côté (il ne teste que "est-ce le plus récent actif ?", jamais la
  // valeur exacte de `statut`).
  const executerCreation = (trx) =>
    rendezvousRepository
      .neutraliserRendezvousActifsDossier(trx, { dossierId, typeRdv, statutRemplace: STATUT_REMPLACE })
      .then(() =>
        rendezvousRepository.creerRendezvous(trx, {
          dossierId,
          typeRdv,
          dateHeure,
          formateurId: formateurIdValide,
          lieuId: lieuIdValide,
          postesSelectionnes,
          notePlanification,
        }),
      );

  // bdExistante : déjà une transaction ouverte par l'appelant (voir planificationRendezvousService.js,
  // qui enchaîne création + transitions de statut dans une seule transaction) — la réutiliser telle
  // quelle plutôt que d'en ouvrir une seconde imbriquée. Sinon (appel direct, POST /api/dossiers/
  // :dossierId/rendezvous sans transitions), ouvrir sa propre transaction ici : neutraliser
  // l'ancien et créer le nouveau doivent réussir ou échouer ensemble, même hors du flux
  // "avec-transitions".
  return bdExistante ? executerCreation(bdExistante) : bd.transaction(executerCreation);
}

// Appelée par planificationRendezvousService AVANT de créer le nouveau rendez-vous, pour toute
// replanification (voir en-tête de fichier pour la portée exacte du garde-fou). `transitions`
// reçu tel quel depuis l'appelant, sans que celui-ci ait besoin de connaître le codeAction —
// planificationRendezvousService reste générique (voir Modularité, CLAUDE.md), c'est cette
// fonction, déjà ACCECIT-flavored (voir CAPACITE_MAX_FORMATEUR_PAR_CRENEAU ci-dessus), qui
// interprète le vocabulaire de transitions propre à ACCECIT. Ne fait rien (retour silencieux) si
// aucune des conditions du garde-fou n'est réunie : action différente, dossier déjà ailleurs que
// test_planifie, ou aucun rendez-vous actif à protéger.
async function verifierDelaiAvantReplanification(entite, dossierId, transitions, bdExistante = null) {
  if (!transitions.some((transition) => transition.codeAction === CODE_ACTION_REPLANIFIER_TEST)) {
    return;
  }

  const bd = bdExistante ?? (await db.obtenirKnex());

  const dossier = await dossierRepository.trouverDossierParId(bd, entite.id, dossierId);
  if (!dossier || dossier.statut_code !== STATUT_PROTEGE_PAR_DELAI_REPLANIFICATION) {
    return;
  }

  const rendezvousActuel = await rendezvousRepository.trouverRendezvousTestActifDossier(bd, dossierId);
  if (!rendezvousActuel) {
    return;
  }

  const seuil = new Date(rendezvousActuel.date_heure).getTime() - DELAI_MIN_REPLANIFICATION_MINUTES * 60_000;
  if (Date.now() >= seuil) {
    throw new ErreurReplanificationTropTardive(
      `Impossible de replanifier : le rendez-vous actuel est dans moins de ${DELAI_MIN_REPLANIFICATION_MINUTES} minutes (ou déjà passé) — le formateur peut déjà être en train d'évaluer le candidat.`,
    );
  }
}

module.exports = {
  listerRendezvous,
  changerStatutRendezvous,
  listerMotifsDesistement,
  listerRendezvousTest,
  listerHistoriqueRendezvousDossiers,
  CATEGORIES_STATUT_HISTORIQUE,
  STATUT_REMPLACE,
  creerRendezvous,
  verifierDelaiAvantReplanification,
  ErreurFormateurInvalide,
  ErreurCreneauPris,
  ErreurDatePassee,
  ErreurReplanificationTropTardive,
  ErreurLieuInvalide,
  ErreurRendezvousDossierClos,
};
