// Affichage des rendez-vous de test sur « Suivi des tests » (Planification.jsx) : libellés,
// variantes de couleur, regroupements de statuts, recherche et colonnes triables. Fonctions pures,
// sans état React — testées dans affichageRendezvous.test.js.
import { normaliserTexte } from '../../core/filtres/normaliserTexte';
import { libellePoste } from '../../core/referentiels/postes';

export const FORMAT_DATE_HEURE = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

// Date et heure formatées SÉPARÉMENT (tooltip "Dossier déjà clôturé" ci-dessous, texte "le [date] à
// [heure]") — FORMAT_DATE_HEURE ci-dessus les concatène sans "à", pas ce qui est demandé ici. Mêmes
// formats que PanneauHistoriqueRendezvous.jsx (FORMAT_DATE/FORMAT_HEURE), dupliqués plutôt que
// partagés (voir CLAUDE.md, conventions du projet).
const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const FORMAT_HEURE = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

// Même mapping que GestionRendezvous.jsx (libellé + polarité visuelle d'un statut de
// rendez-vous) — dupliqué plutôt que partagé : une poignée de lignes, pas de quoi justifier un
// utilitaire commun (voir CLAUDE.md, conventions du projet).
// 'remplace' (posé automatiquement par neutraliserRendezvousActifsDossier lors d'une
// replanification, jamais choisi par un agent — voir rendezvousRepository.js) manquait ici (audit
// 2026-08-20) : il retombait sur le code brut "remplace" (ni majuscule ni accent) faute d'entrée
// dans LIBELLES_STATUT, et sur la variante par défaut 'attente', indiscernable visuellement d'un
// rendez-vous réellement 'prevu' — corrigé pour reprendre le même libellé déjà en place sur
// GestionRendezvous.jsx ("Remplacé"). Variante 'neutre-fort' (pas le simple 'neutre' utilisé un
// temps ici, jugé trop discret sur ce tableau — audit 2026-08-20 suivant) : gris moyen/texte foncé,
// neutre mais bien lisible, distinct des badges colorés actifs (Prévu/Annulé...) — même variante
// reprise sur GestionRendezvous.jsx pour rester cohérent entre les deux endroits où ce badge
// apparaît.
// 'absent' affiché "NSPP" (ex-"Manqué", audit 2026-09-11, décision utilisateur — même renommage
// que GestionRendezvous.jsx/ListeEvaluationsAFaire.jsx/PanneauHistoriqueRendezvous.jsx) : ce
// statut n'a désormais plus qu'une seule origine possible — NSPP (clic Formateur/Inspecteur) ou
// la bascule automatique (basculeTestNonRealiseService.js), "Marquer absent" ayant été retiré côté
// Accueil/Coordination/Admin (GestionRendezvous.jsx). Purement l'affichage, aucun changement de la
// valeur en base ni de la couleur du badge (variante 'echec' inchangée, voir
// varianteStatutRendezvous ci-dessous).
// 'honore' (posé par evaluationEngine.enregistrerEvaluation pour un test conduit et validé, voir
// GestionRendezvous.jsx) manquait ici (audit 2026-08-21, régression) : jamais présent dans cette
// table depuis sa création, il retombait sur le code brut "honore" (ni majuscule ni traduction) et
// sur la variante par défaut 'attente' — rétabli avec le même libellé/couleur que
// GestionRendezvous.jsx ("Réalisé"/'vert-clair'), seul autre endroit où ce badge apparaît.
// 'confirme' -> 'Présence confirmée' (pas le simple "Confirmé", audit 2026-09-14, retrait de la
// fusion visuelle "Test planifié" ci-dessous — voir son commentaire) : reprend tel quel le libellé
// déjà utilisé par le bouton de filtre correspondant (STATUTS_FILTRABLES_RENDEZVOUS plus bas),
// pour que le badge de la colonne "Rendez-vous" et son filtre parlent désormais le même
// vocabulaire — cohérence qui n'avait pas lieu d'être tant que le badge affichait "Test planifié"
// à la place. GestionRendezvous.jsx garde, lui, "Confirmé" dans son propre LIBELLES_STATUT
// (fichier distinct, jamais partagé — voir commentaire d'en-tête) : changement local à cet écran
// uniquement, décision utilisateur explicite pour la colonne "Rendez-vous" de "Suivi des tests".
const LIBELLES_STATUT = { prevu: 'Prévu', confirme: 'Présence confirmée', absent: 'NSPP', annule: 'Annulé', remplace: 'Remplacé', honore: 'Réalisé' };
const STATUTS_DESISTEMENT = ['absent', 'annule'];
function varianteStatutRendezvous(statut) {
  if (statut === 'confirme') return 'succes';
  if (statut === 'honore') return 'vert-clair';
  if (STATUTS_DESISTEMENT.includes(statut)) return 'echec';
  if (statut === 'remplace') return 'neutre-fort';
  return 'attente';
}

