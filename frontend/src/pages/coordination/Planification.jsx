import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../../core/auth/useSession';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import IndicateurDefilementHorizontal from '../../core/backOffice/IndicateurDefilementHorizontal';
import StatutBadge from '../../core/workflow/StatutBadge';
import { normaliserTexte } from '../../core/filtres/normaliserTexte';
import { useParametreURL, useEnsembleURL } from '../../core/filtres/useParametreURL';
import FiltresStatut from '../../core/dossier/FiltresStatut';
import FiltreEntite from '../../core/dossier/FiltreEntite';
import FiltresRechercheDossiers from '../../core/dossier/FiltresRechercheDossiers';
import ModaleRelanceGroupee from '../../core/dossier/ModaleRelanceGroupee';
import ModaleReplanificationGroupee from '../../core/dossier/ModaleReplanificationGroupee';
import { listerRendezvousTest } from '../../services/rendezvousService';
import { listerFormateurs } from '../../services/formateurService';
import { obtenirDossier } from '../../services/dossierService';
import { useRafraichissementAuto } from '../../core/dossier/useRafraichissementAuto';
import PanneauHistoriqueRendezvous from './PanneauHistoriqueRendezvous';
import './Planification.css';

// Même seuil que TableauDeBordAccueil.jsx (Dossiers candidats, seuil abaissé à 1 le 2026-08-25) :
// la barre apparaît dès qu'un seul candidat est sélectionné.
const SEUIL_SELECTION_ACTIONS_GROUPEES = 1;

// Mêmes statuts que STATUTS_REPLANIFIABLES_ACCECIT (TableauDeBordAccueil.jsx, pages/recruteur/
// Validation.jsx, pages/coordination/Tests.jsx) — dupliqué ici plutôt que partagé (voir CLAUDE.md,
// conventions du projet) : sert à exclure de la replanification groupée les dossiers qui n'ont
// encore jamais eu de test planifié (nouveau/en_attente_pieces/test_non_planifie) ET ceux dont le
// test a eu lieu mais n'a pas encore de verdict (test_realise, pas de transition
// replanifier_test depuis ce statut dans workflow.config.json — il faut d'abord un verdict avant
// de pouvoir reprogrammer). Un dossier sélectionné sur CET écran peut très bien avoir déjà quitté
// ces statuts depuis (ex. verdict rendu entretemps, ou ligne affichée hors "À venir uniquement") —
// d'où la vérification fraîche via obtenirDossier au clic sur "Replanifier des tests", voir
// ouvrirReplanificationGroupee plus bas : dossier_statut_code (colonne "Statut", audit 2026-09-13)
// est désormais bien présent sur les rendez-vous chargés ici (listerRendezvousTest), mais reste un
// instantané pris au CHARGEMENT de la page — contrairement à TableauDeBordAccueil.jsx (re-fetch
// complet des dossiers à chaque filtre), rien ne le rafraîchit entre-temps hors polling
// (useRafraichissementAuto), d'où cette vérification dédiée au clic plutôt qu'une simple lecture
// de rdv.dossier_statut_code déjà en mémoire.
const STATUTS_REPLANIFIABLES_ACCECIT = [
  'test_planifie',
  'test_non_realise',
  'invalide',
  'valide_envoi_formation',
  'valide_pret_embauche',
];

