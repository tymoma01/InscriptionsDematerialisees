import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { useSession } from '../../core/auth/useSession';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import { obtenirIndicateursKpi, listerDossiersParIndicateurs } from '../../services/statistiqueService';
import { useRafraichissementAuto } from '../../core/dossier/useRafraichissementAuto';
import ErrorBoundary from '../../core/backOffice/ErrorBoundary';
import TableauDossiersSelectionnes from './TableauDossiersSelectionnes';
import './Indicateurs.css';

// Même mapping (nettoyé des résidus workflow v3/hérité) que TableauDeBordAccueil.jsx/
// Backoffice.jsx — dupliqué plutôt que partagé (voir CLAUDE.md conventions du projet), sert ici
// à la colonne "Statut" du tableau consolidé (voir plus bas, TableauDossiersSelectionnes).
const VARIANTE_PAR_CODE_STATUT_ACCECIT = {
  // 'nouveau' retiré (audit 2026-08-19, même correctif que TableauDeBordAccueil.jsx) : plus
  // aucun dossier ne peut atteindre ce statut aujourd'hui.
  en_attente_pieces: 'attente',
  en_attente_verification: 'attente',
  test_planifie: 'bleu',
  test_non_realise: 'alerte',
  invalide: 'echec',
  valide_envoi_formation: 'succes',
  valide_pret_embauche: 'vert-clair',
  // Suivi de formation (audit 2026-08-28) : 'echec-fort', distinct de 'echec' ("Invalidé") — voir
  // VerificationPieces.jsx pour le détail du choix de couleur.
  formation_non_validee: 'echec-fort',
};
function varianteStatut(code) {
  return VARIANTE_PAR_CODE_STATUT_ACCECIT[code] ?? 'neutre';
}

// Codes des indicateurs cliquables des cartes/camemberts (statiques — la répartition par poste,
// dynamique, a son propre préfixe 'poste:<code>', voir libelleIndicateur/varianteIndicateur plus
// bas) — mêmes 9 codes que backend/src/core/statistiques/statistiquesService.js
// (CODES_INDICATEURS_STATIQUES), dupliqué plutôt que partagé (voir plus haut).
// Libellés pensés pour rester compréhensibles isolément, sans dépendre du statut affiché juste à
// côté (colonne "Indicateurs" de TableauDossiersSelectionnes.jsx) — un badge peut désormais rester
// visible même quand il est redondant avec ce statut (décision Option A, 2026-08-10 : plus de
// filtrage de redondance, voir TableauDossiersSelectionnes.jsx).
//
// Clarifications d'audit, 2026-08-11 (pas de changement de comportement, uniquement de libellé) :
// - `conversion` : "Retenu" plutôt que "Converti" — l'audit a relevé que cet indicateur est un
//   INSTANTANÉ du statut ACTUEL d'une cohorte d'inscrits (valide_pret_embauche OU
//   valide_envoi_formation), pas un événement daté dans la période (voir aussi la tuile "Taux de
//   dossiers validés à ce jour" plus bas, même clarification). "Validé" seul aurait fait doublon
//   visuel avec la colonne "Statut", qui affiche déjà "Validé - prêt à l'embauche"/"Validé - envoyé
//   en formation" ; "Recruté" sur-affirmerait pour la branche "envoyé en formation" (pas encore
//   embauché à ce stade du parcours) — "Retenu" couvre les deux sans ambiguïté.
// - `envoyes_en_test` : "Envoyé en test" (revenu du "Mis en test" choisi juste après l'audit du
//   2026-08-11, décision utilisateur ultérieure du même jour) — reste distinct du badge de STATUT
//   "Test planifié" déjà existant (mots différents), sans reprendre "Test envoyé"/"Envoyés en
//   test" (libellé d'origine, plus ambigu sur "test réalisé ou non").
// `delai_inscription_test`/`delai_test_verdict` : libellés laissés inchangés (confirmé) — jamais
// ambigus vis-à-vis du statut affiché à côté, contrairement aux indicateurs renommés ci-dessus.
// Leur ambiguïté à eux est d'une autre nature (moyenne de période vs valeur par dossier) — traitée
// au niveau des TUILES agrégées (voir `title`/`.indicateurs__tuile-precision` plus bas), pas ici.
// `orientation_envoi_formation`/`orientation_pret_embauche` : "Envoyé en formation"/"Prêt à
// l'embauche" (décision utilisateur, 2026-08-12) — remplace "Orienté formation"/"Orienté embauche"
// pour rester au plus près du texte déjà utilisé ailleurs sur l'écran (légende du camembert
// "Formation vs prêt à l'embauche", et le statut "Validé - prêt à l'embauche").
//
// Clarification d'audit, 2026-08-24 (workflow v5) : la tuile "Inscrits" est devenue "Inscriptions"
// (voir son rendu plus bas) — collision nouvelle avec le statut `nouveau`, qui porte désormais lui-
// même le libellé exact "Inscrit" (workflow v5, workflow.config.json), alors que cette tuile reste
// un total de cohorte tous statuts confondus. `LIBELLES_INDICATEURS.inscrits` ci-dessous ('Inscrit')
// n'est PAS ce libellé de tuile : c'est celui du badge "Indicateurs"/de la colonne "Dates clés"
// (TableauDossiersSelectionnes.jsx), un contexte différent (marque une LIGNE de dossier déjà
// affichée à côté de son propre statut réel, pas une collision du même type) — laissé inchangé,
// portée de cette correction volontairement limitée à la tuile.
const LIBELLES_INDICATEURS = {
  inscrits: 'Inscrit',
  envoyes_en_test: 'Envoyé en test',
  conversion: 'Retenu',
  delai_inscription_test: 'Délai inscription → test',
  delai_test_verdict: 'Délai test → verdict',
  verdict_valide: 'Test réussi',
  verdict_invalide: 'Test échoué',
  orientation_envoi_formation: 'Envoyé en formation',
  orientation_pret_embauche: 'Prêt à l’embauche',
  // Barre "Non spécifié" du graphique de répartition par poste — code statique (pas 'poste:<code>',
  // voir PREFIXE_POSTE/libelleIndicateur plus bas) : "aucun poste renseigné" n'est pas un poste.
  poste_non_specifie: 'Poste non spécifié',
};

// Ordre de lecture canonique des indicateurs statiques (tuiles + segments de camembert), dérivé de
// l'ordre de déclaration de LIBELLES_INDICATEURS ci-dessus — transmis à TableauDossiersSelectionnes
// pour construire la colonne "Indicateurs" (et aligner "Dates clés" dessus) dans un ordre TOUJOURS
// identique pour un même ensemble d'indicateurs sélectionnés, quel que soit l'ordre des clics (voir
// audit "Dates clés dépend de l'ordre de sélection", TableauDossiersSelectionnes.jsx,
// construireColonnesAlignees) — avant ce correctif, cet ordre suivait `dossier.indicateurs`, lui-
// même hérité de l'ordre du Set `selectionIndicateurs` (ordre d'insertion = ordre de clic).
const ORDRE_CANONIQUE_INDICATEURS = Object.keys(LIBELLES_INDICATEURS);

// Tuiles "Délai moyen inscription → test planifié"/"Délai moyen test → verdict" — clarification
// d'audit, 2026-08-11 : le chiffre affiché ici est une MOYENNE en jours ÉCOULÉS (temps réel,
// valeur fractionnaire arrondie à 1 décimale, voir statistiquesService.versMoyenneJours) sur TOUS
// les dossiers de la période, alors que la même mesure affichée PAR DOSSIER dans la colonne
// "Dates clés" (TableauDossiersSelectionnes.jsx) est un nombre de jours CALENDAIRES entiers pour
// UN dossier — deux échelles différentes pour un intitulé proche, d'où le risque de confusion
// relevé par l'audit. `title` (tooltip natif au survol/focus clavier) plutôt qu'un composant de
// tooltip dédié : pas d'autre tooltip dans ce projet, un attribut natif suffit ici. Complété par
// `.indicateurs__tuile-precision` (texte visible, pas seulement au survol) sur les deux tuiles
// concernées, pour que la nuance reste lisible même sans interaction (tactile/tablette).
const PRECISION_DELAI_MOYEN =
  'Moyenne en jours écoulés (temps réel) sur l’ensemble des dossiers de la période — distincte des valeurs en jours calendaires entiers affichées par dossier dans la colonne "Dates clés".';