// Fusion visuelle "Test planifié" (prevu/confirme regroupés sous un même badge, audit 2026-08-31)
// RETIRÉE : la colonne "Statut" (dossier, ajoutée depuis,
// audit 2026-09-13, voir GROUPE_STATUT_DOSSIER_PAR_CODE_ACCECIT plus bas) joue désormais le rôle
// qu'avait cette fusion à l'origine — elle affiche "Test planifié" tant que le dossier n'a pas
// avancé, quel que soit prevu/confirme, donc le risque qu'un agent croie à tort "Confirmé" =
// aboutissement du test est déjà couvert par cette colonne, sans qu'il faille en plus estomper la
// distinction dans la colonne "Rendez-vous". Cette colonne affiche donc à nouveau fidèlement le
// statut RÉEL de chaque rendez-vous (voir libelleAfficheRendezvous/varianteAfficheeRendezvous
// ci-dessous, désormais un simple passe-plat vers LIBELLES_STATUT/varianteStatutRendezvous, même
// principe que GestionRendezvous.jsx) : "Prévu" (variante 'attente') pour 'prevu', "Présence
// confirmée" (variante 'succes') pour 'confirme' — cohérent avec les couleurs déjà attribuées à
// ces deux codes par la barre de filtres juste en dessous (voir Planification.css,
// button[data-statut='prevu'/'confirme']). codeStatutAffiche/STATUTS_FILTRABLES_RENDEZVOUS
// (filtrage) n'ont jamais dépendu de cette fusion (voir leur propre commentaire) : rien à changer
// de ce côté. Changement ISOLÉ à ce fichier : estRendezvousTestPlanifie/LIBELLE_TEST_PLANIFIE
// n'étaient utilisés nulle part ailleurs (GestionRendezvous.jsx/PanneauHistoriqueRendezvous.jsx
// portent chacun leur propre logique d'affichage, jamais partagée avec celle-ci — voir le
// commentaire d'en-tête de LIBELLES_STATUT plus haut), vérifié avant de les supprimer ci-dessous.

// Libellé/variante EFFECTIFS (badge, recherche, tri) — plus de "Non réalisé" dérivé de la date
// pour un 'prevu' expiré (audit 2026-09-21, correction demande utilisateur) : cette valeur
// n'existait qu'à l'affichage, jamais en base (rendezvous.statut restait 'prevu'), et masquait le
// statut réel du rendez-vous juste au moment où l'angle mort correspondant (aucune bascule
// automatique une fois la présence constatée, ou avant le délai de grâce) doit au contraire
// rester visible ici — la colonne "Statut" (dossier) porte désormais "Test non réalisé" une fois
// le filet de sécurité déclenché (voir backend basculeTestNonRealiseService.js), sans qu'il faille
// en plus travestir le statut du rendez-vous pour le signaler dans CETTE colonne. Simple passe-plat
// vers LIBELLES_STATUT/varianteStatutRendezvous désormais, quelle que soit la date — les colonnes
// "Rendez-vous" et "Statut" redeviennent deux informations indépendantes, jamais l'une déduite de
// l'autre.
// Bloc 2 : un rendez-vous 'annule' par workflowEngine.forcerStatut (Admin, hors
// parcours normal) porte ce motif système, jamais choisi par un agent (voir
// scripts/seedMotifNeutraliseParForcage.js, categorie 'systeme') — distinct visuellement d'une VRAIE
// annulation candidat, même statut brut en base. Le filtre "Annulé" (STATUTS_FILTRABLES_RENDEZVOUS
// plus bas) reste UNIQUE et continue de les inclure (décision utilisateur explicite) : seuls le
// libellé et la couleur du badge changent, jamais le code de statut ni un filtre séparé.
const CODE_MOTIF_NEUTRALISE_PAR_FORCAGE = 'neutralise_par_forcage';
function rendezvousAnnuleParForcage(rdv) {
  return rdv.statut === 'annule' && rdv.motif_code === CODE_MOTIF_NEUTRALISE_PAR_FORCAGE;
}

export function libelleAfficheRendezvous(rdv) {
  if (rendezvousAnnuleParForcage(rdv)) return 'Annulé (forçage)';
  return LIBELLES_STATUT[rdv.statut] ?? rdv.statut;
}
export function varianteAfficheeRendezvous(rdv) {
  // 'neutre-fort' (gris) plutôt que 'echec' (rouge, désistement candidat) : ce badge ne signale pas
  // un désistement, seulement un forçage administratif — même famille de couleur que le badge
  // "Remplacé" (varianteStatutRendezvous ci-dessus), pas une nouvelle teinte inventée pour ce cas.
  if (rendezvousAnnuleParForcage(rdv)) return 'neutre-fort';
  return varianteStatutRendezvous(rdv.statut);
}