const FORMAT_DATE_HEURE = new Intl.DateTimeFormat('fr-FR', {
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
// RETIRÉE (audit 2026-09-14, décision utilisateur) : la colonne "Statut" (dossier, ajoutée depuis,
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
// Bloc 2 (audit 2026-09-23) : un rendez-vous 'annule' par workflowEngine.forcerStatut (Admin, hors
// parcours normal) porte ce motif système, jamais choisi par un agent (voir
// scripts/seedMotifNeutraliseParForcage.js, categorie 'systeme') — distinct visuellement d'une VRAIE
// annulation candidat, même statut brut en base. Le filtre "Annulé" (STATUTS_FILTRABLES_RENDEZVOUS
// plus bas) reste UNIQUE et continue de les inclure (décision utilisateur explicite) : seuls le
// libellé et la couleur du badge changent, jamais le code de statut ni un filtre séparé.
const CODE_MOTIF_NEUTRALISE_PAR_FORCAGE = 'neutralise_par_forcage';
function rendezvousAnnuleParForcage(rdv) {
  return rdv.statut === 'annule' && rdv.motif_code === CODE_MOTIF_NEUTRALISE_PAR_FORCAGE;
}

function libelleAfficheRendezvous(rdv) {
  if (rendezvousAnnuleParForcage(rdv)) return 'Annulé (forçage)';
  return LIBELLES_STATUT[rdv.statut] ?? rdv.statut;
}
function varianteAfficheeRendezvous(rdv) {
  // 'neutre-fort' (gris) plutôt que 'echec' (rouge, désistement candidat) : ce badge ne signale pas
  // un désistement, seulement un forçage administratif — même famille de couleur que le badge
  // "Remplacé" (varianteStatutRendezvous ci-dessus), pas une nouvelle teinte inventée pour ce cas.
  if (rendezvousAnnuleParForcage(rdv)) return 'neutre-fort';
  return varianteStatutRendezvous(rdv.statut);
}

// Badge "Dossier clos" (audit 2026-09-23) : signale qu'un rendez-vous encore 'prevu'/'confirme'
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
function rendezvousDossierClos(rdv) {
  return ['prevu', 'confirme'].includes(rdv.statut) && rdv.dossier_statut_code !== STATUT_DOSSIER_RENDEZVOUS_ACTIONNABLE_ACCECIT;
}

// Texte du tooltip natif du marqueur "Dossier clos" ci-dessus — même formule que
// PanneauHistoriqueRendezvous.jsx (décision utilisateur du 2026-09-23), tiret simple (pas de tiret
// cadratin). `dossier_statut_libelle` vient de rendezvousService.listerRendezvousTest, jamais un
// libellé en dur ici (voir Modularité, CLAUDE.md). `rdv.statut_force_le` réutilisé tel quel — ce
// champ porte en réalité la date du DERNIER changement de statut du dossier, quelle qu'en soit la
// cause (voir rendezvousRepository.listerRendezvousTest, LEFT JOIN LATERAL vers journal_audit),
// jamais uniquement celle d'un forçage admin malgré son nom : déjà sélectionné pour toute ligne,
// pas seulement quand rdv.statutForce est vrai, donc réutilisable ici sans aller-retour backend
// supplémentaire.
function tooltipDossierClos(rdv) {
  const date = rdv.statut_force_le ? new Date(rdv.statut_force_le) : null;
  const quand = date ? ` le ${FORMAT_DATE.format(date)} à ${FORMAT_HEURE.format(date)}` : '';
  return `Dossier déjà clôturé (${rdv.dossier_statut_libelle})${quand} - ce rendez-vous n'est plus actionnable.`;
}

// Code STABLE du statut AFFICHÉ (colonne "Statut"), pour les boutons de filtre ci-dessous — jamais
// le libellé français de libelleAfficheRendezvous ci-dessus (locale-dépendant, pas fait pour être
// comparé). Simple passe-plat vers rdv.statut désormais (voir commentaire ci-dessus) : plus de
// dérivation 'non_realise' qui n'a jamais existé côté rendezvous.statut.
function codeStatutAffiche(rdv) {
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
const STATUTS_FILTRABLES_RENDEZVOUS = [
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
function codeGroupeStatutDossier(rdv) {
  return GROUPE_STATUT_DOSSIER_PAR_CODE_ACCECIT[rdv.dossier_statut_code];
}
// Libellé/variante affichés dans la colonne "Statut" — fallback neutre sur le libellé BRUT du
// dossier (rdv.dossier_statut_libelle, jamais deviné) pour tout code sans groupe (voir ci-dessus).
function libelleGroupeStatutDossier(rdv) {
  const groupe = codeGroupeStatutDossier(rdv);
  return groupe ? LIBELLE_PAR_GROUPE_STATUT_DOSSIER[groupe] : rdv.dossier_statut_libelle;
}
function varianteGroupeStatutDossier(rdv) {
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
function libelleAuteurStatutForce(rdv) {
  const nomComplet = [rdv.statut_force_par_prenom, rdv.statut_force_par_nom].filter(Boolean).join(' ');
  return nomComplet || null;
}

// Même mécanique de bascule au-dessus/en dessous que positionnerInfobulleStatut
// (core/dossier/DossierList.jsx, "Dossiers candidats") — dupliquée ici plutôt que partagée (voir
// CLAUDE.md, conventions du projet) : DossierList.jsx ne l'exporte pas, et cette page a son propre
// nom de classe/structure d'infobulle (plus riche : titre/date-auteur/commentaire, pas une simple
// liste de lignes — voir son commentaire d'en-tête dans le rendu, plus bas). Voir le commentaire de
// positionnerInfobulleStatut pour le détail du raisonnement (measure-on-hover, DOM direct plutôt
// qu'un état React).
function positionnerInfobulleStatutForce(evenement) {
  const conteneur = evenement.currentTarget;
  const bulle = conteneur.querySelector('.planification__statut-force-infobulle');
  if (!bulle) return;
  const MARGE_BULLE = 8;
  const rectConteneur = conteneur.getBoundingClientRect();
  const hauteurBulle = bulle.getBoundingClientRect().height;
  const espaceAuDessus = rectConteneur.top;
  const espaceEnDessous = window.innerHeight - rectConteneur.bottom;
  const basculerEnDessous = espaceAuDessus < hauteurBulle + MARGE_BULLE && espaceEnDessous > espaceAuDessus;
  conteneur.classList.toggle('planification__statut-conteneur--infobulle-en-dessous', basculerEnDessous);
}

// Même mécanique que positionnerInfobulleStatutForce ci-dessus, dupliquée pour le badge "Dossier
// déjà clôturé" (colonne "Rendez-vous", voir rendezvousDossierClos) — classes dédiées
// (.planification__rdv-conteneur/-clos-infobulle), jamais celles du badge forcé : les deux peuvent
// apparaître sur la même ligne (colonnes différentes), chacun doit se positionner indépendamment.
function positionnerInfobulleRdvClos(evenement) {
  const conteneur = evenement.currentTarget;
  const bulle = conteneur.querySelector('.planification__rdv-clos-infobulle');
  if (!bulle) return;
  const MARGE_BULLE = 8;
  const rectConteneur = conteneur.getBoundingClientRect();
  const hauteurBulle = bulle.getBoundingClientRect().height;
  const espaceAuDessus = rectConteneur.top;
  const espaceEnDessous = window.innerHeight - rectConteneur.bottom;
  const basculerEnDessous = espaceAuDessus < hauteurBulle + MARGE_BULLE && espaceEnDessous > espaceAuDessus;
  conteneur.classList.toggle('planification__rdv-conteneur--infobulle-en-dessous', basculerEnDessous);
}

// Boutons de filtre par statut DOSSIER (audit 2026-09-13, demande utilisateur) — même pattern que
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
const STATUTS_FILTRABLES_DOSSIER = [
  { code: GROUPE_TEST_PLANIFIE, libelle: 'Test planifié' },
  { code: GROUPE_TEST_REALISE, libelle: 'Test réalisé' },
  { code: GROUPE_TEST_NON_REALISE, libelle: 'Test non réalisé' },
];

// Libellés des postes (colonne "Poste") — même mapping que TableauDeBordAccueil.jsx/Backoffice.jsx,
// dupliqué plutôt que partagé (voir CLAUDE.md conventions du projet).
const LIBELLES_POSTE_PAR_CODE_ACCECIT = {
  nettoyage: 'Nettoyage',
  vitrerie: 'Vitrerie',
  machiniste: 'Machiniste',
  chef_equipe: "Chef d'équipe",
  autres: 'Autres',
  femme_valet_chambre: 'Femme/Valet de chambre',
  cafetier: 'Cafétier(ère)',
  equipier: 'Équipier(ère)',
  gouvernant: 'Gouvernant(e)',
};
function libellePoste(code) {
  return LIBELLES_POSTE_PAR_CODE_ACCECIT[code] ?? code;
}

// Libellés/options du filtre + colonne "Expérience" (audit 2026-09-02) — mêmes codes que
// BlocDisponibilites.jsx (formulaire d'inscription), dupliqués plutôt que partagés (même
// convention que LIBELLES_POSTE_PAR_CODE_ACCECIT ci-dessus).
const LIBELLES_EXPERIENCE_PAR_CODE_ACCECIT = {
  aucune: "Pas d'expérience",
  plus_6_mois: 'Plus de 6 mois',
  plus_2_ans: 'Plus de 2 ans',
  plus_5_ans: 'Plus de 5 ans',
};
const CODES_EXPERIENCE_ACCECIT = ['aucune', 'plus_6_mois', 'plus_2_ans', 'plus_5_ans'];
function libelleExperience(code) {
  if (!code) return '-';
  return LIBELLES_EXPERIENCE_PAR_CODE_ACCECIT[code] ?? code;
}

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
// Statut (colonne "Statut") ajouté à la recherche élargie (audit 2026-08-20) — même principe que
// poste ci-dessus (simple inclusion sur le LIBELLÉ affiché, LIBELLES_STATUT[rdv.statut], jamais le
// code brut) : un agent tape "prévu" ou "annulé", pas "prevu"/"annule" (codes internes).
function rechercheCorrespond(
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
function estRendezvousAVenir(rdv) {
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
// commentaire de STATUTS_REPLANIFIABLES_ACCECIT plus haut ainsi que dossier_statut_code/
// dossier_statut_libelle désormais exposés par rendezvousRepository.listerRendezvousTest côté
// back) : "Statut" (dossier) positionnée AVANT "Rendez-vous", repère principal cohérent avec
// "Dossiers candidats" (TableauDeBordAccueil.jsx) ; "Rendez-vous" reprend l'affichage de
// l'ex-colonne "Statut" (libelleAfficheRendezvous/varianteAfficheeRendezvous) — seul son ancienne
// fusion visuelle Prévu+Confirmé sous "Test planifié" a depuis été retirée (audit 2026-09-14, voir
// leur commentaire d'en-tête), précisément PARCE que cette nouvelle colonne "Statut" reprend
// désormais le rôle qu'avait cette fusion. Les boutons de filtre par statut
// (STATUTS_FILTRABLES_RENDEZVOUS) continuent de porter sur rendezvous.statut (codeStatutAffiche),
// donc sur cette colonne "Rendez-vous", jamais sur "Statut" (dossier).
const COLONNES = [
  { cle: 'candidat_nom', libelle: 'Candidat', extraire: (rdv) => (rdv.candidat_nom ?? '').toLowerCase() },
  // Colonne "Code postal" (audit 2026-09-09) — même patron que "Poste"/"Expérience" juste
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

// Vue d'ensemble des rendez-vous de test côté Coordination (CLAUDE.md, besoin Accueil/
// Coordination : "planifie les tests") — tous dossiers confondus, contrairement à
// GestionRendezvous.jsx qui reste scopé à un seul dossier. Ne crée ni ne modifie aucun
// rendez-vous ici : chaque ligne renvoie vers la page du dossier concerné
// (/coordination/dossiers/:id/relances, où vit déjà GestionRendezvous) pour agir dessus.
// Une ligne par candidat, pas par rendez-vous (voir rendezvousParCandidat) : le détail complet
// des tentatives d'un candidat reste consultable via "Voir l'historique des rendez-vous
// sélectionnés" (PanneauHistoriqueRendezvous.jsx), inchangé par ce regroupement.
export default function Planification() {
  const { utilisateur, chargement: chargementSession } = useSession();
  const navigate = useNavigate();

  // Formateur/Inspecteur (audit 2026-08-20, accès étendu à cette page) : ne voient QUE leurs
  // propres rendez-vous assignés (restriction posée côté serveur, voir dossiers.routes.js —
  // formateurId y est forcé à req.utilisateur.id pour ces deux rôles, quoi qu'envoie le client).
  // Cette constante ne pilote donc ici que des masquages d'AFFICHAGE cohérents avec cette
  // restriction déjà acquise côté back, jamais la restriction elle-même : le sélecteur
  // "Formateur" n'a plus de sens pour un compte qui ne voit déjà que ses propres rendez-vous
  // (point 4 de la demande), et la sélection multi-candidats/"Voir l'historique..." reste hors
  // périmètre pour ces deux rôles (accès à /coordination/dossiers/:id/relances non accordé côté
  // back pour Formateur/Inspecteur — rendezvous.routes.js/relances.routes.js restent réservés à
  // Accueil/Coordination/Recruteur/Admin, décision volontairement non étendue ici).
  const estFormateurOuInspecteur = ['formateur', 'inspecteur'].includes(utilisateur?.roleCode);

  const [rendezvous, setRendezvous] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);

  // Filtres persistés dans l'URL (query params), même mécanisme que TableauDeBordAccueil.jsx —
  // voir useParametreURL.js (CLAUDE.md, cohérence entre pages de filtres similaires). `a_venir`
  // sérialisé en '1'/'0' plutôt qu'un booléen natif (les query params sont toujours des chaînes) ;
  // '1' est la valeur par défaut donc jamais écrite dans l'URL (voir useParametreURL.js).
  const [aVenirBrut, setAVenirBrut] = useParametreURL('a_venir', '1');
  const aVenirSeulement = aVenirBrut !== '0';
  const setAVenirSeulement = (valeur) => setAVenirBrut(valeur ? '1' : '0');
  const [formateurFiltre, setFormateurFiltre] = useParametreURL('formateur', ''); // '' = tous les formateurs
  const [formateurs, setFormateurs] = useState([]);
  // Recherche élargie (nom/prénom, n° dossier, poste, formateur, statut) — voir rechercheCorrespond
  // ci-dessus.
  const [recherche, setRecherche] = useParametreURL('q', '');
  // Filtre "Code postal" (demande utilisateur d'harmonisation avec Dossiers candidats, audit
  // 2026-09-11) — même paramètre d'URL/comportement "commence par" que TableauDeBordAccueil.jsx,
  // porté par FiltresRechercheDossiers.jsx (core/dossier/, même composant partagé). Filtrage
  // entièrement client (rdv.candidat_code_postal déjà présent sur chaque rendez-vous renvoyé par
  // GET /api/dossiers/rendezvous, voir listerRendezvousTest/rendezvousService), même mécanisme que
  // recherche/dateDebutFiltre/dateFinFiltre ci-dessous.
  const [codePostalFiltre, setCodePostalFiltre] = useParametreURL('codePostal', '');
  // Plage de date sur rdv.date_heure (colonne "Date et heure"), mêmes noms de paramètre URL que
  // TableauDeBordAccueil.jsx (date_debut/date_fin) — portée par FiltresRechercheDossiers.jsx
  // (core/dossier/, même composant partagé que Dossiers candidats, voir son rendu plus bas) ;
  // seule la donnée filtrée diffère (date du rendez-vous ici, date de dernière mise à jour du
  // dossier là-bas). Filtrage entièrement client, comme `recherche` ci-dessus (voir
  // rendezvousFiltres plus bas) — se combine donc en ET avec aVenirSeulement/formateurFiltre
  // (filtres serveur) sans logique de composition dédiée : cette plage ne fait que restreindre
  // davantage la liste déjà renvoyée par l'API.
  const [dateDebutFiltre, setDateDebutFiltre] = useParametreURL('date_debut', '');
  const [dateFinFiltre, setDateFinFiltre] = useParametreURL('date_fin', '');

  // Filtre par statut de RENDEZ-VOUS affiché, colonne "Rendez-vous" (voir codeStatutAffiche/
  // STATUTS_FILTRABLES_RENDEZVOUS ci-dessus) — même sentinelle 'tous' que SuiviFormation.jsx
  // (statutRdvFiltre === null se traduirait en absence de paramètre dans l'URL via
  // useParametreURL, indiscernable de la valeur par défaut ; ici sans incidence puisque le défaut
  // EST déjà "Tous"/null, gardé malgré tout pour rester cohérent avec le seul autre appelant de
  // FiltresStatut qui persiste son filtre dans l'URL).
  // Filtrage entièrement client (voir rendezvousParCandidatFiltres plus bas), sur la liste déjà
  // groupée par candidat — pas les filtres serveur (aVenirSeulement/formateurFiltre) : une
  // combinaison qui n'a pas de sens (ex. "À venir uniquement" + "Réalisé") ne renvoie simplement
  // aucun résultat plutôt que d'être bloquée en amont, exactement comme n'importe quelle autre
  // combinaison de filtres vide ailleurs dans l'app (voir compteursParStatutRdv ci-dessous, qui
  // affiche fidèlement "(0)" dans ce cas plutôt que de masquer le bouton).
  // Paramètre URL 'statut_rdv' (renommé depuis 'statut', audit 2026-09-13) — pour ne jamais se
  // confondre avec le nouveau 'statut_dossier' ci-dessous (deux filtres distincts, colonnes
  // distinctes "Rendez-vous"/"Statut" : partager la même clé d'URL aurait mélangé silencieusement
  // les deux si l'un écrasait l'autre, ou pire, appliqué la valeur du mauvais filtre à l'autre
  // colonne au chargement d'un lien partagé/mis en favori).
  const [statutRdvFiltreBrut, setStatutRdvFiltreBrut] = useParametreURL('statut_rdv', 'tous');
  const statutRdvFiltre = statutRdvFiltreBrut === 'tous' ? null : statutRdvFiltreBrut;
  const setStatutRdvFiltre = (valeur) => setStatutRdvFiltreBrut(valeur === null ? 'tous' : valeur);

  // Filtre par statut de DOSSIER regroupé (colonne "Statut", audit 2026-09-13, demande
  // utilisateur) — même mécanisme/sentinelle 'tous' que statutRdvFiltre ci-dessus, sur les 4
  // groupes de STATUTS_FILTRABLES_DOSSIER plutôt que sur rendezvous.statut. Paramètre URL
  // 'statut_dossier', distinct de 'statut_rdv' (voir son commentaire juste au-dessus).
  const [statutDossierFiltreBrut, setStatutDossierFiltreBrut] = useParametreURL('statut_dossier', 'tous');
  const statutDossierFiltre = statutDossierFiltreBrut === 'tous' ? null : statutDossierFiltreBrut;
  const setStatutDossierFiltre = (valeur) => setStatutDossierFiltreBrut(valeur === null ? 'tous' : valeur);

  // Filtre "Expérience" (audit 2026-09-02) — même mécanisme <select> que "Formateur" ci-dessus,
  // filtrage entièrement client (comme statutRdvFiltre/statutDossierFiltre). '' = toutes les
  // tranches confondues.
  const [experienceFiltre, setExperienceFiltre] = useParametreURL('experience', '');

  // Filtre "Entité" (Hôtellerie/Tertiaire, demande utilisateur) — même composant/mécanisme que
  // TableauDeBordAccueil.jsx (Dossiers candidats, voir FiltreEntite.jsx) : deux boutons
  // indépendamment activables, jamais d'option "Toutes" dédiée (ferait doublon avec "Tous", déjà
  // porté par FiltresStatut ci-dessous), Set vide = aucune restriction. Filtrage entièrement
  // client (rdv.postesHotel/postesBureau déjà présents sur chaque rendez-vous renvoyé par
  // GET /api/dossiers/rendezvous, voir listerRendezvousTest), même mécanisme que
  // recherche/dateDebutFiltre/dateFinFiltre ci-dessus.
  const [entitesFiltre, basculerEntiteFiltre] = useEnsembleURL('entites');

  // Tri entièrement client sur la liste déjà reçue (GET /api/dossiers/rendezvous ne pagine pas,
  // voir rendezvousRepository.listerRendezvousTest) — même choix que DossierList.jsx. Défaut =
  // date et heure croissantes (comportement historique de cette page, prochain rendez-vous en
  // premier), préservé tant qu'aucun en-tête n'a été cliqué.
  const [tri, setTri] = useState({ colonne: 'date_heure', ordre: 'asc' });

  // Sélection de candidats (case à cocher, une par ligne) — indexée sur dossier_id, pas
  // rendezvous.id : un candidat n'a qu'un seul dossier, "sélectionner ce candidat" a donc un sens
  // stable indépendamment du rendez-vous affiché sur sa ligne (voir rendezvousParCandidat plus
  // bas — une seule ligne par dossier_id désormais, ce Set était déjà dossier_id-keyed avant ce
  // changement, donc déjà "un candidat = une sélection" même quand plusieurs lignes de
  // rendez-vous du même dossier apparaissaient). Volontairement PAS réinitialisée quand le filtre
  // ou le tri changent (voir dossierIdsVisibles ci-dessous, recalculé à chaque rendu) : un agent
  // qui change de filtre pour regarder autre chose ne doit pas perdre une sélection déjà faite.
  const [dossiersSelectionnes, setDossiersSelectionnes] = useState(new Set());
  const [panneauHistoriqueOuvert, setPanneauHistoriqueOuvert] = useState(false);
  // Figé au moment du clic sur "Voir l'historique..." (voir PanneauHistoriqueRendezvous.jsx,
  // dossierIds ne se recalcule pas après ouverture) — décocher un candidat pendant que le panneau
  // est déjà ouvert n'en fait donc pas disparaître l'historique tant que l'agent ne rouvre pas.
  const [dossierIdsHistorique, setDossierIdsHistorique] = useState([]);
  // Incrémenté à chaque clic sur "Voir l'historique..." (voir ouvrirHistorique), posé comme `key`
  // sur <PanneauHistoriqueRendezvous> plus bas — force React à démonter/remonter ce composant à
  // chaque clic, même si le panneau était déjà ouvert sur une sélection différente : dossierIds
  // étant figé à l'ouverture (voir son commentaire d'en-tête), un simple changement de prop sans
  // remontage ne relançait ni le chargement des données ni le scrollIntoView interne du panneau
  // (tous deux dans des useEffect à dépendances vides, déclenchés une seule fois au montage).
  // Remonter le composant réutilise ces deux effets existants tels quels, sans y toucher.
  const [compteurHistorique, setCompteurHistorique] = useState(0);

  // Actions groupées "Relances"/"Replanifier des tests" (demande utilisateur, même composant/
  // logique que TableauDeBordAccueil.jsx — voir ModaleRelanceGroupee.jsx/
  // ModaleReplanificationGroupee.jsx, réutilisés tels quels) — 'relance' | 'replanification' | null.
  // Pas "Export des pièces" ici : hors sujet sur un écran de rendez-vous de test (demande
  // utilisateur), voir le rendu de la barre plus bas.
  const [modaleGroupeeOuverte, setModaleGroupeeOuverte] = useState(null);
  // Vérification asynchrone avant d'ouvrir la modale de replanification (voir
  // ouvrirReplanificationGroupee plus bas) — même patron que lancerExportPieces
  // (TableauDeBordAccueil.jsx) : dossier_statut_code est désormais présent sur les rendez-vous déjà
  // en mémoire ici (colonne "Statut", audit 2026-09-13), mais reste un instantané pris au
  // chargement de la page (voir le commentaire de STATUTS_REPLANIFIABLES_ACCECIT ci-dessus) — il
  // faut donc quand même l'aller rechercher au clic pour savoir quels dossiers sélectionnés sont
  // RÉELLEMENT éligibles à cet instant précis.
  const [verificationReplanificationEnCours, setVerificationReplanificationEnCours] = useState(false);
  const [erreurVerificationReplanification, setErreurVerificationReplanification] = useState(null);
  const [dossiersEligiblesReplanification, setDossiersEligiblesReplanification] = useState([]);
  const [dossiersExclusReplanification, setDossiersExclusReplanification] = useState([]);

  useEffect(() => {
    // Sélecteur "Formateur" masqué pour Formateur/Inspecteur (voir estFormateurOuInspecteur
    // ci-dessus) : inutile d'appeler une route que ces deux rôles n'ont de toute façon pas le
    // droit d'interroger (formateurs.routes.js reste réservé à Accueil/Coordination/Recruteur/
    // Admin, décision volontairement non étendue ici). Attend la résolution de la session
    // (chargementSession) avant de décider : au tout premier rendu, utilisateur est encore null
    // et estFormateurOuInspecteur vaut donc faussement `false` (roleCode indéfini) — sans cette
    // garde, l'appel partait une première fois avant que le rôle réel ne soit connu, provoquant
    // un aller-retour 403 inutile pour un compte Formateur/Inspecteur avant que l'effet ne se
    // redéclenche correctement une fois la session chargée.
    if (chargementSession || estFormateurOuInspecteur) return;
    listerFormateurs()
      .then(setFormateurs)
      .catch(() => {
        // Filtre non critique : la liste de rendez-vous reste consultable sans lui, seul le
        // sélecteur "Formateur" resterait vide.
      });
  }, [chargementSession, estFormateurOuInspecteur]);

  useEffect(() => {
    let annule = false;
    setChargement(true);
    setErreur(null);
    listerRendezvousTest({ aVenir: aVenirSeulement, formateurId: formateurFiltre || undefined })
      .then((valeur) => {
        if (!annule) setRendezvous(valeur);
      })
      .catch((erreur) => {
        if (!annule) setErreur(erreur.response?.data?.erreur ?? 'Impossible de récupérer les rendez-vous de test.');
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, [aVenirSeulement, formateurFiltre]);

  // Rafraîchissement automatique (audit 2026-08-24) : rejoue le fetch ci-dessus avec les filtres
  // COURANTS (fermeture sur aVenirSeulement/formateurFiltre, toujours à jour via callbackRef, voir
  // useRafraichissementAuto.js), silencieusement — jamais chargement/erreur, réservés au
  // chargement initial.
  useRafraichissementAuto(() => {
    listerRendezvousTest({ aVenir: aVenirSeulement, formateurId: formateurFiltre || undefined })
      .then(setRendezvous)
      .catch(() => {});
  });

  // Filtrage client élargi (nom/prénom, n° dossier, poste, formateur, statut — voir
  // rechercheCorrespond) + plage de date sur rdv.date_heure (dateDebutFiltre/dateFinFiltre), appliqués en plus des filtres serveur
  // (aVenirSeulement/formateurFiltre, voir l'effet ci-dessus) sur la liste déjà reçue — se combine
  // donc naturellement avec eux sans logique de composition supplémentaire (ET logique) : moins de
  // résultats servis par le back à filtrer davantage ici, jamais l'inverse. Même découpage
  // recherche/motsRecherche que filtrerDossiers.js ; mêmes bornes en heure locale que
  // filtrerDossiers.js pour la plage de date (dateDebutFiltre/dateFinFiltre viennent d'un
  // <input type="date"> et représentent des jours calendaires tels que l'agent les lit sur la
  // tablette, pas des instants UTC).
  const rendezvousFiltres = useMemo(() => {
    const rechercheNormalisee = recherche.trim().toLowerCase();
    const rechercheNormaliseeTexte = normaliserTexte(rechercheNormalisee);
    const motsRechercheNom = rechercheNormalisee.split(/\s+/).filter(Boolean).map(normaliserTexte);
    // Saisie strictement numérique (chiffres seuls, espaces/tirets de formatage ignorés) — voir
    // rechercheCorrespond ci-dessus pour ce que ces deux booléens changent.
    const rechercheChiffresSeuls = rechercheNormalisee.replace(/[\s-]/g, '');
    const rechercheEstNumerique = rechercheChiffresSeuls.length > 0 && /^\d+$/.test(rechercheChiffresSeuls);
    const rechercheEstNumeroDossier = rechercheEstNumerique && rechercheChiffresSeuls.length < 10;
    const debut = dateDebutFiltre ? new Date(`${dateDebutFiltre}T00:00:00`) : null;
    const fin = dateFinFiltre ? new Date(`${dateFinFiltre}T23:59:59.999`) : null;
    // "Commence par", null-safe — même comportement que filtrerDossiers.js/TableauDeBordAccueil.jsx
    // (Dossiers candidats), champ séparé de la recherche générale `recherche` ci-dessus.
    const codePostalFiltreNormalise = (codePostalFiltre ?? '').trim();
    return rendezvous.filter((rdv) => {
      if (debut || fin) {
        const dateRdv = new Date(rdv.date_heure);
        if (debut && dateRdv < debut) return false;
        if (fin && dateRdv > fin) return false;
      }
      if (codePostalFiltreNormalise && !(rdv.candidat_code_postal ?? '').startsWith(codePostalFiltreNormalise)) {
        return false;
      }
      if (motsRechercheNom.length === 0) return true;
      return rechercheCorrespond(rdv, {
        motsRechercheNom,
        rechercheNormaliseeTexte,
        rechercheChiffresSeuls,
        rechercheEstNumerique,
        rechercheEstNumeroDossier,
      });
    });
  }, [rendezvous, recherche, codePostalFiltre, dateDebutFiltre, dateFinFiltre]);

  // Une ligne par candidat (dossier_id), pas par rendez-vous (décision utilisateur) : un candidat
  // avec plusieurs tentatives de test (replanifications, absences...) n'apparaissait jusqu'ici
  // qu'en autant de lignes que de rendez-vous, ce tableau devenant illisible pour un candidat
  // souvent replanifié — le détail complet de ses tentatives reste consultable via "Voir
  // l'historique des rendez-vous sélectionnés" ci-dessous (PanneauHistoriqueRendezvous.jsx,
  // inchangé, déjà groupé par candidat). Rendez-vous représentatif choisi par candidat : le
  // prochain à venir s'il y en a un (estRendezvousAVenir), sinon le plus récent par date_heure —
  // c'est cette seule ligne qui alimente Poste/Formateur/Statut affichés, comme n'importe quelle
  // ligne de rendez-vous unique avant ce changement.
  const rendezvousParCandidat = useMemo(() => {
    const parDossier = new Map();
    for (const rdv of rendezvousFiltres) {
      if (!parDossier.has(rdv.dossier_id)) parDossier.set(rdv.dossier_id, []);
      parDossier.get(rdv.dossier_id).push(rdv);
    }
    return [...parDossier.values()].map((rdvsDuCandidat) => {
      const aVenir = rdvsDuCandidat.filter(estRendezvousAVenir);
      if (aVenir.length > 0) {
        // Le PROCHAIN à venir (date la plus proche), pas le plus lointain.
        return aVenir.reduce((lePlusProche, rdv) => (new Date(rdv.date_heure) < new Date(lePlusProche.date_heure) ? rdv : lePlusProche));
      }
      // Aucun rendez-vous à venir : le plus récent par date_heure, quel que soit son statut.
      return rdvsDuCandidat.reduce((lePlusRecent, rdv) => (new Date(rdv.date_heure) > new Date(lePlusRecent.date_heure) ? rdv : lePlusRecent));
    });
  }, [rendezvousFiltres]);

  // Compteurs des boutons "Hôtellerie"/"Tertiaire" (demande utilisateur, même principe que
  // compteurHotel/compteurBureau sur TableauDeBordAccueil.jsx) : calculés sur rendezvousParCandidat
  // (recherche/plage de date/aVenirSeulement/formateurFiltre déjà appliqués, voir son commentaire
  // ci-dessus), AVANT le filtre entité lui-même — chaque bouton doit répondre à "combien de
  // candidats si je clique CE bouton", indépendamment de l'état actuel de entitesFiltre — mais
  // statut(rendez-vous)/statut(dossier)/expérience réappliqués manuellement ici (comme sur
  // TableauDeBordAccueil.jsx) pour que ces deux compteurs reflètent malgré tout les AUTRES filtres
  // déjà actifs, conformément à la liste actuellement affichée sur cet écran. statutDossierFiltre
  // ajouté ici (audit 2026-09-13, nouvelle barre de filtres "Statut") au même titre que
  // statutRdvFiltre, déjà présent avant cet ajout.
  const compteurHotel = useMemo(
    () =>
      rendezvousParCandidat.filter(
        (rdv) =>
          (!statutRdvFiltre || codeStatutAffiche(rdv) === statutRdvFiltre) &&
          (!statutDossierFiltre || codeGroupeStatutDossier(rdv) === statutDossierFiltre) &&
          (!experienceFiltre || rdv.experience === experienceFiltre) &&
          (rdv.postesHotel ?? []).length > 0,
      ).length,
    [rendezvousParCandidat, statutRdvFiltre, statutDossierFiltre, experienceFiltre],
  );
  const compteurBureau = useMemo(
    () =>
      rendezvousParCandidat.filter(
        (rdv) =>
          (!statutRdvFiltre || codeStatutAffiche(rdv) === statutRdvFiltre) &&
          (!statutDossierFiltre || codeGroupeStatutDossier(rdv) === statutDossierFiltre) &&
          (!experienceFiltre || rdv.experience === experienceFiltre) &&
          (rdv.postesBureau ?? []).length > 0,
      ).length,
    [rendezvousParCandidat, statutRdvFiltre, statutDossierFiltre, experienceFiltre],
  );

  // Filtre entité appliqué juste après le regroupement par candidat (même position que
  // dossiersFiltresBase sur TableauDeBordAccueil.jsx) : tout ce qui suit (compteurs de statut/
  // expérience, liste triée) reflète donc déjà l'entité sélectionnée, seuls les DEUX compteurs
  // ci-dessus l'ignorent délibérément (voir leur commentaire). Set vide = aucune restriction,
  // mêmes deux valeurs 'hotel'/'bureau' que TableauDeBordAccueil.jsx — un candidat avec les deux
  // familles de postes renseignées n'est pas exclu au double titre (voir filtrerDossiers.js,
  // même principe).
  const rendezvousParCandidatEntite = useMemo(() => {
    if (entitesFiltre.size === 0) return rendezvousParCandidat;
    return rendezvousParCandidat.filter(
      (rdv) =>
        (entitesFiltre.has('hotel') && (rdv.postesHotel ?? []).length > 0) ||
        (entitesFiltre.has('bureau') && (rdv.postesBureau ?? []).length > 0),
    );
  }, [rendezvousParCandidat, entitesFiltre]);

  // Base commune aux DEUX barres de statut (Rendez-vous ET Statut dossier, audit 2026-09-13) —
  // une ligne par candidat, APRÈS recherche/plage de date/aVenirSeulement/formateurFiltre/entité/
  // expérience, mais AVANT les deux filtres de statut eux-mêmes (renommée au pluriel : sert
  // désormais de socle à deux filtres siblings, pas un seul). Même principe que
  // SuiviFormation.jsx/TableauDeBordAccueil.jsx : un agent qui cherche "Ibrahima" voit
  // re-décompter les boutons sur les seuls candidats Ibrahima, pas sur la liste entière.
  const rendezvousParCandidatAvantStatuts = useMemo(() => {
    if (!experienceFiltre) return rendezvousParCandidatEntite;
    return rendezvousParCandidatEntite.filter((rdv) => rdv.experience === experienceFiltre);
  }, [rendezvousParCandidatEntite, experienceFiltre]);

  // Compteurs des boutons de la barre "Rendez-vous" — calculés sur rendezvousParCandidatAvantStatuts
  // filtrée en plus par statutDossierFiltre (le filtre SIBLING "Statut" dossier, voir plus bas) :
  // chaque bouton "Rendez-vous" doit répondre à "combien de candidats si je clique CE bouton",
  // compte tenu de tous les AUTRES filtres actifs, y compris désormais Statut dossier — jamais de
  // lui-même (statutRdvFiltre n'intervient pas ici). Un statut qu'aucune combinaison de filtres
  // actuelle ne peut produire (ex. "Réalisé" avec "À venir uniquement" coché) affiche fidèlement
  // "(0)", jamais masqué.
  const rendezvousParCandidatAvantStatutRdv = useMemo(() => {
    if (!statutDossierFiltre) return rendezvousParCandidatAvantStatuts;
    return rendezvousParCandidatAvantStatuts.filter((rdv) => codeGroupeStatutDossier(rdv) === statutDossierFiltre);
  }, [rendezvousParCandidatAvantStatuts, statutDossierFiltre]);

  const compteursParStatutRdv = useMemo(() => {
    const compteurs = {};
    for (const rdv of rendezvousParCandidatAvantStatutRdv) {
      const code = codeStatutAffiche(rdv);
      compteurs[code] = (compteurs[code] ?? 0) + 1;
    }
    return compteurs;
  }, [rendezvousParCandidatAvantStatutRdv]);

  // Compteurs des boutons de la barre "Statut" (dossier, audit 2026-09-13) — symétrique de
  // compteursParStatutRdv ci-dessus : calculés sur rendezvousParCandidatAvantStatuts filtrée en
  // plus par statutRdvFiltre (le filtre SIBLING "Rendez-vous"), jamais par statutDossierFiltre
  // lui-même. Un dossier sans groupe (codeGroupeStatutDossier undefined — `valide`/`rejete`, voir
  // leur commentaire plus haut) n'incrémente aucun de ces 4 compteurs, mais reste compté dans
  // "Tous" (compteurTousDossier ci-dessous).
  const rendezvousParCandidatAvantStatutDossier = useMemo(() => {
    if (!statutRdvFiltre) return rendezvousParCandidatAvantStatuts;
    return rendezvousParCandidatAvantStatuts.filter((rdv) => codeStatutAffiche(rdv) === statutRdvFiltre);
  }, [rendezvousParCandidatAvantStatuts, statutRdvFiltre]);

  const compteursParStatutDossier = useMemo(() => {
    const compteurs = {};
    for (const rdv of rendezvousParCandidatAvantStatutDossier) {
      const code = codeGroupeStatutDossier(rdv);
      if (!code) continue;
      compteurs[code] = (compteurs[code] ?? 0) + 1;
    }
    return compteurs;
  }, [rendezvousParCandidatAvantStatutDossier]);

  // Liste finale : les DEUX filtres de statut se combinent en ET, en plus de tous les filtres déjà
  // appliqués en amont (recherche/dates/à venir/formateur/entité/expérience) — chacun restreint
  // simplement un peu plus rendezvousParCandidatAvantStatuts, sans logique de composition dédiée.
  const rendezvousParCandidatFiltres = useMemo(() => {
    return rendezvousParCandidatAvantStatuts.filter(
      (rdv) =>
        (!statutRdvFiltre || codeStatutAffiche(rdv) === statutRdvFiltre) &&
        (!statutDossierFiltre || codeGroupeStatutDossier(rdv) === statutDossierFiltre),
    );
  }, [rendezvousParCandidatAvantStatuts, statutRdvFiltre, statutDossierFiltre]);

  const rendezvousTries = useMemo(() => {
    const colonneTri = COLONNES.find((colonne) => colonne.cle === tri.colonne);
    const copie = [...rendezvousParCandidatFiltres];
    copie.sort((a, b) => {
      const valeurA = colonneTri.extraire(a);
      const valeurB = colonneTri.extraire(b);
      if (valeurA < valeurB) return tri.ordre === 'asc' ? -1 : 1;
      if (valeurA > valeurB) return tri.ordre === 'asc' ? 1 : -1;
      return 0;
    });
    return copie;
  }, [rendezvousParCandidatFiltres, tri]);

  // Reclique sur la colonne déjà active : inverse l'ordre. Nouvelle colonne : "Date et heure"
  // repart croissant (le prochain rendez-vous en premier reste le repère le plus utile), les
  // colonnes textuelles repartent croissant (ordre alphabétique naturel) — même patron que
  // DossierList.jsx.
  const trierPar = (colonne) => {
    setTri((precedent) => {
      if (precedent.colonne === colonne) {
        return { colonne, ordre: precedent.ordre === 'asc' ? 'desc' : 'asc' };
      }
      return { colonne, ordre: 'asc' };
    });
  };

  // dossier_id distincts de la liste actuellement affichée (filtrée + triée) — sert à la case
  // "tout sélectionner" de l'en-tête : coche/décoche uniquement ce qui est visible maintenant,
  // sans toucher à une éventuelle sélection faite sous un autre filtre (voir dossiersSelectionnes
  // ci-dessus).
  const dossierIdsVisibles = useMemo(
    () => [...new Set(rendezvousTries.map((rdv) => rdv.dossier_id))],
    [rendezvousTries],
  );
  const tousVisiblesSelectionnes =
    dossierIdsVisibles.length > 0 && dossierIdsVisibles.every((id) => dossiersSelectionnes.has(id));

  const togglerSelectionDossier = (dossierId) => {
    setDossiersSelectionnes((precedent) => {
      const suivant = new Set(precedent);
      if (suivant.has(dossierId)) suivant.delete(dossierId);
      else suivant.add(dossierId);
      return suivant;
    });
  };

  const togglerSelectionnerTout = () => {
    setDossiersSelectionnes((precedent) => {
      const suivant = new Set(precedent);
      if (tousVisiblesSelectionnes) {
        dossierIdsVisibles.forEach((id) => suivant.delete(id));
      } else {
        dossierIdsVisibles.forEach((id) => suivant.add(id));
      }
      return suivant;
    });
  };

  // Objets { id, candidat_nom, candidat_prenom } des dossiers sélectionnés — lus depuis `rendezvous`
  // (liste COMPLÈTE déjà en mémoire, pas rendezvousTries/rendezvousParCandidat qui dépendent des
  // filtres actifs), même principe que dossiersSelectionnesObjets sur TableauDeBordAccueil.jsx :
  // une sélection reste exploitable par les modales même si l'agent modifie ensuite un filtre
  // pendant qu'une sélection est déjà faite. N'importe quelle ligne de rendez-vous d'un dossier
  // sélectionné suffit (candidat_nom/candidat_prenom identiques sur toutes les lignes du même
  // dossier) — un seul passage, sans avoir besoin de rendezvousParCandidat (qui choisit une ligne
  // "représentative" par date, une distinction sans objet pour ce seul besoin de nom/prénom).
  const dossiersSelectionnesObjets = useMemo(() => {
    const parDossier = new Map();
    for (const rdv of rendezvous) {
      if (!dossiersSelectionnes.has(rdv.dossier_id) || parDossier.has(rdv.dossier_id)) continue;
      parDossier.set(rdv.dossier_id, {
        id: rdv.dossier_id,
        candidat_nom: rdv.candidat_nom,
        candidat_prenom: rdv.candidat_prenom,
      });
    }
    return [...parDossier.values()];
  }, [rendezvous, dossiersSelectionnes]);

  // Vide la sélection et ferme la modale — même patron que TableauDeBordAccueil.jsx : l'agent
  // revient sur une liste "propre", cohérente avec le comportement d'une action individuelle
  // réussie (retour à l'écran précédent).
  const terminerActionGroupee = () => {
    setModaleGroupeeOuverte(null);
    setDossiersSelectionnes(new Set());
  };

  // Vérification asynchrone (voir son état de déclaration plus haut) : contrairement à
  // TableauDeBordAccueil.jsx (dossiers déjà en mémoire avec leur statut_code, split synchrone via
  // useMemo), rdv.dossier_statut_code ici n'est qu'un instantané pris au chargement de la page (voir
  // le commentaire de STATUTS_REPLANIFIABLES_ACCECIT plus haut) — obtenirDossier (même route que
  // Relances.jsx/Formation.jsx/Tests.jsx) va donc quand même chercher le statut RÉEL, à jour, de
  // chaque dossier sélectionné avant de décider qui est éligible. Un échec de récupération sur UN
  // dossier (supprimé entretemps, etc.) l'exclut simplement de la replanification plutôt que de
  // bloquer toute la vérification — même philosophie de résilience que lancerExportPieces
  // (TableauDeBordAccueil.jsx), qui traite une pièce introuvable comme "0 pièce" plutôt que comme un
  // échec global.
  const ouvrirReplanificationGroupee = async () => {
    if (verificationReplanificationEnCours || dossiersSelectionnes.size === 0) return;
    setVerificationReplanificationEnCours(true);
    setErreurVerificationReplanification(null);
    try {
      const dossiersComplets = await Promise.all(
        [...dossiersSelectionnes].map((dossierId) => obtenirDossier(dossierId).catch(() => null)),
      );
      const eligibles = [];
      const exclus = [];
      dossiersComplets.forEach((dossier) => {
        if (!dossier) return;
        (STATUTS_REPLANIFIABLES_ACCECIT.includes(dossier.statut_code) ? eligibles : exclus).push(dossier);
      });
      setDossiersEligiblesReplanification(eligibles);
      setDossiersExclusReplanification(exclus);
      setModaleGroupeeOuverte('replanification');
    } catch (erreur) {
      setErreurVerificationReplanification(
        erreur.response
          ? (erreur.response.data?.erreur ?? "Impossible de vérifier l'éligibilité des dossiers sélectionnés.")
          : 'Connexion au serveur impossible. Vérifiez le réseau et réessayez.',
      );
    } finally {
      setVerificationReplanificationEnCours(false);
    }
  };

  const ouvrirHistorique = () => {
    if (dossiersSelectionnes.size === 0) return;
    setDossierIdsHistorique([...dossiersSelectionnes]);
    setPanneauHistoriqueOuvert(true);
    // Voir compteurHistorique ci-dessus : incrémenté à CHAQUE clic (pas seulement à la première
    // ouverture), pour que le panneau se remonte — et donc rescrolle + recharge ses données — même
    // reclic sur une sélection différente pendant qu'il est déjà affiché.
    setCompteurHistorique((precedent) => precedent + 1);
  };

  // Session sans objet à vérifier ici (RouteProtegee, App.jsx, redirige déjà vers /connexion avant
  // même de monter cette page en l'absence de session) — `!utilisateur` ne couvre plus qu'un très
  // bref instant où le useSession() PROPRE à cette page (ci-dessus) n'a pas encore résolu le sien.
  if (chargementSession || !utilisateur) {
    return (
      <PageBackOffice>
        <p>Chargement de la session…</p>
      </PageBackOffice>
    );
  }

  return (
    <PageBackOffice>
      <div className="planification">
        <header className="planification__entete">
          {/* Devant le titre, sur la même ligne (décision utilisateur, 2026-08-13 — revient sur le
              patron "aligné à droite sous le header" de .capture-tablette__retour-ligne, toujours
              utilisé tel quel ailleurs). */}
          <div className="planification__titre-bloc">
            {/* Bouton "Retour Dossier Candidat" retiré (refonte navigation, 2026-08-17) : couvert
                par le lien "Dossiers candidats" de la barre de navigation commune, voir
                BarreNavigation.jsx (montée dans PageBackOffice.jsx). Titre harmonisé avec le
                libellé "Suivi des tests" de cette même barre (ex-"Planification des tests"). */}
            <h1>Suivi des tests</h1>
          </div>
          <EnTeteBackOffice />
        </header>

        {/* "À venir uniquement"/Formateur/Expérience regroupés sur une même ligne (réorganisation
            2026-09-14, demande utilisateur) — plus de bouton "Plus de filtres" pour les masquer
            (retiré le 2026-09-11, décision utilisateur : composant PanneauFiltresRepliable.jsx
            supprimé, ce bloc reste désormais visible en permanence). Purement une question de
            disposition : aucun des trois filtres ne change de comportement (aVenirSeulement reste
            filtré côté serveur, formateurFiltre/experienceFiltre inchangés). */}
        <div className="planification__filtres">
          <label className="planification__filtre-case">
            <input
              type="checkbox"
              checked={aVenirSeulement}
              onChange={(evenement) => setAVenirSeulement(evenement.target.checked)}
            />
            À venir uniquement
          </label>

          {/* Masqué pour Formateur/Inspecteur (voir estFormateurOuInspecteur) : ces deux rôles ne
              voient déjà que leurs propres rendez-vous (restriction serveur, dossiers.routes.js),
              un sélecteur "Tous les formateurs" n'aurait donc plus aucun effet utile pour eux. */}
          {!estFormateurOuInspecteur && (
            <label className="planification__filtre-formateur">
              <span>Formateur</span>
              <select value={formateurFiltre} onChange={(evenement) => setFormateurFiltre(evenement.target.value)}>
                <option value="">Tous</option>
                {formateurs.map((formateur) => (
                  <option key={formateur.id} value={formateur.id}>
                    {formateur.prenom} {formateur.nom}
                  </option>
                ))}
              </select>
            </label>
          )}

          {/* Filtre "Expérience" (audit 2026-09-02) — même mécanisme <select> que "Formateur"
              ci-dessus, filtrage entièrement client (voir rendezvousParCandidatAvantStatuts). */}
          <label className="planification__filtre-formateur">
            <span>Expérience</span>
            <select value={experienceFiltre} onChange={(evenement) => setExperienceFiltre(evenement.target.value)}>
              <option value="">Toutes</option>
              {CODES_EXPERIENCE_ACCECIT.map((code) => (
                <option key={code} value={code}>
                  {libelleExperience(code)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Composant partagé (core/dossier/FiltresRechercheDossiers.jsx, même modèle que
            Dossiers candidats, Code postal activé le 2026-09-11 — demande utilisateur). placeholder/
            ariaLabel propres à cet écran (pas de téléphone/email à chercher ici, voir
            rechercheCorrespond ci-dessus) — inchangés depuis avant cette harmonisation. Du/Au
            filtrent ici sur rdv.date_heure plutôt que la date de dernière mise à jour du
            dossier (voir rendezvousFiltres ci-dessus). */}
        <FiltresRechercheDossiers
          recherche={recherche}
          onChangerRecherche={setRecherche}
          placeholder="Nom, prénom, N° dossier, poste, formateur ou statut"
          ariaLabel="Rechercher un rendez-vous par nom, prénom, n° de dossier, poste, formateur ou statut"
          codePostalFiltre={codePostalFiltre}
          onChangerCodePostalFiltre={setCodePostalFiltre}
          dateDebutFiltre={dateDebutFiltre}
          onChangerDateDebutFiltre={setDateDebutFiltre}
          dateFinFiltre={dateFinFiltre}
          onChangerDateFinFiltre={setDateFinFiltre}
        />

        {/* Hôtellerie/Tertiaire + "Statut" (dossier) sur une même ligne (réorganisation 2026-09-14,
            demande utilisateur — l'entité Hôtellerie/Tertiaire n'est plus imbriquée dans la barre
            "Rendez-vous" via filtresSupplementaires comme avant cette date, mais rendue en sibling
            AUTONOME juste devant la barre "Statut"). FiltreEntite.jsx pose `width: 100%` sur
            lui-même (pensé pour la colonne .filtres-statut__gauche de FiltresStatut, qui le
            contraignait jusqu'ici) : hors de ce contexte, il lui faut son propre conteneur de
            largeur bornée pour ne pas s'étirer sur toute la ligne — même correctif déjà appliqué
            pour son unique autre usage standalone, TableauDossiersSelectionnes.jsx (voir
            .tableau-dossiers-selectionnes__filtre-entite, même valeur de max-width reprise ici). */}
        <div className="planification__ligne-entite-statut">
          <div className="planification__filtre-entite-standalone">
            <FiltreEntite
              entitesFiltre={entitesFiltre}
              onBasculerEntite={basculerEntiteFiltre}
              compteurHotel={compteurHotel}
              compteurBureau={compteurBureau}
            />
          </div>

          {/* Barre "Statut" (statut du DOSSIER regroupé en 4 valeurs, audit 2026-09-13) — même
              composant FiltresStatut, mêmes 4 groupes que la colonne "Statut" du tableau
              (STATUTS_FILTRABLES_DOSSIER/codeGroupeStatutDossier) : "Tous" + un bouton par groupe,
              compteur dynamique. Se combine en ET avec TOUS les autres filtres de la page (voir
              rendezvousParCandidatFiltres) — y compris le filtre "Rendez-vous" plus bas, chacun
              ignorant délibérément sa PROPRE valeur dans le calcul de ses compteurs mais tenant
              compte de celle de l'autre (voir compteursParStatutDossier/
              rendezvousParCandidatAvantStatutDossier plus haut), pour que les deux barres restent
              cohérentes entre elles quelle que soit la combinaison active. Un label "Statut" à
              gauche (planification__label-filtre-statut) sert de seul repère visuel avec la barre
              "Rendez-vous" plus bas — FiltresStatut est un composant générique déjà bien
              identifiable par ses propres libellés de boutons, le label n'est là que pour lever
              l'ambiguïté entre les deux familles avant que l'agent n'ait lu un seul bouton. */}
          <div className="planification__groupe-filtre-statut">
            <span className="planification__label-filtre-statut">Statut</span>
            <FiltresStatut
              statuts={STATUTS_FILTRABLES_DOSSIER}
              statutFiltre={statutDossierFiltre}
              onChangerStatutFiltre={setStatutDossierFiltre}
              ariaLabel="Filtrer par statut de dossier"
              compteurTous={rendezvousParCandidatAvantStatutDossier.length}
              compteurs={compteursParStatutDossier}
            />
          </div>
        </div>

        {/* Barre "Rendez-vous" (statut du RENDEZ-VOUS, audit 2026-08-31), sur sa propre ligne
            dédiée sous Hôtellerie/Tertiaire + Statut (réorganisation 2026-09-14, demande
            utilisateur) — même composant/pattern que "Dossiers candidats" (TableauDeBordAccueil.jsx) :
            "Tous" + un bouton par statut affiché avec compteur dynamique entre parenthèses.
            Combinable avec "À venir uniquement"/Formateur/Rechercher/Du-Au/Statut (dossier)
            ci-dessus (voir statutRdvFiltre, filtrage client sur la liste déjà groupée par
            candidat) — une combinaison sans résultat (ex. "À venir uniquement" + "Réalisé")
            affiche simplement "(0)" plutôt que d'être bloquée, voir le commentaire de
            compteursParStatutRdv. Deux paramètres d'URL distincts (statut_rdv/statut_dossier, voir
            leur déclaration plus haut) : jamais de collision possible entre les deux filtres dans
            un lien partagé/mis en favori. */}
        <div className="planification__groupe-filtre-statut">
          <span className="planification__label-filtre-statut">Rendez-vous</span>
          <FiltresStatut
            statuts={STATUTS_FILTRABLES_RENDEZVOUS}
            statutFiltre={statutRdvFiltre}
            onChangerStatutFiltre={setStatutRdvFiltre}
            ariaLabel="Filtrer par statut de rendez-vous"
            compteurTous={rendezvousParCandidatAvantStatutRdv.length}
            compteurs={compteursParStatutRdv}
          />
        </div>

        {/* Barre d'actions groupées — même style visuel que TableauDeBordAccueil.jsx (Dossiers
            candidats, audit 2026-08-24) : sticky, fond dégradé back-office, compteur à gauche,
            boutons pleins à droite. N'apparaît qu'à partir de SEUIL_SELECTION_ACTIONS_GROUPEES (1,
            même seuil que Dossiers candidats depuis le 2026-08-25) sélections, plutôt que toujours
            rendue avec un bouton désactivé (comportement précédent). Masquée pour
            Formateur/Inspecteur (voir estFormateurOuInspecteur) : la sélection multi-candidats
            reste une action de coordination (regroupement de plusieurs dossiers), distincte de la
            simple consultation en lecture seule d'UN dossier via "Voir le dossier" (colonne
            Actions ci-dessous, désormais accessible à ces deux rôles — voir son commentaire).
            "Relances"/"Replanifier des tests" (demande utilisateur) réutilisent les MÊMES modales
            que Dossiers candidats (ModaleRelanceGroupee.jsx/ModaleReplanificationGroupee.jsx),
            pas de réimplémentation — voir dossiersSelectionnesObjets/ouvrirReplanificationGroupee
            plus haut. Pas "Export des pièces" ici (demande utilisateur) : hors sujet sur un écran
            de rendez-vous de test, pas de dossiers avec pièces à exporter. */}
        {!estFormateurOuInspecteur && dossiersSelectionnes.size >= SEUIL_SELECTION_ACTIONS_GROUPEES && (
          <div className="planification__actions-groupees" role="toolbar" aria-label="Actions groupées">
            <span className="planification__actions-groupees-compteur">
              {dossiersSelectionnes.size} candidat{dossiersSelectionnes.size > 1 ? 's' : ''} sélectionné
              {dossiersSelectionnes.size > 1 ? 's' : ''}
            </span>
            <button
              type="button"
              className="planification__bouton-action-groupee"
              onClick={() => setModaleGroupeeOuverte('relance')}
            >
              Relances
            </button>
            {/* Vérification asynchrone (ouvrirReplanificationGroupee) avant d'ouvrir la modale —
                voir son commentaire d'en-tête : contrairement à Dossiers candidats, l'éligibilité
                (STATUTS_REPLANIFIABLES_ACCECIT) n'est connue qu'après avoir interrogé le statut
                réel de chaque dossier sélectionné, absent des rendez-vous déjà en mémoire ici. */}
            <button
              type="button"
              className="planification__bouton-action-groupee"
              onClick={ouvrirReplanificationGroupee}
              disabled={verificationReplanificationEnCours}
            >
              {verificationReplanificationEnCours ? 'Vérification…' : 'Replanifier des tests'}
            </button>
            <button type="button" className="planification__bouton-action-groupee" onClick={ouvrirHistorique}>
              Voir l&rsquo;historique des rendez-vous sélectionnés
            </button>
            {/* "Effacer la sélection" (audit 2026-08-25) — même libellé/logique que
                TableauDeBordAccueil.jsx (Dossiers candidats) et que le bouton déjà en place sur le
                panneau "Dossiers sélectionnés" du tableau de bord Indicateurs, voir leurs
                commentaires respectifs : remet la sélection à zéro, ce qui fait disparaître cette
                barre elle-même au rendu suivant. Classe modificatrice --effacer (distinction
                visuelle, audit 2026-08-25) EN PLUS de la classe de base — même patron que
                TableauDeBordAccueil.css. */}
            <button
              type="button"
              className="planification__bouton-action-groupee planification__bouton-action-groupee--effacer"
              onClick={() => setDossiersSelectionnes(new Set())}
            >
              Effacer la sélection
            </button>
          </div>
        )}

        {erreurVerificationReplanification && <p role="alert">{erreurVerificationReplanification}</p>}

        {chargement && <p>Chargement des rendez-vous…</p>}
        {erreur && <p role="alert">{erreur}</p>}

        {!chargement && !erreur && rendezvousTries.length === 0 && (
          <p className="planification__vide">Aucun rendez-vous de test à afficher.</p>
        )}

        {!chargement && !erreur && rendezvousTries.length > 0 && (
          // IndicateurDefilementHorizontal (audit tablette 2026-09-04) : dégradés de bord qui
          // signalent qu'il reste du contenu à défiler, voir son commentaire d'en-tête.
          <IndicateurDefilementHorizontal className="planification__scroll">
            {/* --planification-largeur-colonne-case ramenée à 0 quand la colonne de sélection ne
                se rend pas (Formateur/Inspecteur, voir estFormateurOuInspecteur) : cette variable
                pilote aussi le décalage (`left`) en cascade de "N°"/"Candidat" (voir
                Planification.css) — sans ce recalage, ces deux colonnes figées garderaient un vide
                à gauche correspondant à la largeur de la case à cocher absente. "Date et heure du
                test" ne fait plus partie de ce bloc figé (déplacée après "Statut", demande
                utilisateur), donc plus concernée par ce décalage. */}
            <table
              className="planification__table"
              style={estFormateurOuInspecteur ? { '--planification-largeur-colonne-case': '0rem' } : undefined}
            >
              <thead>
                <tr>
                  {/* Sélection de candidats (voir dossiersSelectionnes) — première colonne, figée
                      au défilement horizontal comme "N°"/"Candidat" juste après elle (voir
                      Planification.css, --planification-largeur-colonne-case décale maintenant les
                      deux autres). Case "tout sélectionner" : coche/décoche les
                      seuls candidats actuellement visibles (voir togglerSelectionnerTout). Masquée
                      pour Formateur/Inspecteur (voir estFormateurOuInspecteur) : la sélection
                      multi-candidats n'a d'utilité que pour "Voir l'historique...", lui-même
                      masqué pour ces deux rôles (voir plus haut). */}
                  {!estFormateurOuInspecteur && (
                    <th scope="col" className="planification__colonne-case">
                      <input
                        type="checkbox"
                        checked={tousVisiblesSelectionnes}
                        onChange={togglerSelectionnerTout}
                        aria-label="Tout sélectionner"
                      />
                    </th>
                  )}
                  {/* N° de dossier = rdv.dossier_id, identifiant métier déjà utilisé partout
                      ailleurs dans l'app (en-tête "Dossier #id", colonne "N° dossier" du tableau
                      KPI) — plus un simple rang d'affichage recalculé à chaque tri (comportement
                      précédent). Figée en tête du bloc figé "Candidat" ci-dessous (voir
                      Planification.css, --planification-largeur-colonne-numero). */}
                  <th scope="col" className="planification__colonne-numero">
                    N°
                  </th>
                  {COLONNES.map((colonne) => {
                    const actif = tri.colonne === colonne.cle;
                    // "Candidat" (1re colonne de COLONNES, juste après "N°") reste seule figée au
                    // défilement horizontal, comme le repère de ligne des tableaux Comptes
                    // utilisateurs/Dossiers candidats. "Date et heure du test", déplacée en fin de
                    // tableau (demande utilisateur), n'a plus besoin d'être figée : seul
                    // white-space: nowrap subsiste pour elle (voir Planification.css,
                    // .planification__colonne-date-test) pour ne jamais couper "28/07/2026 15:00"
                    // entre la date et l'heure.
                    let classeFigee;
                    if (colonne.cle === 'candidat_nom') classeFigee = 'planification__colonne-figee';
                    else if (colonne.cle === 'date_heure') classeFigee = 'planification__colonne-date-test';
                    return (
                      <th
                        key={colonne.cle}
                        scope="col"
                        className={classeFigee}
                        aria-sort={actif ? (tri.ordre === 'asc' ? 'ascending' : 'descending') : 'none'}
                      >
                        <button type="button" className="planification__entete-tri" onClick={() => trierPar(colonne.cle)}>
                          {colonne.libelle}
                          <span className="planification__indicateur-tri" aria-hidden="true">
                            {actif ? (tri.ordre === 'asc' ? '▲' : '▼') : ''}
                          </span>
                        </button>
                      </th>
                    );
                  })}
                  {/* "Voir le dossier" (voir son commentaire plus bas) désormais accessible à
                      Formateur/Inspecteur aussi (audit 2026-08-20) : accès en lecture seule à
                      /coordination/dossiers/:id/relances, accordé côté back (rendezvous.routes.js/
                      relances.routes.js, ROLES_LECTURE_RENDEZVOUS/ROLES_LECTURE_RELANCES) — les
                      actions de reprogrammation/désistement/relance y restent masquées pour ces
                      deux rôles (voir GestionRendezvous.jsx/HistoriqueRelances.jsx), donc plus
                      besoin de masquer cette colonne en amont ici. */}
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rendezvousTries.map((rdv) => (
                  <tr key={rdv.id}>
                    {!estFormateurOuInspecteur && (
                      <td className="planification__colonne-case">
                        <input
                          type="checkbox"
                          checked={dossiersSelectionnes.has(rdv.dossier_id)}
                          onChange={() => togglerSelectionDossier(rdv.dossier_id)}
                          aria-label={`Sélectionner ${rdv.candidat_prenom} ${rdv.candidat_nom}`}
                        />
                      </td>
                    )}
                    <td className="planification__colonne-numero">{rdv.dossier_id}</td>
                    <td className="planification__colonne-figee">
                      {rdv.candidat_prenom} {rdv.candidat_nom}
                    </td>
                    <td>{rdv.candidat_code_postal || '-'}</td>
                    <td className="planification__colonne-poste">
                      <div className="planification__postes">
                        {[...(rdv.postesBureau ?? []), ...(rdv.postesHotel ?? [])].map((code) => (
                          <span key={code} className="planification__badge-poste">
                            {libellePoste(code)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>{libelleExperience(rdv.experience)}</td>
                    <td>{rdv.formateur_nom ? `${rdv.formateur_prenom} ${rdv.formateur_nom}` : '-'}</td>
                    {/* "Statut" (statut du DOSSIER regroupé en 4 valeurs, audit 2026-09-13) — voir
                        le commentaire d'en-tête de GROUPE_STATUT_DOSSIER_PAR_CODE_ACCECIT.
                        Marque + infobulle "Statut forcé manuellement" (audit 2026-09-22, dossiers
                        #16/#54) UNIQUEMENT si rdv.statutForce — wrapper `position: relative` DÉDIÉ
                        (pas le badge lui-même, générique/partagé, voir StatutBadge.jsx), même
                        principe que .dossier-list__statut-conteneur (DossierList.jsx). Infobulle
                        maison structurée (titre en gras/ligne date+auteur/commentaire en retrait),
                        pas une simple liste de lignes centrées comme .dossier-list__statut-infobulle
                        — demande explicite d'une présentation plus soignée pour celle-ci. */}
                    <td className="planification__colonne-statut">
                      <span
                        className={
                          rdv.statutForce
                            ? 'planification__statut-conteneur planification__statut-conteneur--force'
                            : 'planification__statut-conteneur'
                        }
                        onMouseEnter={rdv.statutForce ? positionnerInfobulleStatutForce : undefined}
                      >
                        <StatutBadge
                          libelle={libelleGroupeStatutDossier(rdv)}
                          variante={varianteGroupeStatutDossier(rdv)}
                        />
                        {rdv.statutForce && (
                          <>
                            <span className="planification__statut-force-marque" aria-hidden="true">
                              i
                            </span>
                            <span className="planification__statut-force-infobulle" aria-hidden="true">
                              <span className="planification__statut-force-infobulle-titre">
                                Statut forcé manuellement
                              </span>
                              <span className="planification__statut-force-infobulle-meta">
                                {rdv.statut_force_le && FORMAT_DATE_HEURE.format(new Date(rdv.statut_force_le))}
                                {libelleAuteurStatutForce(rdv) && ` - ${libelleAuteurStatutForce(rdv)}`}
                              </span>
                              {rdv.statut_force_commentaire && (
                                <span className="planification__statut-force-infobulle-commentaire">
                                  « {rdv.statut_force_commentaire} »
                                </span>
                              )}
                            </span>
                          </>
                        )}
                      </span>
                    </td>
                    {/* "Rendez-vous" (ex-colonne "Statut", statut du RENDEZ-VOUS) — inchangée, voir
                        le commentaire d'en-tête de COLONNES. Marque + infobulle "Dossier déjà
                        clôturé" (audit 2026-09-23) UNIQUEMENT si rendezvousDossierClos(rdv) — même
                        mécanique (wrapper position: relative dédié + liseré pointillé + cercle "i" +
                        carte stylée au survol) que le badge "Statut forcé manuellement" ci-dessus,
                        mais classes ET couleur dédiées (gris, --statut-neutre-fort-bordure) : deux
                        signaux différents sur une même ligne (un humain a forcé ce statut / une
                        clôture automatique a rendu CE rendez-vous caduc), le doré reste réservé au
                        premier pour ne pas laisser croire au même sens. Infobulle en texte simple
                        (une seule ligne, voir tooltipDossierClos), pas la structure à 3 niveaux
                        (titre/meta/commentaire) du badge forcé — décision utilisateur 2026-09-23. */}
                    <td className="planification__colonne-statut">
                      <span
                        className={
                          rendezvousDossierClos(rdv)
                            ? 'planification__rdv-conteneur planification__rdv-conteneur--clos'
                            : 'planification__rdv-conteneur'
                        }
                        onMouseEnter={rendezvousDossierClos(rdv) ? positionnerInfobulleRdvClos : undefined}
                      >
                        <StatutBadge
                          libelle={libelleAfficheRendezvous(rdv)}
                          variante={varianteAfficheeRendezvous(rdv)}
                        />
                        {rendezvousDossierClos(rdv) && (
                          <>
                            <span className="planification__rdv-clos-marque" aria-hidden="true">
                              i
                            </span>
                            <span className="planification__rdv-clos-infobulle" aria-hidden="true">
                              {tooltipDossierClos(rdv)}
                            </span>
                          </>
                        )}
                      </span>
                    </td>
                    <td className="planification__colonne-date-test">{FORMAT_DATE_HEURE.format(new Date(rdv.date_heure))}</td>
                    {/* "Voir le dossier" — même bouton (style/couleur/cadre) que sur la vue
                        Accueil/Admin ci-dessus, désormais aussi rendu pour Formateur/Inspecteur
                        (voir le commentaire de l'en-tête "Actions"). Ouvre la même fiche dossier
                        (Relances.jsx) en lecture seule pour ces deux rôles : GestionRendezvous.jsx/
                        HistoriqueRelances.jsx y masquent déjà leurs actions de reprogrammation/
                        désistement/relance pour eux (backend toujours fermé sur ces écritures,
                        même sans ce masquage front). */}
                    <td>
                      <div className="planification__actions">
                        <button
                          type="button"
                          className="planification__action-voir"
                          onClick={() => navigate(`/coordination/dossiers/${rdv.dossier_id}/relances`)}
                        >
                          Voir le dossier
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </IndicateurDefilementHorizontal>
        )}

        {/* key={[...dossiersSelectionnes].join(',')} : force un remontage complet de la modale si
            la sélection change pendant qu'elle est fermée puis rouverte — même patron que
            TableauDeBordAccueil.jsx (Dossiers candidats), chaque ouverture doit repartir d'un
            chargement propre (formateurs/lieux/derniers rendez-vous), jamais d'un état résiduel
            d'une ouverture précédente sur une autre sélection. */}
        {modaleGroupeeOuverte === 'relance' && (
          <ModaleRelanceGroupee
            key={[...dossiersSelectionnes].join(',')}
            dossiers={dossiersSelectionnesObjets}
            onFermer={() => setModaleGroupeeOuverte(null)}
            onTermine={terminerActionGroupee}
          />
        )}
        {modaleGroupeeOuverte === 'replanification' && (
          <ModaleReplanificationGroupee
            key={[...dossiersSelectionnes].join(',')}
            dossiers={dossiersEligiblesReplanification}
            dossiersExclus={dossiersExclusReplanification}
            libellePoste={libellePoste}
            onFermer={() => setModaleGroupeeOuverte(null)}
            onTermine={terminerActionGroupee}
          />
        )}

        {panneauHistoriqueOuvert && (
          // key={compteurHistorique} : voir son commentaire de déclaration — force un remontage à
          // chaque clic sur "Voir l'historique...", même si le panneau était déjà affiché, pour que
          // son scrollIntoView interne et son chargement de données se redéclenchent sur la
          // nouvelle sélection plutôt que de rester figés sur la précédente.
          <PanneauHistoriqueRendezvous
            key={compteurHistorique}
            dossierIds={dossierIdsHistorique}
            onFermer={() => setPanneauHistoriqueOuvert(false)}
          />
        )}
      </div>
    </PageBackOffice>
  );
}