// Variantes de badge (StatutBadge) par indicateur — regroupées par famille visuelle : succès/échec
// alignés sur les couleurs déjà utilisées pour les statuts de dossier équivalents (vert pour un
// verdict/orientation positif, rouge pour un verdict négatif), le reste réparti sur les variantes
// restantes pour rester distinguable d'un coup d'œil dans la colonne "Indicateurs" du tableau.
const VARIANTE_PAR_INDICATEUR = {
  inscrits: 'neutre',
  envoyes_en_test: 'bleu',
  conversion: 'dore',
  delai_inscription_test: 'attente',
  delai_test_verdict: 'attente',
  verdict_valide: 'succes',
  verdict_invalide: 'echec',
  orientation_envoi_formation: 'violet',
  orientation_pret_embauche: 'vert-clair',
  // Même variante que les barres 'poste:<code>' (voir varianteIndicateur plus bas) : reste dans
  // la même famille visuelle "répartition par poste" que les autres barres du même graphique.
  poste_non_specifie: 'dore',
};
const PREFIXE_POSTE = 'poste:';

// Paires d'indicateurs mutuellement exclusifs (décision utilisateur, 2026-08-12) — les deux parts
// d'un même camembert cliquable ("Tests réussis vs ratés"/"Formation vs prêt à l'embauche")
// représentent des résultats contraires pour un même événement (un dossier n'a qu'un seul verdict/
// une seule orientation par test) : sélectionner l'une désélectionne automatiquement l'autre, voir
// basculerIndicateur plus bas. Scope volontairement limité à ces deux paires — n'affecte ni les
// tuiles KPI (Inscrits, Envoyé en test, Converti, les deux délais), ni les segments "Répartition
// par poste" (postes cumulables sur une même évaluation, pas des résultats contraires), qui
// restent librement combinables comme avant.
const PAIRES_INDICATEURS_EXCLUSIFS = [
  ['verdict_valide', 'verdict_invalide'],
  ['orientation_envoi_formation', 'orientation_pret_embauche'],
];

// Catalogue des postes ACCECIT — même valeurs que backend/src/core/dossier/postesConstantes.js,
// dupliqué plutôt que partagé entre front et back (pas de mécanisme de partage de code entre les
// deux dans ce projet, voir les autres pages back-office : Planification.jsx/Backoffice.jsx
// dupliquent déjà leur propre LIBELLES_POSTE_PAR_CODE_ACCECIT).
const POSTES_BUREAU = ['nettoyage', 'vitrerie', 'machiniste', 'chef_equipe', 'autres'];
const POSTES_HOTEL = ['femme_valet_chambre', 'cafetier', 'equipier', 'gouvernant'];

// Libellés des postes — même mapping que Planification.jsx/Backoffice.jsx.
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
  if (code === null) return 'Non spécifié';
  return LIBELLES_POSTE_PAR_CODE_ACCECIT[code] ?? code;
}

// Libellé de l'option par défaut (value="") du filtre "Poste" — purement affichage, le
// comportement de filtrage reste inchangé (poste vide = aucun filtre poste, scope = l'entité déjà
// sélectionnée via typePoste, voir posteEffectif plus bas). Reflète l'entité choisie dans le
// filtre "Entité" juste au-dessus pour éviter l'ambiguïté "tous les postes" alors qu'un filtre
// Hôtellerie/Tertiaire est déjà actif.
function libelleOptionTousLesPostes(typePosteFiltre) {
  if (typePosteFiltre === 'hotel') return 'Tous les postes Hôtellerie';
  if (typePosteFiltre === 'bureau') return 'Tous les postes Tertiaire';
  return 'Tous les postes';
}

// Un code 'poste:<code>' se traduit via libellePoste ci-dessus (même libellé que la colonne
// "Poste"/le graphique de répartition) plutôt que d'être dupliqué dans LIBELLES_INDICATEURS.
function libelleIndicateur(code) {
  if (code.startsWith(PREFIXE_POSTE)) return libellePoste(code.slice(PREFIXE_POSTE.length));
  return LIBELLES_INDICATEURS[code] ?? code;
}
function varianteIndicateur(code) {
  if (code.startsWith(PREFIXE_POSTE)) return 'dore';
  return VARIANTE_PAR_INDICATEUR[code] ?? 'neutre';
}
// Distingue les deux natures de code portées par `dossier.indicateurs` (voir
// TableauDossiersSelectionnes.jsx, colonne "Indicateurs") : un poste ('poste:<code>' ou
// 'poste_non_specifie', issus du graphique de répartition) n'est pas un indicateur de pilotage au
// même titre que "Inscrits"/"Test réussi"/... — mélangés sans distinction dans la même colonne,
// ils prêtaient à confusion. Pas de renommage de colonne pour autant ("Indicateurs et postes"
// ferait doublon avec la colonne "Poste" déjà présente, décision utilisateur) : seul le style du
// badge (puce grise façon colonne "Poste", voir TableauDossiersSelectionnes.jsx) distingue les
// deux, regroupés séparément dans la même cellule.
function estIndicateurPoste(code) {
  return code.startsWith(PREFIXE_POSTE) || code === 'poste_non_specifie';
}

// Colonne "Dates clés" du tableau consolidé (TableauDossiersSelectionnes.jsx) — mêmes codes que
// `datesCles` côté back (statistiquesService.listerDossiersParIndicateurs). Depuis le 2026-08-12,
// chaque ligne n'apparaît que si l'indicateur/la tuile correspondant est sélectionné (comme la
// colonne "Indicateurs" — voir construireColonnesAlignees, TableauDossiersSelectionnes.jsx), plus
// systématiquement quel que soit l'avancement du dossier. `verdict_valide`/`verdict_invalide` et
// `orientation_envoi_formation`/`orientation_pret_embauche` reprennent VOLONTAIREMENT les mêmes
// codes que les indicateurs homonymes (voir LIBELLES_INDICATEURS/VARIANTE_PAR_INDICATEUR plus
// haut) : ce sont le même événement (une évaluation, voir evaluations.resultat_global/
// orientation), la colonne "Dates clés" ne fait qu'en afficher la date sans dupliquer la
// connaissance de sa couleur. Chacun des 4 codes a son PROPRE libellé, distinct de son homologue
// "Indicateurs" (cette colonne nomme des ÉTAPES du parcours du dossier, pas des indicateurs de
// pilotage, décision utilisateur 2026-08-11) : "Validé"/"Invalidé" pour verdict_valide/invalide
// (décision 2026-08-12 — corrige un "Verdict" générique commun aux deux qui ne disait pas lequel
// des deux cas s'appliquait, la couleur seule ne suffisant pas) ; "Orienté-formation"/"Orienté-
// embauche" pour orientation_envoi_formation/pret_embauche (même décision, même raison — un
// "Orientation" commun aux deux ne disait pas laquelle des deux orientations).
const LIBELLES_DATES_CLES = {
  inscription: 'Inscription',
  test_planifie: 'Test planifié',
  verdict_valide: 'Validé',
  verdict_invalide: 'Invalidé',
  orientation_envoi_formation: 'Orienté-formation',
  orientation_pret_embauche: 'Orienté-embauche',
};
function libelleDateCle(code) {
  return LIBELLES_DATES_CLES[code] ?? code;
}
// Couleurs : `--statut-<variante>-*` (variables.css), MÊME variante que le badge de statut/
// indicateur correspondant — inscription: neutre (aucun statut équivalent à réutiliser depuis le
// retrait de "nouveau", VARIANTE_PAR_CODE_STATUT_ACCECIT, audit 2026-08-19 — 'neutre' reste le
// choix par défaut du badge générique, voir StatutBadge.jsx) ; test_planifie: bleu (comme le badge de statut "Test planifié",
// VARIANTE_PAR_CODE_STATUT_ACCECIT.test_planifie) ; verdict_valide/invalide et orientation_* :
// exactement VARIANTE_PAR_INDICATEUR (même code, réutilisé tel quel, pas dupliqué).
const VARIANTE_PAR_DATE_CLE = {
  inscription: 'neutre',
  test_planifie: 'bleu',
};
function varianteDateCle(code) {
  return VARIANTE_PAR_DATE_CLE[code] ?? VARIANTE_PAR_INDICATEUR[code] ?? 'neutre';
}