// Badge "Dossier clos" : signale qu'un rendez-vous encore 'prevu'/'confirme'
// n'est en réalité plus actionnable, le DOSSIER associé ayant déjà quitté 'test_planifie' —
// typiquement le filet de sécurité 72h "présence confirmée sans évaluation"
// (basculeTestNonRealiseService.executerBasculePresenceConfirmeeSansEvaluation), qui transitionne
// le dossier SANS jamais toucher rendezvous.statut, par choix. Liste BLANCHE ('test_planifie' =
// seul statut où ce rendez-vous reste réellement actionnable), pas une liste noire des statuts
// "clos" à deviner — même principe que rendezvousService.STATUT_DOSSIER_RENDEZVOUS_ACTIONNABLE
// côté back (categoriserStatutRendezvous, PanneauHistoriqueRendezvous.jsx), dupliqué ici plutôt que
// partagé (voir CLAUDE.md, conventions du projet) : ce fichier est déjà ACCECIT-flavored (voir
// GROUPE_STATUT_DOSSIER_PAR_CODE_ACCECIT plus bas), contrairement au moteur générique
// (workflowEngine.js) qui, lui, ne nomme jamais aucun statut.
const STATUT_DOSSIER_RENDEZVOUS_ACTIONNABLE_ACCECIT = 'test_planifie';
export function rendezvousDossierClos(rdv) {
  return ['prevu', 'confirme'].includes(rdv.statut) && rdv.dossier_statut_code !== STATUT_DOSSIER_RENDEZVOUS_ACTIONNABLE_ACCECIT;
}

// Texte du tooltip natif du marqueur "Dossier clos" ci-dessus — même formule que
// PanneauHistoriqueRendezvous.jsx, tiret simple (pas de tiret
// cadratin). `dossier_statut_libelle` vient de rendezvousService.listerRendezvousTest, jamais un
// libellé en dur ici (voir Modularité, CLAUDE.md). `rdv.statut_force_le` réutilisé tel quel — ce
// champ porte en réalité la date du DERNIER changement de statut du dossier, quelle qu'en soit la
// cause (voir rendezvousRepository.listerRendezvousTest, LEFT JOIN LATERAL vers journal_audit),
// jamais uniquement celle d'un forçage admin malgré son nom : déjà sélectionné pour toute ligne,
// pas seulement quand rdv.statutForce est vrai, donc réutilisable ici sans aller-retour backend
// supplémentaire.
export function tooltipDossierClos(rdv) {
  const date = rdv.statut_force_le ? new Date(rdv.statut_force_le) : null;
  const quand = date ? ` le ${FORMAT_DATE.format(date)} à ${FORMAT_HEURE.format(date)}` : '';
  return `Dossier déjà clôturé (${rdv.dossier_statut_libelle})${quand} - ce rendez-vous n'est plus actionnable.`;
}

// Code STABLE du statut AFFICHÉ (colonne "Statut"), pour les boutons de filtre ci-dessous — jamais
// le libellé français de libelleAfficheRendezvous ci-dessus (locale-dépendant, pas fait pour être
// comparé). Simple passe-plat vers rdv.statut désormais (voir commentaire ci-dessus) : plus de
// dérivation 'non_realise' qui n'a jamais existé côté rendezvous.statut.
export function codeStatutAffiche(rdv) {
  return rdv.statut;
}