// Une palette dédiée par graphique (couleurs fixes, PAR CLÉ — jamais par position/index) plutôt
// que la teinte unique cyclée sur les 3 graphiques d'avant : plus agréable à l'œil (chaque
// graphique a sa propre identité visuelle) et surtout stable — colorier par index (voir
// l'ancienne COULEURS_GRAPHIQUE[index % ...]) repeint tous les segments suivants dès qu'un filtre
// change le nombre de postes affichés, ce qui fait "sauter" des couleurs déjà mémorisées par
// l'agent d'un chargement à l'autre. recharts ne lit pas les variables CSS dans ses props `fill`,
// valeurs recopiées ici en dur (seul point du projet à le faire).
//
// Couleurs choisies et validées avec le script de la skill dataviz (six checks : bande de
// luminosité, plancher de chroma, séparation daltonisme, plancher vision normale, contraste) —
// jamais au jugé. "Réussis/Ratés" reprend la palette de statut dédiée (vert succès / rouge
// critique, jamais réutilisée comme simple série) plutôt que la palette catégorielle : c'est
// exactement le cas d'usage d'un statut binaire réussite/échec, pas une simple identité.
const COULEURS_VERDICT = { verdict_valide: '#0ca30c', verdict_invalide: '#d03b3b' };

// "Formation vs prêt à l'embauche" : deux issues positives, pas un statut bon/mauvais — palette
// catégorielle (identité), pas la palette de statut. Violet + vert, cohérent avec les variantes de
// badge déjà choisies pour ces mêmes indicateurs (voir VARIANTE_PAR_INDICATEUR : 'violet'/
// 'vert-clair') sans reprendre le vert de "Réussis" ci-dessus (nuance différente : #008300 vs
// #0ca30c) pour ne pas laisser croire aux deux graphiques qu'ils mesurent la même chose.
const COULEURS_ORIENTATION = { orientation_envoi_formation: '#4a3aa7', orientation_pret_embauche: '#008300' };

// Répartition par poste : une couleur par CODE de poste (stable même si un filtre réduit le
// nombre de barres affichées), 8 teintes validées ensemble (voir script) + une 9e (cyan) ajoutée
// et revalidée pour couvrir les 9 postes ACCECIT (5 bureau + 4 hôtel) sans repli sur "Autre" —
// point à revisiter si l'entité en configure davantage un jour. "Non spécifié" (aucun poste
// renseigné sur l'évaluation) volontairement HORS de cette palette catégorielle : un gris neutre
// signale "pas de donnée", jamais confondu avec un vrai poste.
const COULEURS_POSTE = {
  nettoyage: '#2a78d6',
  vitrerie: '#eb6834',
  machiniste: '#1baf7a',
  chef_equipe: '#eda100',
  autres: '#e87ba4',
  femme_valet_chambre: '#008300',
  cafetier: '#4a3aa7',
  equipier: '#e34948',
  gouvernant: '#0891b2',
};
const COULEUR_POSTE_NON_SPECIFIE = '#9ca3af';

// Tooltip au survol des trois graphiques (les deux camemberts ET la répartition par poste en
// barres) — UNE seule constante partagée, pas une par graphique : le tooltip du graphique en
// barres utilisait encore le style par défaut de recharts (<Tooltip /> sans contentStyle/itemStyle,
// oubli lors de l'harmonisation des camemberts) — bordures carrées, pas d'ombre, padding recharts
// par défaut, donc visuellement différent des deux autres alors que c'est la MÊME bibliothèque et
// le MÊME composant <Tooltip> ; jamais un souci de bibliothèque différente. contentStyle/itemStyle
// passés en `style` React classique, recharts ne lit pas de classe CSS ici : les valeurs `var(--...)`
// restent malgré tout résolues par le navigateur (le wrapper du tooltip reste dans l'arbre DOM sous
// <html>, où :root est défini), donc pas de couleur recopiée en dur — mêmes tokens que
// .indicateurs__graphique/.indicateurs__tuile juste au-dessus (--rayon-bordure,
// --couleur-bordure-legere, --couleur-fond) plus --ombre-bloc (déjà utilisé pour
// .bloc-formulaire/.historique-relances) pour détacher visuellement le tooltip du graphique.
// fontSize : aucune variable --taille-* de police n'existe dans variables.css (seule --police-base,
// la famille) — valeur alignée sur .indicateurs__tuile-libelle juste au-dessus (1rem), plus lisible
// que la taille par défaut (trop petite) de DefaultTooltipContent. Posée à la fois sur le wrapper
// (contentStyle, hérite dans les enfants) et sur chaque ligne (itemStyle) : DefaultTooltipContent
// applique itemStyle directement sur le <li>, qui gagnerait sinon sur l'héritage si jamais recharts
// lui fixait sa propre taille par défaut.
const STYLE_TOOLTIP_GRAPHIQUE = {
  backgroundColor: 'var(--couleur-fond)',
  border: '1px solid var(--couleur-bordure-legere)',
  borderRadius: 'var(--rayon-bordure)',
  boxShadow: 'var(--ombre-bloc)',
  padding: '0.75rem 1rem',
  fontSize: '1rem',
  // Explicite plutôt que compté sur l'héritage depuis <body> (styles/blocFormulaire.css) : le
  // wrapper du tooltip reste dans l'arbre DOM sous <html> (voir plus haut), donc hérite déjà
  // --police-base en pratique, mais un contentStyle qui fixe tout le reste (fond/bordure/ombre/
  // padding/taille) sans jamais mentionner la police laisse planer le doute pour le prochain
  // lecteur — posé ici une fois pour les trois graphiques.
  fontFamily: 'var(--police-base)',
};
const STYLE_TOOLTIP_ITEM_GRAPHIQUE = { color: 'var(--couleur-texte)', fontSize: '1rem' };

// Couleur de texte propre aux DEUX camemberts (pas au graphique en barres, qui garde
// STYLE_TOOLTIP_ITEM_GRAPHIQUE/--couleur-texte gris ci-dessus, non demandé ici) — --couleur-texte
// est une couleur neutre "par défaut", peu travaillée ; --couleur-back-office est la teinte
// d'identité déjà portée par le gros chiffre des tuiles KPI (.indicateurs__tuile-valeur) et les
// titres de ces deux graphiques eux-mêmes (.indicateurs__graphique--verdicts/--orientations h2,
// pour le doré ; le brun --couleur-back-office reste la couleur de texte "de travail" du dashboard,
// contraste largement suffisant sur le fond blanc du tooltip). La hiérarchie libellé/valeur (poids
// normal vs semi-gras) ne peut pas passer par ce style JS unique — itemStyle s'applique sur tout le
// <li>, pas séparément sur `.recharts-tooltip-item-name`/`-value` — voir les règles dédiées dans
// Indicateurs.css.
const STYLE_TOOLTIP_ITEM_CAMEMBERT = { color: 'var(--couleur-back-office)', fontSize: '1rem' };

// Corrige le tooltip des camemberts qui remplaçait, au survol, le texte "4 (80%)" affiché en
// permanence dans la part (labelPartCamembert) par un simple "Réussis : 4" — le pourcentage
// disparaissait. recharts ne l'expose pourtant pas via le payload du tooltip par défaut : Pie.js
// calcule bien un `percent` par part (utilisé par labelPartCamembert), mais seulement sur l'objet
// secteur interne — le `tooltipPayload` transmis au Tooltip ne porte que { name, value, payload:
// <donnée brute> }, sans percent (voir recharts/lib/polar/Pie.js, tooltipPayload vs `prev`). D'où
// ce formatter dédié, qui recalcule le total sur le même tableau que le camembert (mêmes valeurs,
// donc même pourcentage arrondi que labelPartCamembert) plutôt que de dépendre d'un champ absent.
function creerFormatteurTooltipCamembert(donnees) {
  const total = donnees.reduce((somme, entree) => somme + entree.total, 0);
  // Une chaîne simple (pas un tableau [valeur, nom]) : seule la valeur affichée est remplacée,
  // recharts garde le nom (libellé) transmis tel quel — voir DefaultTooltipContent.js, `formatted`
  // n'écrase `finalName` que si le formatter renvoie un tableau.
  return (valeur) => `${valeur} (${total > 0 ? Math.round((valeur / total) * 100) : 0}%)`;
}

// Décalage (px) entre le curseur et le coin du tooltip une fois affiché : reste juste à côté du
// pointeur sans jamais être masqué par lui. Appliqué ici, à la coordonnée elle-même, car le prop
// `position` du <Tooltip> ci-dessous (une fois renseigné) court-circuite entièrement le calcul de
// décalage automatique de recharts (voir getTooltipTranslateXY, `if (position && isNumber(...))
// return position[key]` — recharts/lib/util/tooltip/translate.js).
const DECALAGE_TOOLTIP_CURSEUR = 14;

// recharts ne fait PAS suivre le curseur au tooltip d'un camembert par défaut, contrairement à un
// graphique à axes (Bar/Line) : pour un <Pie> (tooltipEventType 'item'), la position du tooltip est
// figée au centroïde de la part dès le survol (Pie.js, tooltipPosition = polarToCartesian(...)) et
// ne bouge plus tant qu'on reste sur la même part — aucun gestionnaire de mousemove continu n'est
// branché pour ce type de graphique (generateCategoricalChart.js, handleItemMouseEnter). recharts
// transmet malgré tout n'importe quel gestionnaire `onMouseMove`/`onMouseEnter` posé sur <Pie> à
// chaque <Sector> avec l'évènement DOM réel (adaptEventsOfChild, onMouseMove fait partie des
// EventKeys reconnus) : c'est ce mécanisme, natif à recharts, qu'on utilise ici pour calculer la
// position réelle du curseur et la transmettre au <Tooltip position={...}>, plutôt que de
// réimplémenter un tooltip positionné à la main en dehors de recharts.
function useSuiviCurseurCamembert() {
  const conteneurRef = useRef(null);
  const [position, setPosition] = useState(null);
  const gererSurvol = (_donnee, _index, evenement) => {
    if (!conteneurRef.current) return;
    const cadre = conteneurRef.current.getBoundingClientRect();
    setPosition({
      x: evenement.clientX - cadre.left + DECALAGE_TOOLTIP_CURSEUR,
      y: evenement.clientY - cadre.top + DECALAGE_TOOLTIP_CURSEUR,
    });
  };
  return { conteneurRef, position, gererSurvol };
}

const FORMAT_POURCENTAGE = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 });

// Label directement lisible sur chaque part des deux camemberts ("Réussis vs ratés",
// "Formation vs prêt à l'embauche") — remplace le label par défaut de recharts (petit chiffre
// excentré + trait de rappel) par le total EN GROS suivi du pourcentage, centré à mi-rayon de la
// part, sans ligne de rappel (voir labelLine={false} sur les <Pie> plus bas) : à seulement 2
// parts par camembert, l'anneau est large, la valeur tient largement à l'intérieur. Le nom de la
// part n'est volontairement pas repris ici (déjà porté par la légende et le Tooltip au survol) —
// "Envoi en formation"/"Prêt à l'embauche" déborderait la part sur un partage très inégal.
// Fonction top-level (pas de dépendance au composant) : reçoit cx/cy/midAngle/rayons/percent/value
// directement de recharts (voir doc `label` en fonction), les calculs de position sont donc ceux
// de la lib, pas une estimation manuelle indépendante.
const RADIAN = Math.PI / 180;
function labelPartCamembert({ cx, cy, midAngle, innerRadius, outerRadius, percent, value }) {
  // Part à 0 masquée plutôt qu'un "0 (0%)" illisible collé au centre (angle nul) — reste visible
  // via la légende, qui liste toujours les deux parts indépendamment de leur valeur.
  if (!value) return null;
  const rayon = innerRadius + (outerRadius - innerRadius) * 0.62;
  const x = cx + rayon * Math.cos(-midAngle * RADIAN);
  const y = cy + rayon * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fill="#fff">
      <tspan x={x} dy="-0.35em" fontSize={18} fontWeight={700}>
        {value}
      </tspan>
      <tspan x={x} dy="1.3em" fontSize={12} fontWeight={500}>
        {`(${Math.round(percent * 100)}%)`}
      </tspan>
    </text>
  );
}