// Boutons de filtre par statut (audit 2026-08-31, décision utilisateur — même pattern que
// FiltresStatut.jsx sur "Dossiers candidats") — toutes les valeurs que codeStatutAffiche peut
// renvoyer, dans le même ordre/libellé que LIBELLES_STATUT (plus de 'non_realise' dérivé depuis le
// 2026-09-21, voir codeStatutAffiche ci-dessus). Liste fixe côté
// front, pas chargée depuis une config d'entité : rendezvous.statut est une petite énumération
// commune au moteur générique (voir rendezvous.routes.js, statutBodySchema), pas un vocabulaire
// propre à ACCECIT comme les statuts de dossier (table `statuts`, elle bien configurable par
// entité) — même raisonnement que LIBELLES_STATUT ci-dessus, déjà en dur ici avant ce filtre.
// Libellé du bouton "confirme" ("Présence confirmée", pas le "Confirmé" que porterait
// rendezvous.statut littéralement) — désormais IDENTIQUE au badge affiché dans la colonne
// "Rendez-vous" pour ce même rendez-vous (voir LIBELLES_STATUT.confirme plus haut, audit
// 2026-09-14 : la fusion "Test planifié" qui les distinguait encore n'existe plus). Conservé tel
// quel malgré tout : le motif d'origine (2026-08-31 — "Confirmé" seul pouvait laisser croire à un
// aboutissement du test au même titre que Réalisé/NSPP/Annulé, alors que ce statut ne décrit
// qu'une confirmation de présence sur un test ENCORE À VENIR) reste valable pour le LIBELLÉ
// lui-même, indépendamment de la fusion visuelle qui l'accompagnait.
export const STATUTS_FILTRABLES_RENDEZVOUS = [
  { code: 'prevu', libelle: 'Prévu' },
  { code: 'confirme', libelle: 'Présence confirmée' },
  { code: 'honore', libelle: 'Réalisé' },
  { code: 'absent', libelle: 'NSPP' },
  { code: 'annule', libelle: 'Annulé' },
  { code: 'remplace', libelle: 'Remplacé' },
];

// Regroupement des statuts DOSSIER en 4 étapes de haut niveau pour la colonne "Statut" (audit
// 2026-09-13, demande utilisateur — remplace l'affichage direct du statut brut mis en place au
// tour précédent, un badge par statut réel était jugé trop détaillé pour ce tableau). Centralisé
// ici en un seul mapping code → libellé de groupe plutôt que des conditions dispersées dans le
// rendu : un statut ajouté/renommé dans workflow.config.json (ACCECIT) n'a qu'un seul endroit à
// ajuster.
//
// Couverture vérifiée en base le 2026-09-13 (requête sur `statuts`/`dossiers`, entité accecit,
// script d'audit ponctuel non conservé) avant d'écrire ce mapping, pas devinée :
// - Les 11 codes actifs de workflow.config.json (ACCECIT) sont tous couverts : nouveau (libellé
//   "Inscrit"), en_attente_pieces, test_non_planifie, en_attente_verification, en_attente_verdict,
//   verdict_positif, verdict_negatif, en_attente_validation_recruteur, test_planifie, test_realise,
//   test_non_realise, invalide, valide_envoi_formation, valide_pret_embauche, formation_non_validee,
//   embauche.
// - 5 codes hérités d'une version antérieure du workflow (0 dossier aujourd'hui, gardés en base
//   uniquement pour les FK historique_statuts d'anciens dossiers déjà migrés — voir
//   backend/scripts/migrerWorkflowAccecitV2.js) rattachés à un groupe malgré tout, décision
//   utilisateur du 2026-09-13 : `en_attente_verification` (ancien palier avant planification d'un
//   test) → "Test non planifié" ; `en_attente_verdict`/`verdict_positif`/`verdict_negatif`/
//   `en_attente_validation_recruteur` (anciens noms des étapes post-test, avant la scission en
//   test_realise/valide_envoi_formation/valide_pret_embauche/invalide/formation_non_validee) →
//   "Test réalisé".
// - `valide`/`rejete` (2 autres codes hérités, eux aussi à 0 dossier) volontairement ABSENTS de ce
//   mapping, décision utilisateur du 2026-09-13 : statuts terminaux d'un ancien parcours SANS
//   notion de test, aucun des 4 groupes ne leur correspond réellement — tombent sur le fallback
//   neutre de libelleGroupeStatutDossier/varianteGroupeStatutDossier ci-dessous (libellé BRUT du
//   dossier affiché tel quel, jamais rattaché arbitrairement à un groupe qui ne le décrirait pas),
//   même que pour un code totalement inconnu (autre entité, nouveau statut jamais vu ici).
// Codes STABLES des 4 groupes (audit 2026-09-13, ajout de la barre de filtres "Statut") — jamais
// le libellé français directement comme code : distinct du libellé (locale-dépendant, avec espaces/
// accents, pas fait pour être une clé de comparaison/URL), même principe que codeStatutAffiche vs
// libelleAfficheRendezvous plus haut pour le statut de RENDEZ-VOUS.
const GROUPE_TEST_NON_PLANIFIE = 'test_non_planifie';
const GROUPE_TEST_PLANIFIE = 'test_planifie';
const GROUPE_TEST_REALISE = 'test_realise';
const GROUPE_TEST_NON_REALISE = 'test_non_realise';

const GROUPE_STATUT_DOSSIER_PAR_CODE_ACCECIT = {
  nouveau: GROUPE_TEST_NON_PLANIFIE,
  en_attente_pieces: GROUPE_TEST_NON_PLANIFIE,
  test_non_planifie: GROUPE_TEST_NON_PLANIFIE,
  en_attente_verification: GROUPE_TEST_NON_PLANIFIE,

  test_planifie: GROUPE_TEST_PLANIFIE,

  test_realise: GROUPE_TEST_REALISE,
  en_attente_verdict: GROUPE_TEST_REALISE,
  verdict_positif: GROUPE_TEST_REALISE,
  verdict_negatif: GROUPE_TEST_REALISE,
  en_attente_validation_recruteur: GROUPE_TEST_REALISE,
  valide_envoi_formation: GROUPE_TEST_REALISE,
  valide_pret_embauche: GROUPE_TEST_REALISE,
  invalide: GROUPE_TEST_REALISE,
  formation_non_validee: GROUPE_TEST_REALISE,
  embauche: GROUPE_TEST_REALISE,

  test_non_realise: GROUPE_TEST_NON_REALISE,
};

// Libellé/couleur par groupe STABLE (pas par code de statut dossier brut) — une seule couleur pour
// les statuts dossier désormais fusionnés sous un même libellé (ex. "Inscrit"/"En attente de
// pièces"/"Test non planifié" partagent tous "Test non planifié"), reprend la teinte déjà utilisée
// pour le statut éponyme sur les autres écrans (Tests.jsx/TableauDeBordAccueil.jsx,
// VARIANTE_PAR_CODE_ACCECIT).
const LIBELLE_PAR_GROUPE_STATUT_DOSSIER = {
  [GROUPE_TEST_NON_PLANIFIE]: 'Test non planifié',
  [GROUPE_TEST_PLANIFIE]: 'Test planifié',
  [GROUPE_TEST_REALISE]: 'Test réalisé',
  [GROUPE_TEST_NON_REALISE]: 'Test non réalisé',
};
const VARIANTE_PAR_GROUPE_STATUT_DOSSIER = {
  [GROUPE_TEST_NON_PLANIFIE]: 'rose',
  [GROUPE_TEST_PLANIFIE]: 'bleu',
  [GROUPE_TEST_REALISE]: 'violet',
  [GROUPE_TEST_NON_REALISE]: 'alerte',
};

// Code de groupe STABLE (pour le filtre, jamais affiché tel quel) — undefined pour tout code
// absent de GROUPE_STATUT_DOSSIER_PAR_CODE_ACCECIT (`valide`/`rejete` aujourd'hui, voir le
// commentaire d'en-tête ci-dessus) : ces dossiers n'appartiennent à AUCUN des 4 groupes filtrables,
// ils restent visibles sous "Tous" mais ne matchent aucun bouton de la nouvelle barre.
export function codeGroupeStatutDossier(rdv) {
  return GROUPE_STATUT_DOSSIER_PAR_CODE_ACCECIT[rdv.dossier_statut_code];
}
// Libellé/variante affichés dans la colonne "Statut" — fallback neutre sur le libellé BRUT du
// dossier (rdv.dossier_statut_libelle, jamais deviné) pour tout code sans groupe (voir ci-dessus).
export function libelleGroupeStatutDossier(rdv) {
  const groupe = codeGroupeStatutDossier(rdv);
  return groupe ? LIBELLE_PAR_GROUPE_STATUT_DOSSIER[groupe] : rdv.dossier_statut_libelle;
}
export function varianteGroupeStatutDossier(rdv) {
  const groupe = codeGroupeStatutDossier(rdv);
  return groupe ? VARIANTE_PAR_GROUPE_STATUT_DOSSIER[groupe] : 'neutre';
}

// Badge "Statut forcé manuellement" (audit 2026-09-22, dossiers #16/#54 : deux dossiers affichés
// "Test réalisé" sans qu'aucun rendez-vous n'ait jamais été honoré) — `rdv.statutForce` vient de
// rendezvousService.listerRendezvousTest (LEFT JOIN LATERAL vers le dernier journal_audit du
// dossier, voir rendezvousRepository.listerRendezvousTest) : `true` seulement quand le DERNIER
// changement de statut de ce dossier est passé par /forcer-statut (Admin, sans passer par une
// évaluation réelle), jamais pour un dossier arrivé au même statut par le parcours normal.
//
// Auteur affiché tel quel ("Prénom Nom"), sans repli "Système"/"-" : contrairement à
// listerHistoriqueRendezvousParDossiers (cree_par_prenom/nom, PanneauHistoriqueRendezvous.jsx),
// /forcer-statut est une action Admin authentifiée uniquement — jamais posée par un job
// automatique (voir workflowEngine.forcerStatut) —, donc utilisateur_id y est toujours renseigné en
// pratique ; un `null` resterait néanmoins un simple silence ci-dessous plutôt qu'un texte devinée.
export function libelleAuteurStatutForce(rdv) {
  const nomComplet = [rdv.statut_force_par_prenom, rdv.statut_force_par_nom].filter(Boolean).join(' ');
  return nomComplet || null;
}