// 'AAAA-MM-JJ' construit directement depuis les composants year/month/day (pas de
// date.toISOString() ici, contrairement à un formatage naïf) : toISOString() convertit d'abord en
// UTC, ce qui décale la date d'un jour en arrière dans un fuseau en avance sur UTC (Europe/Paris,
// CEST = UTC+2) — new Date(2026, 7, 1) (1er août minuit local) redonnerait alors "2026-07-31" via
// toISOString().slice(0, 10), pas "2026-08-01". Sans impact ailleurs dans ce fichier : ce format
// n'est utilisé que par bornesParDefaut ci-dessous.
function formatDateLocaleISO(annee, moisIndex, jour) {
  return `${annee}-${String(moisIndex + 1).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
}

// Bornes par défaut à l'ouverture de l'écran : mois calendaire en cours, du 1er au dernier jour
// (bornes incluses) — pas de période "officielle" définie ailleurs dans le projet pour ce tableau
// de bord, juste une fenêtre de départ raisonnable, entièrement modifiable ensuite via les
// filtres. Calculée dynamiquement à chaque ouverture (jamais une valeur codée en dur) : le dernier
// jour du mois vient de `new Date(annee, moisIndex + 1, 0)` (jour 0 du mois suivant = dernier jour
// du mois courant), qui gère nativement les mois à 28/29/30/31 jours sans table de correspondance.
function bornesParDefaut() {
  const maintenant = new Date();
  const annee = maintenant.getFullYear();
  const moisIndex = maintenant.getMonth();
  const dernierJourDuMois = new Date(annee, moisIndex + 1, 0).getDate();
  return {
    dateDebut: formatDateLocaleISO(annee, moisIndex, 1),
    dateFin: formatDateLocaleISO(annee, moisIndex, dernierJourDuMois),
  };
}

// Tableau de bord KPI back-office (CLAUDE.md, section Tableau de bord : "indicateurs de pilotage
// et filtres, alimenté par les statuts et les motifs collectés tout au long du parcours") —
// réservé à Recruteur/Admin côté serveur (voir backend/src/api/routes/statistiques.routes.js),
// aucune garde de route ici, même principe que le reste du back-office (voir App.jsx).
export default function Indicateurs() {
  const { utilisateur, chargement: chargementSession } = useSession();

  const [periode, setPeriode] = useState(bornesParDefaut);
  const [typePoste, setTypePoste] = useState(''); // '' = toutes (Hôtellerie + Tertiaire)
  const [poste, setPoste] = useState(''); // '' = tous les postes

  const [indicateurs, setIndicateurs] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);

  // Un suivi de curseur indépendant par camembert (voir useSuiviCurseurCamembert plus haut) :
  // chacun a son propre conteneur DOM et sa propre dernière position connue.
  const suiviCurseurVerdicts = useSuiviCurseurCamembert();
  const suiviCurseurOrientations = useSuiviCurseurCamembert();

  // Sélection multiple des cartes/segments cliqués (Set de codes, voir LIBELLES_INDICATEURS plus
  // haut) — état séparé de `indicateurs` ci-dessus (les agrégats affichés sur les cartes/
  // graphiques), qui reste la source de vérité des CHIFFRES ; celui-ci ne pilote que le tableau
  // consolidé sous les graphiques.
  const [selectionIndicateurs, setSelectionIndicateurs] = useState(() => new Set());
  const [dossiersSelectionnes, setDossiersSelectionnes] = useState([]);
  const [chargementTableau, setChargementTableau] = useState(false);
  const [erreurTableau, setErreurTableau] = useState(null);
  // Largeur du panneau latéral "Dossiers sélectionnés" (audit 2026-08-24, décision utilisateur) —
  // simple bascule visuelle, jamais rechargée depuis l'API ni persistée : repart à `false` (largeur
  // par défaut) à chaque rechargement de page, cohérent avec le reste des états d'affichage locaux
  // de cet écran (ex. selectionIndicateurs lui-même).
  const [panneauElargi, setPanneauElargi] = useState(false);

  // Dérivé plutôt que `panneauElargi` seul, répété à trois endroits du rendu (disposition, contenu
  // principal masqué, panneau) — n'agrandit réellement rien tant que le panneau lui-même n'est pas
  // affiché (correctif 2026-08-24, 2e itération) : sans ce garde-fou combiné, activer "Agrandir"
  // puis effacer la sélection laisserait la grille en une seule colonne et le contenu principal
  // masqué alors qu'aucun panneau ne resterait affiché pour justifier l'un ou l'autre.
  const panneauElargiActif = panneauElargi && selectionIndicateurs.size > 0;

  // Active `code` en retirant d'abord son opposé exclusif s'il y en a un et qu'il est
  // actuellement sélectionné (voir PAIRES_INDICATEURS_EXCLUSIFS plus haut) — seul l'AJOUT déclenche
  // cette exclusion ; désélectionner `code` (déjà actif) n'a aucun effet sur son opposé.
  function basculerIndicateur(code) {
    setSelectionIndicateurs((precedent) => {
      const suivant = new Set(precedent);
      if (suivant.has(code)) {
        suivant.delete(code);
      } else {
        const paire = PAIRES_INDICATEURS_EXCLUSIFS.find((p) => p.includes(code));
        const oppose = paire?.find((c) => c !== code);
        if (oppose) suivant.delete(oppose);
        suivant.add(code);
      }
      return suivant;
    });
  }

  const postesDisponibles = useMemo(() => {
    if (typePoste === 'bureau') return POSTES_BUREAU;
    if (typePoste === 'hotel') return POSTES_HOTEL;
    return [...POSTES_BUREAU, ...POSTES_HOTEL];
  }, [typePoste]);

  // Le filtre poste devient incohérent si l'entité change entretemps (ex. "cafetier" alors qu'on
  // repasse sur Tertiaire) — réinitialisé plutôt que laissé sur une valeur que le sélecteur
  // n'affiche plus.
  useEffect(() => {
    if (poste && !postesDisponibles.includes(poste)) setPoste('');
  }, [postesDisponibles, poste]);

  // Dérivé de façon SYNCHRONE (pas seulement via l'effet ci-dessus, qui ne réinitialise `poste`
  // qu'au rendu suivant) : sur le rendu où `typePoste` vient de changer, `poste` peut encore
  // porter la valeur incompatible de l'entité précédente pendant un instant — sans cette valeur
  // dérivée, les appels API ci-dessous (effets suivants, mêmes dépendances) partiraient avec cette
  // combinaison typePoste/poste incohérente le temps d'un aller-retour réseau inutile, avant que
  // l'effet de réinitialisation ne rattrape `poste` au rendu suivant. `posteEffectif` élimine cette
  // fenêtre : jamais transmis au back tant qu'il ne correspond pas à `postesDisponibles`.
  const posteEffectif = poste && postesDisponibles.includes(poste) ? poste : '';

  // Même raisonnement pour un segment de répartition par poste sélectionné ('poste:<code>') :
  // si le typePoste filtré ne propose plus ce poste, sa sélection n'a plus de sens (le segment
  // correspondant a d'ailleurs disparu du graphique). 'poste_non_specifie' (barre "Non spécifié")
  // suit la même logique dès qu'un filtre poste OU typePoste est actif : le back-end court-circuite
  // alors cette catégorie à 0 (voir statistiquesRepository.compterEvaluationsSansPoste/
  // listerEvaluationsSansPosteDossiers — ces évaluations n'ont par définition aucun poste connu à
  // comparer au filtre), la barre disparaît donc aussi du graphique dans ce cas.
  useEffect(() => {
    setSelectionIndicateurs((precedent) => {
      let modifie = false;
      const suivant = new Set(precedent);
      for (const code of suivant) {
        const posteDevenuIndisponible =
          code.startsWith(PREFIXE_POSTE) && !postesDisponibles.includes(code.slice(PREFIXE_POSTE.length));
        const nonSpecifieDevenuIndisponible = code === 'poste_non_specifie' && (typePoste || poste);
        if (posteDevenuIndisponible || nonSpecifieDevenuIndisponible) {
          suivant.delete(code);
          modifie = true;
        }
      }
      return modifie ? suivant : precedent;
    });
  }, [postesDisponibles, typePoste, poste]);

  useEffect(() => {
    let annule = false;
    setChargement(true);
    setErreur(null);
    obtenirIndicateursKpi({
      dateDebut: periode.dateDebut,
      dateFin: periode.dateFin,
      typePoste: typePoste || undefined,
      poste: posteEffectif || undefined,
    })
      .then((valeur) => {
        if (!annule) setIndicateurs(valeur);
      })
      .catch((erreurRequete) => {
        if (!annule) {
          setErreur(erreurRequete.response?.data?.erreur ?? 'Impossible de récupérer les indicateurs.');
        }
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, [periode, typePoste, posteEffectif]);

  // Tableau consolidé : re-fetché à chaque changement de sélection OU de filtres (période/poste/
  // typePoste) — les dossiers listés doivent toujours correspondre aux mêmes critères que les
  // chiffres affichés sur les cartes/graphiques au même instant. Sélection vide : pas d'appel
  // réseau, juste une liste vide (aucune sélection ne peut logiquement rien renvoyer).
  useEffect(() => {
    if (selectionIndicateurs.size === 0) {
      setDossiersSelectionnes([]);
      setErreurTableau(null);
      return;
    }
    let annule = false;
    setChargementTableau(true);
    setErreurTableau(null);
    listerDossiersParIndicateurs({
      dateDebut: periode.dateDebut,
      dateFin: periode.dateFin,
      typePoste: typePoste || undefined,
      poste: posteEffectif || undefined,
      indicateurs: selectionIndicateurs,
    })
      .then((valeur) => {
        if (!annule) setDossiersSelectionnes(valeur);
      })
      .catch((erreurRequete) => {
        if (!annule) {
          setErreurTableau(erreurRequete.response?.data?.erreur ?? 'Impossible de récupérer le détail des dossiers.');
        }
      })
      .finally(() => {
        if (!annule) setChargementTableau(false);
      });
    return () => {
      annule = true;
    };
  }, [selectionIndicateurs, periode, typePoste, posteEffectif]);

  // Rafraîchissement automatique (audit 2026-08-24) : rejoue les deux fetches ci-dessus avec les
  // filtres COURANTS (fermeture sur periode/typePoste/posteEffectif/selectionIndicateurs, toujours
  // à jour via callbackRef, voir useRafraichissementAuto.js) — silencieux, ne touche jamais
  // chargement/chargementTableau pour éviter un flash de "Chargement…" toutes les 45s. Le tableau
  // consolidé n'est rejoué que si une sélection est active, même garde que l'effet ci-dessus.
  useRafraichissementAuto(() => {
    obtenirIndicateursKpi({
      dateDebut: periode.dateDebut,
      dateFin: periode.dateFin,
      typePoste: typePoste || undefined,
      poste: posteEffectif || undefined,
    })
      .then(setIndicateurs)
      .catch(() => {});

    if (selectionIndicateurs.size > 0) {
      listerDossiersParIndicateurs({
        dateDebut: periode.dateDebut,
        dateFin: periode.dateFin,
        typePoste: typePoste || undefined,
        poste: posteEffectif || undefined,
        indicateurs: selectionIndicateurs,
      })
        .then(setDossiersSelectionnes)
        .catch(() => {});
    }
  });

  // Session sans objet à vérifier ici (RouteProtegee, App.jsx, redirige déjà vers /connexion avant
  // même de monter cette page en l'absence de session) — `!utilisateur` ne couvre plus qu'un très
  // bref instant où le useSession() PROPRE à cette page (ci-dessus) n'a pas encore résolu le sien
  // (deuxième appel indépendant, même patron que le reste du back-office — voir
  // BoutonNouvelleInscription.jsx), jamais un visiteur réellement non connecté.
  if (chargementSession || !utilisateur) {
    return (
      <PageBackOffice>
        <p>Chargement de la session…</p>
      </PageBackOffice>
    );
  }

  // `code` : indicateur associé à ce segment (voir LIBELLES_INDICATEURS/basculerIndicateur plus
  // haut) — toujours présent, y compris pour "Non spécifié" (posteCode null, code
  // 'poste_non_specifie' plutôt que le préfixe 'poste:<code>', voir plus bas : "aucun poste
  // renseigné" n'est pas un poste parmi POSTES_BUREAU/POSTES_HOTEL).
  const donneesVerdicts = indicateurs
    ? [
        { nom: 'Réussis', total: indicateurs.verdicts.valide, code: 'verdict_valide', fill: COULEURS_VERDICT.verdict_valide },
        { nom: 'Ratés', total: indicateurs.verdicts.invalide, code: 'verdict_invalide', fill: COULEURS_VERDICT.verdict_invalide },
      ]
    : [];
  const formatteurTooltipVerdicts = creerFormatteurTooltipCamembert(donneesVerdicts);

  const donneesOrientations = indicateurs
    ? [
        {
          nom: 'Envoi en formation',
          total: indicateurs.orientations.envoi_formation,
          code: 'orientation_envoi_formation',
          fill: COULEURS_ORIENTATION.orientation_envoi_formation,
        },
        {
          nom: 'Prêt à l’embauche',
          total: indicateurs.orientations.pret_embauche,
          code: 'orientation_pret_embauche',
          fill: COULEURS_ORIENTATION.orientation_pret_embauche,
        },
      ]
    : [];
  const formatteurTooltipOrientations = creerFormatteurTooltipCamembert(donneesOrientations);

  const donneesRepartitionPoste = indicateurs
    ? indicateurs.repartitionParPoste.parEvaluation.map((ligne) => ({
        nom: libellePoste(ligne.posteCode),
        total: ligne.nbEvaluations,
        code: ligne.posteCode ? `${PREFIXE_POSTE}${ligne.posteCode}` : 'poste_non_specifie',
        fill: ligne.posteCode ? (COULEURS_POSTE[ligne.posteCode] ?? COULEUR_POSTE_NON_SPECIFIE) : COULEUR_POSTE_NON_SPECIFIE,
      }))
    : [];

  return (
    <PageBackOffice>
      <div className="indicateurs">
        <header className="indicateurs__entete">
          {/* Devant le titre, sur la même ligne (décision utilisateur, 2026-08-13) — aucun autre
              écran back-office n'a ce patron précis (voir HistoriqueEvaluations.jsx, titre+bouton
              empilés en colonne, ou Validation.jsx/Planification.jsx, bouton sous le header aligné
              à droite) : .indicateurs__titre-bloc reste local à cette page. */}
          <div className="indicateurs__titre-bloc">
            {/* Bouton "Retour backoffice recruteur" retiré (refonte navigation, 2026-08-17) :
                couvert par le lien "Back-office recruteur" de la barre de navigation commune,
                voir BarreNavigation.jsx (montée dans PageBackOffice.jsx). */}
            <h1>Tableau de bord - Indicateurs</h1>
          </div>
          <EnTeteBackOffice />
        </header>

        <div className="indicateurs__filtres">
          <label className="indicateurs__filtre">
            <span>Du</span>
            <input
              type="date"
              value={periode.dateDebut}
              max={periode.dateFin}
              onChange={(evenement) => setPeriode((precedent) => ({ ...precedent, dateDebut: evenement.target.value }))}
            />
          </label>
          <label className="indicateurs__filtre">
            <span>Au</span>
            <input
              type="date"
              value={periode.dateFin}
              min={periode.dateDebut}
              onChange={(evenement) => setPeriode((precedent) => ({ ...precedent, dateFin: evenement.target.value }))}
            />
          </label>
          <label className="indicateurs__filtre">
            <span>Entité</span>
            <select value={typePoste} onChange={(evenement) => setTypePoste(evenement.target.value)}>
              <option value="">Toutes (Hôtellerie + Tertiaire)</option>
              <option value="hotel">Hôtellerie</option>
              <option value="bureau">Tertiaire</option>
            </select>
          </label>
          <label className="indicateurs__filtre">
            <span>Poste</span>
            <select value={poste} onChange={(evenement) => setPoste(evenement.target.value)}>
              <option value="">{libelleOptionTousLesPostes(typePoste)}</option>
              {postesDisponibles.map((code) => (
                <option key={code} value={code}>
                  {libellePoste(code)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {chargement && <p>Chargement des indicateurs…</p>}
        {erreur && <p role="alert">{erreur}</p>}

        {/* Mode dégradé du back-office (audit 2026-08-24) — les tuiles/graphiques/tableau
            partagent un seul fetch (obtenirIndicateursKpi, sauf le tableau consolidé qui a le
            sien, listerDossiersParIndicateurs) mais restent des sous-arbres de RENDU distincts :
            une ErrorBoundary par section limite un plantage de rendu (donnée inattendue, bug
            recharts...) à cette seule section plutôt qu'à toute la page. L'état interactif partagé
            (selectionIndicateurs, qui relie tuiles/segments/tableau) vit dans ce composant parent,
            jamais dans une section : le déclenchement d'une limite n'y touche donc pas, les
            sections encore valides restent pleinement interactives. */}
        {!chargement && !erreur && indicateurs && (
          <>
            {/* Disposition deux colonnes (audit 2026-08-24, décision utilisateur) : tuiles/
                graphiques à gauche (majorité de la largeur), panneau "Dossiers sélectionnés" fixe
                à droite — colonne CSS Grid `auto` dimensionnée par la largeur explicite du panneau
                lui-même (.indicateurs__panneau-lateral), pas par une variable posée sur le
                conteneur : une custom property CSS posée sur un enfant n'est jamais visible par le
                grid-template-columns de son parent (elle ne "remonte" pas), contrairement à une
                variable posée directement ici. min-width: 0 sur .indicateurs__contenu-principal
                (voir Indicateurs.css) : sans elle, la grille de graphiques (deux camemberts
                40%/40%) empêcherait la colonne principale de rétrécir sous sa largeur de contenu
                naturelle, poussant le panneau hors de l'écran plutôt que de laisser le texte des
                graphiques s'adapter. En dessous d'un certain seuil (Indicateurs.css, @media), les
                deux colonnes s'empilent — le panneau repasse en pleine largeur SOUS le contenu
                principal, comportement identique à avant cette réorganisation, jamais de
                débordement horizontal forcé. Classe --panneau-elargi (audit 2026-08-24, corrigée
                une 2e fois le même jour) posée ici, sur ce conteneur grid, et pas seulement sur
                .indicateurs__panneau-lateral : grid-template-columns se lit sur le PARENT grid,
                jamais sur l'enfant (voir Indicateurs.css) — le panneau seul ne peut pas s'élargir
                au-delà de la colonne que ce conteneur lui accorde. panneauElargiActif (pas
                panneauElargi seul, voir sa déclaration plus haut) : combine la garantie qu'un
                panneau réellement affiché justifie ce passage à une seule colonne. */}
            <div
              className={`indicateurs__disposition${panneauElargiActif ? ' indicateurs__disposition--panneau-elargi' : ''}`}
            >
            {/* Masqué entièrement (display: none, pas une simple diminution d'opacité/largeur) en
                mode agrandi — correctif chevauchement 2026-08-24 : un précédent essai réduisait
                cette colonne à ~10% de largeur via la grille plutôt que de la masquer, mais son
                CONTENU (tuiles, camemberts recharts) ne suivait pas ce rétrécissement et débordait
                visuellement par-dessus le panneau. display: none retire ce nœud de la mise en page,
                aucun contenu ne peut donc plus déborder nulle part. */}
            <div
              className={`indicateurs__contenu-principal${panneauElargiActif ? ' indicateurs__contenu-principal--masque' : ''}`}
            >
            <ErrorBoundary titre="Indicateurs (tuiles)">
            <div className="indicateurs__tuiles">
              {/* Bouton plutôt qu'un <div> statique : sélection multiple des cartes (voir
                  basculerIndicateur plus haut), accessible au clavier sans rien ajouter. Chaque
                  carte reste indépendamment sélectionnable (pas un groupe radio) : rien n'empêche
                  de croiser "Inscrits" et "Envoyé en test" dans le tableau consolidé.
                  Modificateur `indicateurs__tuile--<variante>` (voir Indicateurs.css) : une couleur
                  distincte par tuile, décision utilisateur 2026-08-11 — réutilise EXACTEMENT les
                  variantes déjà attribuées à ces mêmes codes dans VARIANTE_PAR_INDICATEUR plus haut
                  (badges de la colonne "Indicateurs"), pour que la couleur d'une tuile et celle de
                  son badge restent cohérentes partout sur l'écran. Exception : `delai_test_verdict`
                  prend `violet` ici (pas `attente`, son variante de badge) — les deux tuiles de
                  délai partagent la même variante `attente` côté badge, ce qui les aurait rendues
                  indiscernables l'une de l'autre en tuile ; `violet` n'est déjà utilisée par aucune
                  autre tuile. */}
              <button
                type="button"
                className={`indicateurs__tuile indicateurs__tuile--neutre${selectionIndicateurs.has('inscrits') ? ' indicateurs__tuile--active' : ''}`}
                aria-pressed={selectionIndicateurs.has('inscrits')}
                onClick={() => basculerIndicateur('inscrits')}
              >
                <span className="indicateurs__tuile-valeur">{indicateurs.inscrits.total}</span>
                {/* "Inscriptions" (pas "Inscrits", audit 2026-08-24) : le workflow v5 a donné au
                    statut `nouveau` le libellé exact "Inscrit" (voir workflow.config.json) — cette
                    tuile reste un TOTAL DE COHORTE (tous statuts confondus sur la période, voir
                    compterInscrits, statistiquesRepository.js), pas "combien de dossiers sont
                    actuellement au statut Inscrit" ; même collision, même principe de correction
                    que `conversion` ("Converti" → "Retenu", clarification du 2026-08-11), logique
                    de calcul strictement inchangée. */}
                <span className="indicateurs__tuile-libelle">Inscriptions</span>
              </button>
              <button
                type="button"
                className={`indicateurs__tuile indicateurs__tuile--bleu${selectionIndicateurs.has('envoyes_en_test') ? ' indicateurs__tuile--active' : ''}`}
                aria-pressed={selectionIndicateurs.has('envoyes_en_test')}
                onClick={() => basculerIndicateur('envoyes_en_test')}
              >
                <span className="indicateurs__tuile-valeur">{indicateurs.envoyesEnTest.total}</span>
                <span className="indicateurs__tuile-libelle">Envoyé en test</span>
              </button>
              <button
                type="button"
                className={`indicateurs__tuile indicateurs__tuile--dore${selectionIndicateurs.has('conversion') ? ' indicateurs__tuile--active' : ''}`}
                aria-pressed={selectionIndicateurs.has('conversion')}
                onClick={() => basculerIndicateur('conversion')}
              >
                <span className="indicateurs__tuile-valeur">
                  {indicateurs.conversion.taux !== null ? FORMAT_POURCENTAGE.format(indicateurs.conversion.taux) : '-'}
                </span>
                {/* "Taux de dossiers validés à ce jour" (pas "Taux de validation") : clarification
                    d'audit 2026-08-11 — l'indicateur est un instantané du statut ACTUEL de la
                    cohorte d'inscrits de la période, pas les validations survenues PENDANT la
                    période ; revisiter ce même dashboard plus tard pour la même période passée
                    donnerait un chiffre différent (voir LIBELLES_INDICATEURS.conversion, badge
                    "Retenu" associé). */}
                <span className="indicateurs__tuile-libelle">
                  Taux de dossiers validés à ce jour ({indicateurs.conversion.numerateur}/
                  {indicateurs.conversion.denominateur})
                </span>
              </button>
              <button
                type="button"
                className={`indicateurs__tuile indicateurs__tuile--attente${selectionIndicateurs.has('delai_inscription_test') ? ' indicateurs__tuile--active' : ''}`}
                aria-pressed={selectionIndicateurs.has('delai_inscription_test')}
                onClick={() => basculerIndicateur('delai_inscription_test')}
                title={PRECISION_DELAI_MOYEN}
              >
                <span className="indicateurs__tuile-valeur">
                  {indicateurs.delaisMoyens.inscriptionVersTestPlanifie.moyenneJours ?? '-'} j
                </span>
                <span className="indicateurs__tuile-libelle">Délai moyen inscription → test planifié</span>
                <span className="indicateurs__tuile-precision">Moyenne, jours écoulés</span>
              </button>
              <button
                type="button"
                className={`indicateurs__tuile indicateurs__tuile--violet${selectionIndicateurs.has('delai_test_verdict') ? ' indicateurs__tuile--active' : ''}`}
                aria-pressed={selectionIndicateurs.has('delai_test_verdict')}
                onClick={() => basculerIndicateur('delai_test_verdict')}
                title={PRECISION_DELAI_MOYEN}
              >
                <span className="indicateurs__tuile-valeur">
                  {indicateurs.delaisMoyens.testVersVerdict.moyenneJours ?? '-'} j
                </span>
                <span className="indicateurs__tuile-libelle">Délai moyen test → verdict</span>
                <span className="indicateurs__tuile-precision">Moyenne, jours écoulés</span>
              </button>
            </div>
            </ErrorBoundary>

            <div className="indicateurs__graphiques">
              <ErrorBoundary titre="Tests réussis vs ratés">
              <section className="indicateurs__graphique indicateurs__graphique--camembert indicateurs__graphique--verdicts">
                <h2>Tests réussis vs ratés</h2>
                {donneesVerdicts.every((entree) => entree.total === 0) ? (
                  <p className="indicateurs__vide">Aucun verdict sur la période.</p>
                ) : (
                  <div ref={suiviCurseurVerdicts.conteneurRef}>
                    <ResponsiveContainer width="100%" height={185}>
                      <PieChart>
                        {/* cx décalé vers la droite du centre (pas 50%, ni le 38% initial — voir
                            historique) : avec la grille corrigée à deux colonnes fixes
                            (.indicateurs__graphiques, Indicateurs.css), ce cadre est maintenant
                            assez large pour qu'un centrage trop à gauche laisse un grand vide entre
                            le bord droit du camembert et la légende (align="right", voir
                            ci-dessous) — 45% rapproche les deux plutôt que de les laisser à leurs
                            extrémités respectives avec un vide entre les deux. outerRadius relevé à
                            "92%" (labels désormais À L'INTÉRIEUR de la part — labelPartCamembert
                            plus haut — donc plus besoin de marge extérieure pour un label+ligne de
                            rappel) : un camembert plus grand comble aussi une partie de ce vide par
                            lui-même. height du ResponsiveContainer réduite à 185 (audit 2026-08-31,
                            décision utilisateur : la page doit tenir sans défilement sur un écran
                            1080p — 320 restait disproportionné pour seulement 2 parts par camembert)
                            : outerRadius restant un pourcentage, le camembert rétrécit
                            proportionnellement sans autre changement ici ; la légende (layout
                            vertical, voir <Legend> plus bas) reste lisible à cette taille, seuls
                            deux libellés courts à afficher. */}
                        <Pie
                          data={donneesVerdicts}
                          dataKey="total"
                          nameKey="nom"
                          cx="45%"
                          outerRadius="92%"
                          label={labelPartCamembert}
                          labelLine={false}
                          onMouseEnter={suiviCurseurVerdicts.gererSurvol}
                          onMouseMove={suiviCurseurVerdicts.gererSurvol}
                        >
                          {donneesVerdicts.map((entree) => (
                            // Segment cliquable (voir basculerIndicateur) : opacité réduite pour les
                            // segments non sélectionnés dès qu'AU MOINS UN segment (toutes cartes/
                            // graphiques confondus) est sélectionné, contour renforcé sur les
                            // segments actifs — même logique de mise en évidence que les tuiles
                            // ci-dessus (classe --active), adaptée aux props recharts (pas de
                            // className sur <Cell>). `fill` porté par la donnée elle-même (voir
                            // donneesVerdicts, COULEURS_VERDICT) plutôt qu'indexé par position :
                            // couleur stable par indicateur, pas par rang d'affichage.
                            <Cell
                              key={entree.nom}
                              fill={entree.fill}
                              cursor="pointer"
                              opacity={selectionIndicateurs.size === 0 || selectionIndicateurs.has(entree.code) ? 1 : 0.35}
                              stroke={selectionIndicateurs.has(entree.code) ? '#1a1a1a' : undefined}
                              strokeWidth={selectionIndicateurs.has(entree.code) ? 2 : undefined}
                              onClick={() => basculerIndicateur(entree.code)}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={STYLE_TOOLTIP_GRAPHIQUE}
                          itemStyle={STYLE_TOOLTIP_ITEM_CAMEMBERT}
                          position={suiviCurseurVerdicts.position ?? undefined}
                          formatter={formatteurTooltipVerdicts}
                        />
                        {/* Légende en bas à droite du cadre (pas au centre vertical) : reste posée
                            dans le même coin que la légende repositionnée à droite (voir plus haut),
                            sans couper la moitié supérieure du camembert en deux zones visuelles
                            distinctes — le bloc légende se lit comme une seule unité avec le
                            camembert au lieu de flotter au milieu. */}
                        <Legend layout="vertical" align="right" verticalAlign="bottom" />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </section>
              </ErrorBoundary>

              <ErrorBoundary titre="Formation vs prêt à l’embauche">
              <section className="indicateurs__graphique indicateurs__graphique--camembert indicateurs__graphique--orientations">
                <h2>Formation vs prêt à l’embauche</h2>
                {donneesOrientations.every((entree) => entree.total === 0) ? (
                  <p className="indicateurs__vide">Aucune orientation sur la période.</p>
                ) : (
                  <div ref={suiviCurseurOrientations.conteneurRef}>
                    <ResponsiveContainer width="100%" height={185}>
                      <PieChart>
                        {/* Même camembert que "Tests réussis vs ratés" ci-dessus — taille et style
                            volontairement identiques (cx, outerRadius, label, légende) : cohérence
                            visuelle entre les deux graphiques du même écran, voir CLAUDE.md. */}
                        <Pie
                          data={donneesOrientations}
                          dataKey="total"
                          nameKey="nom"
                          cx="45%"
                          outerRadius="92%"
                          label={labelPartCamembert}
                          labelLine={false}
                          onMouseEnter={suiviCurseurOrientations.gererSurvol}
                          onMouseMove={suiviCurseurOrientations.gererSurvol}
                        >
                          {donneesOrientations.map((entree) => (
                            <Cell
                              key={entree.nom}
                              fill={entree.fill}
                              cursor="pointer"
                              opacity={selectionIndicateurs.size === 0 || selectionIndicateurs.has(entree.code) ? 1 : 0.35}
                              stroke={selectionIndicateurs.has(entree.code) ? '#1a1a1a' : undefined}
                              strokeWidth={selectionIndicateurs.has(entree.code) ? 2 : undefined}
                              onClick={() => basculerIndicateur(entree.code)}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={STYLE_TOOLTIP_GRAPHIQUE}
                          itemStyle={STYLE_TOOLTIP_ITEM_CAMEMBERT}
                          position={suiviCurseurOrientations.position ?? undefined}
                          formatter={formatteurTooltipOrientations}
                        />
                        <Legend layout="vertical" align="right" verticalAlign="bottom" />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </section>
              </ErrorBoundary>

              <ErrorBoundary titre="Répartition par poste">
              <section className="indicateurs__graphique indicateurs__graphique--large">
                <h2>Répartition par poste (évaluations distinctes)</h2>
                {donneesRepartitionPoste.length === 0 ? (
                  <p className="indicateurs__vide">Aucune évaluation sur la période.</p>
                ) : (
                  // height réduite à 175 (audit 2026-08-31, décision utilisateur : la page doit
                  // tenir sans défilement sur un écran 1080p, comme les deux camemberts ci-dessus)
                  // — XAxis height=80 (espace réservé aux libellés de poste inclinés) inchangée,
                  // toujours comprise dans ce total, donc toujours assez de place pour les libellés
                  // les plus longs ("Femme/Valet de chambre") sans les couper.
                  <ResponsiveContainer width="100%" height={175}>
                    <BarChart data={donneesRepartitionPoste}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="nom" interval={0} angle={-20} textAnchor="end" height={80} />
                      <YAxis allowDecimals={false} />
                      <Tooltip contentStyle={STYLE_TOOLTIP_GRAPHIQUE} itemStyle={STYLE_TOOLTIP_ITEM_GRAPHIQUE} />
                      {/* <Cell> par barre (comme pour les camemberts ci-dessus) : chaque barre a
                          son propre indicateur, "poste:<code>" ou 'poste_non_specifie' pour la
                          barre "Non spécifié" (voir donneesRepartitionPoste) — toutes cliquables
                          de façon identique, aucun cas particulier ici. `fill` du <Bar> gardé comme
                          repli (jamais utilisé en pratique : chaque barre a son propre <Cell fill>,
                          voir COULEURS_POSTE) plutôt qu'une seule teinte pour toutes les barres. */}
                      <Bar dataKey="total" fill={COULEUR_POSTE_NON_SPECIFIE}>
                        {donneesRepartitionPoste.map((entree) => (
                          <Cell
                            key={entree.nom}
                            fill={entree.fill}
                            cursor="pointer"
                            opacity={selectionIndicateurs.size === 0 || selectionIndicateurs.has(entree.code) ? 1 : 0.35}
                            stroke={selectionIndicateurs.has(entree.code) ? '#1a1a1a' : undefined}
                            strokeWidth={selectionIndicateurs.has(entree.code) ? 2 : undefined}
                            onClick={() => basculerIndicateur(entree.code)}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </section>
              </ErrorBoundary>
            </div>
            </div>

            {/* Panneau latéral "Dossiers sélectionnés" — uniquement visible dès qu'au moins une
                carte/segment est sélectionné (comportement inchangé, seulement repositionné en
                colonne fixe à droite, voir .indicateurs__disposition ci-dessus) : garde la
                sélection visible pendant qu'on consulte le détail, voir l'audit préalable à cette
                fonctionnalité. Hauteur alignée sur la colonne de gauche en CSS pur (grid
                align-items: stretch + height: 100% sur .indicateurs__panneau-lateral, voir
                Indicateurs.css) — plus de mesure JS (les itérations précédentes, mesure en px via
                ResizeObserver/getBoundingClientRect appliquée en style inline, se sont révélées
                fragiles face au timing de la transition CSS du bouton d'agrandissement). */}
            {selectionIndicateurs.size > 0 && (
              <aside
                className={`indicateurs__panneau-lateral${panneauElargi ? ' indicateurs__panneau-lateral--elargi' : ''}`}
              >
                <ErrorBoundary titre="Dossiers sélectionnés">
                <section className="indicateurs__tableau-consolide">
                  <div className="indicateurs__tableau-consolide-entete">
                    <h2>Dossiers sélectionnés ({selectionIndicateurs.size} indicateur(s))</h2>
                    <div className="indicateurs__tableau-consolide-actions">
                      {/* Icône seule (»/«) + aria-label explicite : élargit le panneau (280px ->
                          480px, voir Indicateurs.css) pour afficher plus de colonnes/détails par
                          ligne sans recharger la page ni masquer le reste du tableau de bord — un
                          second clic revient à la largeur par défaut. Purement visuel (CSS), la
                          liste de dossiers/le filtre par indicateurs restent inchangés par ce
                          bouton. */}
                      <button
                        type="button"
                        className="indicateurs__bouton-agrandir"
                        aria-expanded={panneauElargi}
                        aria-label={panneauElargi ? 'Réduire le panneau' : 'Agrandir le panneau'}
                        title={panneauElargi ? 'Réduire le panneau' : 'Agrandir le panneau'}
                        onClick={() => setPanneauElargi((precedent) => !precedent)}
                      >
                        {panneauElargi ? '«' : '»'}
                      </button>
                      {/* Classe --effacer (distinction visuelle, audit 2026-08-25) : même intention
                          que sur Dossiers candidats/Suivi des tests (TableauDeBordAccueil.css/
                          Planification.css) — une réinitialisation d'affichage doit se distinguer
                          visuellement, ici du bouton d'agrandissement voisin. Teinte grise/ardoise
                          (fond clair ici, pas de dégradé back-office) plutôt que le fantôme blanc
                          translucide des deux autres pages, voir Indicateurs.css. */}
                      <button
                        type="button"
                        className="indicateurs__bouton-effacer-selection"
                        onClick={() => setSelectionIndicateurs(new Set())}
                      >
                        Effacer la sélection
                      </button>
                    </div>
                  </div>
                  {chargementTableau && <p>Chargement des dossiers…</p>}
                  {erreurTableau && <p role="alert">{erreurTableau}</p>}
                  {!chargementTableau && !erreurTableau && (
                    <TableauDossiersSelectionnes
                      dossiers={dossiersSelectionnes}
                      libellePoste={libellePoste}
                      libelleIndicateur={libelleIndicateur}
                      varianteIndicateur={varianteIndicateur}
                      varianteStatut={varianteStatut}
                      estIndicateurPoste={estIndicateurPoste}
                      libelleDateCle={libelleDateCle}
                      varianteDateCle={varianteDateCle}
                      ordreCanoniqueIndicateurs={ORDRE_CANONIQUE_INDICATEURS}
                    />
                  )}
                </section>
                </ErrorBoundary>
              </aside>
            )}
            </div>
          </>
        )}
      </div>
    </PageBackOffice>
  );
}