// Infobulles de la colonne Statut/Rendez-vous : affichées au-dessus de la cellule par défaut,
// basculées en dessous quand la place manque en haut de l'écran (première ligne du tableau).
function positionnerInfobulle(evenement, selecteurBulle, classeEnDessous) {
  const conteneur = evenement.currentTarget;
  const bulle = conteneur.querySelector(selecteurBulle);
  if (!bulle) return;
  const MARGE_BULLE = 8;
  const rectConteneur = conteneur.getBoundingClientRect();
  const hauteurBulle = bulle.getBoundingClientRect().height;
  const espaceAuDessus = rectConteneur.top;
  const espaceEnDessous = window.innerHeight - rectConteneur.bottom;
  const basculerEnDessous = espaceAuDessus < hauteurBulle + MARGE_BULLE && espaceEnDessous > espaceAuDessus;
  conteneur.classList.toggle(classeEnDessous, basculerEnDessous);
}

export function positionnerInfobulleStatutForce(evenement) {
  positionnerInfobulle(evenement, '.planification__statut-force-infobulle', 'planification__statut-conteneur--infobulle-en-dessous');
}

export function positionnerInfobulleRdvClos(evenement) {
  positionnerInfobulle(evenement, '.planification__rdv-clos-infobulle', 'planification__rdv-conteneur--infobulle-en-dessous');
}

// Boutons de filtre par statut DOSSIER — même pattern que
// STATUTS_FILTRABLES_RENDEZVOUS ci-dessus, mais sur les groupes de haut niveau plutôt que sur
// rendezvous.statut. `valide`/`rejete` (fallback neutre, sans groupe) n'ont volontairement AUCUN
// bouton dédié ici : ils ne sont filtrables que via "Tous", comme n'importe quel code hors mapping.
// GROUPE_TEST_NON_PLANIFIE volontairement ABSENT de ce tableau (audit 2026-09-14, demande
// utilisateur) — mapping/libellé/variante (GROUPE_STATUT_DOSSIER_PAR_CODE_ACCECIT/
// LIBELLE_PAR_GROUPE_STATUT_DOSSIER/VARIANTE_PAR_GROUPE_STATUT_DOSSIER ci-dessus) INCHANGÉS, ce
// groupe reste affiché normalement dans la colonne "Statut" du tableau : seul son bouton de
// filtre disparaît de cette barre. Cet écran ne liste que des RENDEZ-VOUS, un dossier
// "Test non planifié" n'en a par définition aucun — le bouton afficherait donc toujours "(0)",
// quel que soit l'état réel de la base, laissant croire à tort à une absence de données plutôt
// qu'à une limite structurelle de cette page (candidat déjà couvert par "Dossiers candidats",
// TableauDeBordAccueil.jsx). "Tous" reste basé sur rendezvousParCandidatAvantStatutDossier.length,
// indépendant de ce tableau — son compteur total n'est donc pas affecté par ce retrait.
export const STATUTS_FILTRABLES_DOSSIER = [
  { code: GROUPE_TEST_PLANIFIE, libelle: 'Test planifié' },
  { code: GROUPE_TEST_REALISE, libelle: 'Test réalisé' },
  { code: GROUPE_TEST_NON_REALISE, libelle: 'Test non réalisé' },
];

// Barre "Secteur" (redesign 2026-09-28, demande utilisateur : "Une section avec soit tous, soit
// hôtellerie, soit tertiaire") — choix exclusif à 3 valeurs (Tous/Hôtellerie/Tertiaire), même
// composant FiltresStatut que les barres "Statut"/"Rendez-vous" juste à côté (voir leur rendu plus
// bas), plutôt que l'ancien FiltreEntite.jsx (deux boutons indépendamment activables, jamais
// d'option "Tous" propre) — remplace son usage spécifiquement sur CETTE page : FiltreEntite.jsx
// garde son comportement Set/multi-sélection inchangé pour ses autres appelants (Dossiers
// candidats/Suivi des formations/Backoffice), pas un composant partagé à modifier en profondeur
// pour un seul écran (voir Modularité, CLAUDE.md).
export const STATUTS_FILTRABLES_SECTEUR = [
  { code: 'hotel', libelle: 'Hôtellerie' },
  { code: 'bureau', libelle: 'Tertiaire' },
];

// Expérience (libellés, codes, couleurs, pastille) : module partagé core/dossier/BadgeExperience.jsx
//, commun à Dossiers candidats et Suivi des tests.

// Recherche élargie (nom/prénom du candidat, n° de dossier, poste(s) visé(s), nom du formateur,
// libellé du statut) — toutes les colonnes visibles du tableau (audit 2026-08-20, généralisation
// à toute l'app), filtrage entièrement client (comme aVenirSeulement/formateurFiltre sont eux filtrés côté back —
// voir listerRendezvousTest — cette recherche s'applique en plus, sur la liste déjà renvoyée par
// l'API, sans aller-retour serveur supplémentaire). Même approche que filtrerDossiers.js
// (core/dossier/filtrerDossiers.js, réutilisé tel quel par Dossiers candidats) : nom/prénom
// comparés mot par mot, insensible à l'ordre de saisie ("ETEST TEST" retrouve "TEST ETEST") ;
// poste comparé par simple inclusion. Dupliqué plutôt que partagé : `rdv` (rendez-vous +
// candidat + postes) n'a pas la même forme qu'un `dossier` de filtrerDossiers.js, et cette page
// n'a de toute façon pas de téléphone à chercher (absent de GET /api/dossiers/rendezvous).
//
// `rechercheEstNumeroDossier`/`rechercheEstNumerique` (audit 2026-08-19, même correctif que
// filtrerDossiers.js) : une saisie numérique courte ("91") ne doit viser QUE le n° de dossier, en
// égalité stricte — plus une simple inclusion, qui remontait aussi "191"/"912"/etc. Une saisie
// numérique longue (10 chiffres ou plus, forme téléphone) ne matche jamais rien ici : cette page
// n'a pas de téléphone à chercher, mieux vaut aucun résultat qu'un repli silencieux sur le nom.
//
// Formateur (colonne "Formateur") ajouté à la recherche élargie plutôt que réservé au seul
// sélecteur "Formateur" déjà présent (formateurFiltre, filtré côté back) : ce dernier exige de
// connaître le formateur à l'avance dans une liste déroulante, alors que taper son nom dans
// "Rechercher" retrouve directement ses rendez-vous, comme pour un candidat ou un poste. Même
// comparaison mot à mot que le nom du candidat (nomFormateur ci-dessous), pas une simple
// inclusion comme les postes : un formateur est une personne, comme le candidat, donc insensible
// à l'ordre de saisie ("Thomas Yamini" retrouve "Yamini Thomas") pour la même raison.
//
// Statut (colonne "Statut") ajouté à la recherche élargie — même principe que
// poste ci-dessus (simple inclusion sur le LIBELLÉ affiché, LIBELLES_STATUT[rdv.statut], jamais le
// code brut) : un agent tape "prévu" ou "annulé", pas "prevu"/"annule" (codes internes).
export function rechercheCorrespond(
  rdv,
  { motsRechercheNom, rechercheNormaliseeTexte, rechercheChiffresSeuls, rechercheEstNumerique, rechercheEstNumeroDossier },
) {
  if (rechercheEstNumeroDossier) {
    return String(rdv.dossier_id) === rechercheChiffresSeuls;
  }
  if (rechercheEstNumerique) {
    return false;
  }
  const nomComplet = normaliserTexte(`${rdv.candidat_prenom} ${rdv.candidat_nom}`.toLowerCase());
  const correspondNom = motsRechercheNom.every((mot) => nomComplet.includes(mot));
  const postes = normaliserTexte(
    [...(rdv.postesBureau ?? []), ...(rdv.postesHotel ?? [])]
      .map(libellePoste)
      .join(' ')
      .toLowerCase(),
  );
  const correspondPoste = postes.includes(rechercheNormaliseeTexte);
  const nomFormateur = normaliserTexte(`${rdv.formateur_prenom ?? ''} ${rdv.formateur_nom ?? ''}`.toLowerCase());
  const correspondFormateur = motsRechercheNom.every((mot) => nomFormateur.includes(mot));
  const statut = normaliserTexte(libelleAfficheRendezvous(rdv).toLowerCase());
  const correspondStatut = statut.includes(rechercheNormaliseeTexte);
  return correspondNom || correspondPoste || correspondFormateur || correspondStatut;
}

// "À venir" au sens de cette page : même définition que le filtre serveur aVenirSeulement
// (rendezvousRepository.listerRendezvousTest — date_heure future ET statut encore actif) —
// reprise ici pour choisir, parmi les rendez-vous d'un même candidat, celui à afficher sur sa
// ligne unique du tableau (voir rendezvousParCandidat plus bas) : le prochain rendez-vous à venir
// s'il y en a un, sinon le plus récent déjà passé (décision utilisateur).
export function estRendezvousAVenir(rdv) {
  return ['prevu', 'confirme'].includes(rdv.statut) && new Date(rdv.date_heure).getTime() >= Date.now();
}

// Une entrée par colonne triable, même patron que DossierList.jsx (core/dossier/DossierList.jsx)
// — "Candidat" trie sur candidats.nom (nom de famille), pas la chaîne "prénom nom" affichée.
// "Statut"/"Rendez-vous" trient sur le libellé affiché, plus lisible pour l'utilisateur qu'un tri
// sur le code brut ('absent' avant 'confirme' avant 'prevu'...).
//
// "Statut" (dossier) et "Rendez-vous" séparées en deux colonnes distinctes (audit 2026-09-13,
// demande utilisateur — avant cette date, une seule colonne "Statut" affichait le statut du
// RENDEZ-VOUS, jamais celui du dossier, absent de listerRendezvousTest jusqu'ici, voir le
// commentaire de STATUTS_REPLANIFIABLES plus haut ainsi que dossier_statut_code/
// dossier_statut_libelle désormais exposés par rendezvousRepository.listerRendezvousTest côté
// back) : "Statut" (dossier) positionnée AVANT "Rendez-vous", repère principal cohérent avec
// "Dossiers candidats" (TableauDeBordAccueil.jsx) ; "Rendez-vous" reprend l'affichage de
// l'ex-colonne "Statut" (libelleAfficheRendezvous/varianteAfficheeRendezvous) — seul son ancienne
// fusion visuelle Prévu+Confirmé sous "Test planifié" a depuis été retirée (audit 2026-09-14, voir
// leur commentaire d'en-tête), précisément PARCE que cette nouvelle colonne "Statut" reprend
// désormais le rôle qu'avait cette fusion. Les boutons de filtre par statut
// (STATUTS_FILTRABLES_RENDEZVOUS) continuent de porter sur rendezvous.statut (codeStatutAffiche),
// donc sur cette colonne "Rendez-vous", jamais sur "Statut" (dossier).
export const COLONNES = [
  { cle: 'candidat_nom', libelle: 'Candidat', extraire: (rdv) => (rdv.candidat_nom ?? '').toLowerCase() },
  // Colonne "Code postal" — même patron que "Poste"/"Expérience" juste
  // au-dessous (extrait du bloc 'coordonnees', voir rendezvousService.listerRendezvousTest),
  // positionnée juste après "Candidat", même cohérence que DossierList.jsx (Dossiers candidats).
  { cle: 'candidat_code_postal', libelle: 'Code postal', extraire: (rdv) => rdv.candidat_code_postal ?? '' },
  {
    cle: 'postes',
    libelle: 'Poste',
    extraire: (rdv) => [...(rdv.postesBureau ?? []), ...(rdv.postesHotel ?? [])].join(', '),
  },
  { cle: 'experience', libelle: 'Expérience', extraire: (rdv) => rdv.experience ?? '' },
  { cle: 'formateur_nom', libelle: 'Formateur', extraire: (rdv) => (rdv.formateur_nom ?? '').toLowerCase() },
  // "Statut" (statut du DOSSIER, regroupé en 4 valeurs — voir le commentaire d'en-tête de
  // GROUPE_STATUT_DOSSIER_PAR_CODE_ACCECIT) : trie sur le libellé de GROUPE affiché
  // (libelleGroupeStatutDossier), pas sur le statut brut — deux dossiers du même groupe
  // ("Inscrit"/"En attente de pièces", tous deux "Test non planifié") doivent trier ensemble,
  // pas se disperser selon leur libellé réel respectif.
  {
    cle: 'statut_dossier',
    libelle: 'Statut',
    extraire: (rdv) => libelleGroupeStatutDossier(rdv).toLowerCase(),
  },
  // "Rendez-vous" (statut du RENDEZ-VOUS, ex-colonne "Statut" — voir le commentaire d'en-tête de
  // ce tableau) : extraire()/libelleAfficheRendezvous inchangés, seuls `cle`/`libelle` changent.
  {
    cle: 'statut_rendezvous',
    libelle: 'Rendez-vous',
    extraire: (rdv) => libelleAfficheRendezvous(rdv).toLowerCase(),
  },
  // Déplacée après "Statut" (demande utilisateur) — plus la 1re colonne du tableau ni figée au
  // défilement (voir classeFigee plus bas) : seul le libellé change ("du test" ajouté, plus
  // ambigu une fois qu'elle n'est plus la première colonne visible). Le tri par défaut (voir `tri`
  // useState ci-dessous, toujours 'date_heure'/'asc') reste inchangé : `trierPar`/`rendezvousTries`
  // retrouvent cette colonne par sa `cle`, indépendamment de sa position dans ce tableau.
  { cle: 'date_heure', libelle: 'Date et heure du test', extraire: (rdv) => new Date(rdv.date_heure).getTime() },
];
