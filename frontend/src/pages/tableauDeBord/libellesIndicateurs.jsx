// Libellés, couleurs et codes des indicateurs du tableau de bord (Indicateurs.jsx) — fonctions
// et constantes pures, testées dans libellesIndicateurs.test.js.
import { useRef, useState } from 'react';
import { LIBELLES_POSTE } from '../../core/referentiels/postes';

// Même mapping (nettoyé des résidus workflow v3/hérité) que TableauDeBordAccueil.jsx/
// Backoffice.jsx — dupliqué plutôt que partagé (voir CLAUDE.md conventions du projet), sert ici
// à la colonne "Statut" du tableau consolidé (voir plus bas, TableauDossiersSelectionnes).
const VARIANTE_PAR_CODE_STATUT_ACCECIT = {
  // 'nouveau' retiré (audit 2026-08-19, même correctif que TableauDeBordAccueil.jsx) : plus
  // aucun dossier ne peut atteindre ce statut aujourd'hui.
  en_attente_pieces: 'attente',
  en_attente_verification: 'attente',
  test_planifie: 'bleu',
  // 'test_realise' (audit tableau de bord 2026-08-31, nouvelle carte "Effectifs par statut") :
  // 'violet', même variante que sur Validation.jsx/TableauDeBordAccueil.jsx.
  test_realise: 'violet',
  test_non_realise: 'alerte',
  invalide: 'echec',
  valide_envoi_formation: 'succes',
  valide_pret_embauche: 'vert-clair',
  // Suivi de formation : 'echec-fort', distinct de 'echec' ("Invalidé") — voir
  // VerificationPieces.jsx pour le détail du choix de couleur.
  formation_non_validee: 'echec-fort',
  // Statut terminal "Embauché" : 'vert-fonce', même variante que partout
  // ailleurs dans l'app (voir variables.css, StatutBadge.css).
  embauche: 'vert-fonce',
};
export function varianteStatut(code) {
  return VARIANTE_PAR_CODE_STATUT_ACCECIT[code] ?? 'neutre';
}

// Codes des indicateurs cliquables des cartes/camemberts (statiques — la répartition par poste,
// dynamique, a son propre préfixe 'poste:<code>', voir libelleIndicateur/varianteIndicateur plus
// bas) — mêmes codes que backend/src/core/statistiques/statistiquesService.js
// (CODES_INDICATEURS_STATIQUES), dupliqué plutôt que partagé (voir plus haut).
// Libellés pensés pour rester compréhensibles isolément, sans dépendre du statut affiché juste à
// côté (colonne "Indicateurs" de TableauDossiersSelectionnes.jsx) — un badge peut désormais rester
// visible même quand il est redondant avec ce statut (décision Option A, 2026-08-10 : plus de
// filtrage de redondance, voir TableauDossiersSelectionnes.jsx).
//
// Clarifications d'audit, 2026-08-11 (pas de changement de comportement, uniquement de libellé) :
// - `conversion` : "Retenu" plutôt que "Converti" — l'audit a relevé que cet indicateur est un
//   INSTANTANÉ du statut ACTUEL d'une cohorte d'inscrits (valide_pret_embauche OU
//   valide_envoi_formation), pas un événement daté dans la période. "Validé" seul aurait fait
//   doublon visuel avec la colonne "Statut", qui affiche déjà "Validé - prêt à l'embauche"/"Validé -
//   envoyé en formation" ; "Recruté" sur-affirmerait pour la branche "envoyé en formation" (pas
//   encore embauché à ce stade du parcours) — "Retenu" couvre les deux sans ambiguïté. Sa tuile
//   "Taux de dossiers validés à ce jour" a été retirée de la rangée de KPI le 2026-09-01 (audit
//   tableau de bord 2026-08-31, point d'audit) : l'indicateur back-end (conversion) reste inchangé,
//   seul l'affichage disparaît de cet écran.
// - `envoyes_en_test` : "Envoyé en test" (revenu du "Mis en test" choisi juste après l'audit du
//   2026-08-11, décision utilisateur ultérieure du même jour) — reste distinct du badge de STATUT
//   "Test planifié" déjà existant (mots différents), sans reprendre "Test envoyé"/"Envoyés en
//   test" (libellé d'origine, plus ambigu sur "test réalisé ou non").
// `delai_test_verdict` : libellé laissé inchangé (confirmé) — jamais ambigu vis-à-vis du statut
// affiché à côté, contrairement aux indicateurs renommés ci-dessus. Son ambiguïté à lui est d'une
// autre nature (moyenne de période vs valeur par dossier) — traitée au niveau des TUILES agrégées
// (voir `title`/`.indicateurs__tuile-precision` plus bas), pas ici.
// `delai_inscription_test` : renommé le 2026-09-02 (décision utilisateur) — "Délai Inscription →
// Envoi en test" (casse du "E" puis du "I" corrigée le même jour) plutôt que "Délai inscription →
// test" (badge)/"Délai moyen inscription → test planifié" (tuile, voir plus bas) : "test" seul prêtait à
// confusion avec le statut "Test planifié" déjà affiché à côté, alors que l'événement mesuré est
// bien l'ENVOI en test (transition vers test_planifie), pas le déroulement du test lui-même.
// Logique de calcul strictement inchangée (statistiquesRepository.delaiInscriptionVersTestPlanifie)
// — uniquement le texte affiché.
// `orientation_envoi_formation`/`orientation_pret_embauche` : "Envoyé en formation"/"Prêt à
// l'embauche" — remplace "Orienté formation"/"Orienté embauche"
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
  delai_inscription_test: 'Délai Inscription → Envoi en test',
  delai_test_verdict: 'Délai test → verdict',
  // Introduit le 2026-09-01 (audit tableau de bord 2026-08-31, point #5) — remplace la tuile
  // "Délai moyen test → verdict" ci-dessus (delai_test_verdict reste un code back-end valide, mais
  // n'a plus de tuile pour le sélectionner sur cet écran).
  delai_formation: 'Délai Test → Formation',
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
export const ORDRE_CANONIQUE_INDICATEURS = Object.keys(LIBELLES_INDICATEURS);

// Tuiles "Délai moyen Inscription → Envoi en test"/"Délai moyen Test → Formation" — clarification
// d'audit, 2026-08-11 : le chiffre affiché ici est une MOYENNE en jours ÉCOULÉS (temps réel,
// valeur fractionnaire arrondie à 1 décimale, voir statistiquesService.versMoyenneJours) sur TOUS
// les dossiers de la période, alors que la même mesure affichée PAR DOSSIER dans la colonne
// "Dates clés" (TableauDossiersSelectionnes.jsx) est un nombre de jours CALENDAIRES entiers pour
// UN dossier — deux échelles différentes pour un intitulé proche, d'où le risque de confusion
// relevé par l'audit. Un tooltip natif (`title`) portait cette précision au survol jusqu'au
// 2026-09-02 (décision utilisateur : retiré, gênait la lecture de l'écran au survol) —
// `.indicateurs__tuile-precision` (texte visible, pas seulement au survol) reste seul porteur de
// cette nuance sur les deux tuiles concernées.

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
  delai_formation: 'attente',
  verdict_valide: 'succes',
  verdict_invalide: 'echec',
  orientation_envoi_formation: 'violet',
  orientation_pret_embauche: 'vert-clair',
  // Même variante que les barres 'poste:<code>' (voir varianteIndicateur plus bas) : reste dans
  // la même famille visuelle "répartition par poste" que les autres barres du même graphique.
  poste_non_specifie: 'dore',
};
export const PREFIXE_POSTE = 'poste:';

// Préfixe historique des cartes "Effectifs par statut" (audit tableau de bord 2026-08-31) — section
// SUPPRIMÉE le 2026-09-14 (demande utilisateur, confirmé par audit : 3 des 4 cartes — "Validé -
// prêt à l'embauche"/"Formation non validée"/"Embauché" — étaient de purs doublons des badges déjà
// présents sur "Dossiers candidats", statut courant sans logique historique propre). "Test réalisé"
// (seule des 4 à un calcul réellement distinct, historique/compterParHistoriqueStatut) avait
// d'abord été relocalisée dans la ligne "Volumétrie sur la période", puis RETIRÉE à son tour le
// même jour (demande utilisateur explicite, retrait purement visuel) — plus aucune carte de cet
// ex-écran nulle part sur cette page. PREFIXE_STATUT reste néanmoins déclaré : encore référencé
// génériquement par libelleIndicateur/varianteIndicateur/varianteDateCle plus bas (résolution
// GÉNÉRIQUE d'un préfixe 'statut:<code>' quelconque, symétrique de PREFIXE_POSTE ci-dessus — voir
// aussi statistiquesService.PREFIXE_STATUT/resoudreListeIndicateur côté back, également générique,
// jamais restreinte à une liste de cartes), même si plus aucun bouton de cet écran ne produit
// aujourd'hui de code sous ce préfixe.
const PREFIXE_STATUT = 'statut:';

// Préfixe des 4 cartes "Volumétrie sur la période" (audit dashboard 2026-09-02, rendues
// cliquables/filtrantes le même jour, 2e passe — jusque-là de simples compteurs sans sélection ;
// "Formations non validées" ajoutée le 2026-09-14 ; "Test réalisé" a un temps cohabité ici avant
// d'en être retirée le même jour, voir le commentaire de PREFIXE_STATUT ci-dessus) —
// GÉNÉRIQUE côté back (statistiquesService.PREFIXE_VOLUMETRIE, resoudreListeIndicateur), même
// mécanisme de sélection/filtrage que le reste de l'écran (basculerIndicateur/selectionIndicateurs,
// aucune adaptation nécessaire) — mais DISTINCT de PREFIXE_STATUT ci-dessus :
// ces cartes comptent des OCCURRENCES d'événement, jamais dédupliquées par dossier (charge de
// travail réelle — sessions de test tenues, formations conduites : un dossier retesté/reformé
// compte plusieurs fois, voir statistiquesRepository.listerOccurrencesHistorique/
// listerOccurrencesFormationValidee), alors que 'statut:<code>' compte des dossiers DISTINCTS — le
// tableau "Dossiers sélectionnés" affiche malgré tout chaque dossier UNE SEULE FOIS pour les deux
// (même mécanisme de dédup côté back, voir listerDossiersParIndicateurs), seule la colonne "Dates
// clés" diffère : plusieurs dates listées pour 'volumetrie:<code>' (voir
// TableauDossiersSelectionnes.jsx, occurrencesVolumetrie), une seule pour 'statut:<code>'. "Test
// validé"/"Test invalidé" (redondant avec le camembert "Tests validés vs invalidés") et "Embauché"
// (jugé non pertinent en volume) ne sont volontairement PAS repris ici — décision utilisateur,
// liste réduite depuis les 8 cartes initialement envisagées. `code` (dans CARTES_VOLUMETRIE_ACCECIT
// ci-dessous) correspond aux clés de `indicateurs.volumetrieParStatut` (statistiquesService.js) —
// le code CLIQUABLE est `${PREFIXE_VOLUMETRIE}${code}` (voir son rendu plus bas), pas `code` seul.
// `variante` reprend la palette déjà en place sur cet écran (voir Indicateurs.css).
export const PREFIXE_VOLUMETRIE = 'volumetrie:';
// "Formations non validées" ajoutée le 2026-09-14 (demande utilisateur), juste après "Formations
// validées" (positionnement = ordre de ce tableau, voir son rendu plus bas) — même variante
// 'echec-fort' que le badge de statut "Formation non validée" partout ailleurs dans l'app
// (VARIANTE_PAR_CODE_STATUT_ACCECIT tout en haut de ce fichier), pour rester immédiatement
// identifiable comme la même famille d'événement.
// "Prêt à l'embauche" — SEULE carte de cette liste qui NE
// compte PAS des occurrences d'événement sur historique_statuts (contrairement aux 4 autres, voir
// le commentaire de section ci-dessus) : réutilise EXACTEMENT le même critère que le segment "Prêt
// à l'embauche" du camembert "Formation vs prêt à l'embauche" plus bas sur cet écran
// (indicateurs.orientations.pret_embauche, backend statistiquesRepository.compterOrientations,
// ORIENTATION_EFFECTIVE_SQL = COALESCE(evaluations.orientation, CASE WHEN statuts.code =
// 'valide_pret_embauche' THEN 'pret_embauche' END)) — des dossiers DISTINCTS (dernière évaluation
// de la période), pas des événements comptés plusieurs fois.
// Une approche "à la manière des 4 autres cartes" (compter les transitions vers le statut
// 'valide_pret_embauche' dans historique_statuts) ferait doublon avec "Formations validées"
// ci-dessous : ce statut a deux origines — verdict direct Inspecteur/bureau, OU validation de
// formation après "Envoyés en formation" (déjà comptée par "Formations validées", voir
// statistiquesRepository.compterOccurrencesFormationValidee) — qu'une requête générique sur
// historique_statuts ne distinguerait pas, additionnant les deux dans un chiffre incohérent avec
// le camembert.
// `codeIndicateur`/`valeur` : overrides lus par le rendu plus bas (voir leur usage) — code
// CLIQUABLE = 'orientation_pret_embauche' (code EXISTANT, déjà utilisé par le segment du
// camembert), jamais '${PREFIXE_VOLUMETRIE}pret_embauche' : cliquer cette tuile sélectionne donc
// exactement le même indicateur que cliquer le segment du camembert (même exclusivité mutuelle
// avec 'orientation_envoi_formation', voir PAIRES_INDICATEURS_EXCLUSIFS plus bas — comportement
// hérité gratuitement, rien à dupliquer ici). `variante: 'dore'` (pas 'vert-clair', couleur du
// badge "Indicateurs" pour ce même code ailleurs sur cet écran, voir VARIANTE_PAR_INDICATEUR
// ci-dessus) : 'vert-clair' est déjà prise par "Formations validées" DANS CETTE MÊME SECTION —
// 'dore' reste cohérent avec la charte (déjà utilisée pour d'autres indicateurs positifs/
// catégoriels de cet écran, ex. 'conversion' ci-dessus) sans collision visuelle locale.
// "Test Invalidé" — même principe/mêmes raisons que "Prêt
// à l'embauche" ci-dessus (voir son commentaire pour le détail) : réutilise EXACTEMENT le même
// critère que la part "Invalidé" du camembert "Tests validés vs invalidés" plus bas sur cet écran
// (indicateurs.verdicts.invalide, backend statistiquesRepository.compterVerdicts/listerVerdicts —
// dossiers DISTINCTS via filtrerDerniereEvaluation, resultat_global='invalide', date_evaluation
// dans la période), pas une nouvelle requête d'occurrences sur historique_statuts (aucun statut
// dédié 'invalide' n'existe d'ailleurs dans workflow.config.json à compter de cette façon — un test
// invalidé retombe sur un statut terminal 'refuse'/motif, pas une transition à part). Code
// CLIQUABLE = 'verdict_invalide' (code EXISTANT, déjà utilisé par le segment du camembert, même
// exclusivité mutuelle avec 'verdict_valide' — PAIRES_INDICATEURS_EXCLUSIFS plus bas). `variante:
// 'echec'` : couleur du badge "Indicateurs" pour ce même code ailleurs sur cet écran
// (VARIANTE_PAR_INDICATEUR.verdict_invalide), rouge/rose cohérente avec "Invalidé" dans le
// camembert (COULEURS_VERDICT.verdict_invalide) — pas encore utilisée dans cette section (aucune
// collision avec violet/dore/bleu/vert-clair/echec-fort des autres cartes).
export const CARTES_VOLUMETRIE_ACCECIT = [
  { code: 'test_realise', libelle: 'Sessions de test réalisées', variante: 'violet' },
  {
    code: 'verdict_invalide',
    libelle: 'Test Invalidé',
    variante: 'echec',
    codeIndicateur: 'verdict_invalide',
    valeur: (indicateursActuels) => indicateursActuels.verdicts.invalide,
  },
  {
    code: 'pret_embauche',
    libelle: 'Prêt à l’embauche',
    variante: 'dore',
    codeIndicateur: 'orientation_pret_embauche',
    valeur: (indicateursActuels) => indicateursActuels.orientations.pret_embauche,
  },
  { code: 'valide_envoi_formation', libelle: 'Envoyés en formation', variante: 'bleu' },
  { code: 'formation_validee', libelle: 'Formations validées', variante: 'vert-clair' },
  { code: 'formation_non_validee', libelle: 'Formations non validées', variante: 'echec-fort' },
];
// .filter(!codeIndicateur) : exclut "Prêt à l'embauche" ci-dessus de ces deux résolutions
// génériques — elles ne servent qu'au code '${PREFIXE_VOLUMETRIE}<code>' (badge "Indicateurs" pour
// une carte de volumétrie "classique", voir son usage plus bas), jamais atteint pour cette carte
// puisque son code cliquable est 'orientation_pret_embauche' (déjà résolu par LIBELLES_INDICATEURS/
// VARIANTE_PAR_INDICATEUR ci-dessus) — sans ce filtre, 'pret_embauche' polluerait ces deux tables
// sans jamais être consulté, purement pour mémoire.
const LIBELLES_VOLUMETRIE_ACCECIT = Object.fromEntries(
  CARTES_VOLUMETRIE_ACCECIT.filter((carte) => !carte.codeIndicateur).map(({ code, libelle }) => [code, libelle]),
);
function libelleVolumetrie(code) {
  return LIBELLES_VOLUMETRIE_ACCECIT[code] ?? code;
}
function varianteVolumetrie(code) {
  return CARTES_VOLUMETRIE_ACCECIT.find((carte) => !carte.codeIndicateur && carte.code === code)?.variante ?? 'neutre';
}

// Libellés des 4 nouvelles cartes — repris tels quels des libellés officiels de statut
// (workflow.config.json), pas une reformulation propre à la tuile (contrairement à
// LIBELLES_INDICATEURS plus haut, où "conversion"/"envoyes_en_test" ont un libellé délibérément
// distinct de tout statut pour éviter une collision — ici, la tuile EST littéralement "combien de
// dossiers sont à ce statut", aucune ambiguïté à lever).
const LIBELLES_STATUT_EFFECTIF_ACCECIT = {
  test_realise: 'Test réalisé',
  valide_pret_embauche: "Validé - prêt à l'embauche",
  formation_non_validee: 'Formation non validée',
  embauche: 'Embauché',
};
function libelleStatutEffectif(code) {
  return LIBELLES_STATUT_EFFECTIF_ACCECIT[code] ?? code;
}

// Libellé COURT pour la colonne "Indicateurs" du tableau consolidé (TableauDossiersSelectionnes.jsx)
// — audit tableau de bord 2026-08-31 (2e passe), décision utilisateur : le libellé officiel complet
// du statut ("Validé - prêt à l'embauche") fait doublon avec la colonne "Statut" juste à côté (qui
// affiche déjà exactement ce badge) — même patron déjà établi pour LIBELLES_INDICATEURS plus haut
// (4 des 5 cartes existantes ont un libellé DISTINCT et plus court dans cette colonne que sur leur
// tuile, ex. "Retenu" pour "Taux de dossiers validés à ce jour"). Scope volontairement limité à
// valide_pret_embauche (seul cas signalé) : test_realise/formation_non_validee/embauche gardent
// leur libellé de statut complet dans cette colonne pour l'instant, non signalés comme redondants —
// la tuile elle-même et la colonne "Dates clés" gardent aussi le libellé complet (libelleStatutEffectif
// ci-dessus), seule la colonne "Indicateurs" est concernée par ce raccourci.
const LIBELLES_COURTS_INDICATEUR_STATUT_ACCECIT = {
  valide_pret_embauche: "Prêt à l'embauche",
};

// Paires d'indicateurs mutuellement exclusifs — les deux parts
// d'un même camembert cliquable ("Tests validés vs invalidés"/"Formation vs prêt à l'embauche")
// représentent des résultats contraires pour un même événement (un dossier n'a qu'un seul verdict/
// une seule orientation par test) : sélectionner l'une désélectionne automatiquement l'autre, voir
// basculerIndicateur plus bas. Scope volontairement limité à ces deux paires — n'affecte ni les
// tuiles KPI (Inscrits, Envoyé en test, Converti, les deux délais), ni les segments "Répartition
// par poste" (postes cumulables sur une même évaluation, pas des résultats contraires), qui
// restent librement combinables comme avant.
export const PAIRES_INDICATEURS_EXCLUSIFS = [
  ['verdict_valide', 'verdict_invalide'],
  ['orientation_envoi_formation', 'orientation_pret_embauche'],
];

export function libellePoste(code) {
  if (code === null) return 'Non spécifié';
  return LIBELLES_POSTE[code] ?? code;
}

// Libellé de l'option par défaut (value="") du filtre "Poste" — purement affichage, le
// comportement de filtrage reste inchangé (poste vide = aucun filtre poste, scope = l'entité déjà
// sélectionnée via typePoste, voir posteEffectif plus bas). Reflète l'entité choisie dans le
// filtre "Entité" juste au-dessus pour éviter l'ambiguïté "tous les postes" alors qu'un filtre
// Hôtellerie/Tertiaire est déjà actif.
export function libelleOptionTousLesPostes(typePosteFiltre) {
  if (typePosteFiltre === 'hotel') return 'Tous les postes Hôtellerie';
  if (typePosteFiltre === 'bureau') return 'Tous les postes Tertiaire';
  return 'Tous les postes';
}

// Un code 'poste:<code>' se traduit via libellePoste ci-dessus (même libellé que la colonne
// "Poste"/le graphique de répartition) plutôt que d'être dupliqué dans LIBELLES_INDICATEURS.
export function libelleIndicateur(code) {
  if (code.startsWith(PREFIXE_POSTE)) return libellePoste(code.slice(PREFIXE_POSTE.length));
  if (code.startsWith(PREFIXE_STATUT)) {
    const statutCode = code.slice(PREFIXE_STATUT.length);
    // Raccourci dédié à cette colonne quand il existe (voir LIBELLES_COURTS_INDICATEUR_STATUT_ACCECIT
    // ci-dessus), sinon repli sur le libellé de statut complet — jamais utilisé par la tuile
    // elle-même ni par la colonne "Dates clés" (libelleDateCle plus bas), qui appellent directement
    // libelleStatutEffectif.
    return LIBELLES_COURTS_INDICATEUR_STATUT_ACCECIT[statutCode] ?? libelleStatutEffectif(statutCode);
  }
  // 'volumetrie:<code>' (audit dashboard 2026-09-02, 2e passe) : même libellé que la tuile (voir
  // libelleVolumetrie/CARTES_VOLUMETRIE_ACCECIT plus haut), pour le badge "Indicateurs" ET pour
  // l'aria-label de la ligne "Dates clés" multi-occurrences (TableauDossiersSelectionnes.jsx, ligne
  // de type 'volumetrie-valeur') — pas de raccourci court dédié (contrairement à 'statut:<code>'
  // ci-dessus) : ces 3 libellés sont déjà courts.
  if (code.startsWith(PREFIXE_VOLUMETRIE)) return libelleVolumetrie(code.slice(PREFIXE_VOLUMETRIE.length));
  return LIBELLES_INDICATEURS[code] ?? code;
}
export function varianteIndicateur(code) {
  if (code.startsWith(PREFIXE_POSTE)) return 'dore';
  // 'statut:<code>' délègue à varianteStatut (même mapping que le badge de statut affiché ailleurs
  // sur l'écran, VARIANTE_PAR_CODE_STATUT_ACCECIT tout en haut du fichier) plutôt qu'une nouvelle
  // entrée dupliquée dans VARIANTE_PAR_INDICATEUR — la tuile "Embauché" doit porter EXACTEMENT la
  // même couleur que le badge de statut "Embauché" ailleurs dans l'app.
  if (code.startsWith(PREFIXE_STATUT)) return varianteStatut(code.slice(PREFIXE_STATUT.length));
  // 'volumetrie:<code>' délègue à varianteVolumetrie (même palette que la tuile, voir
  // CARTES_VOLUMETRIE_ACCECIT plus haut) — le badge "Indicateurs" garde la même couleur que sa
  // carte d'origine, comme 'statut:<code>' ci-dessus le fait déjà avec varianteStatut.
  if (code.startsWith(PREFIXE_VOLUMETRIE)) return varianteVolumetrie(code.slice(PREFIXE_VOLUMETRIE.length));
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
export function estIndicateurPoste(code) {
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
export function libelleDateCle(code) {
  // 'statut:<code>' (colonne "Dates clés" des 4 nouvelles cartes, date d'ENTRÉE dans ce statut —
  // voir dossierRepository.joindreDateEntreeStatut côté back) : même libellé que la tuile
  // elle-même, pas une entrée dupliquée dans LIBELLES_DATES_CLES.
  if (code.startsWith(PREFIXE_STATUT)) return libelleStatutEffectif(code.slice(PREFIXE_STATUT.length));
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
export function varianteDateCle(code) {
  // Délègue à varianteIndicateur (pas VARIANTE_PAR_INDICATEUR seul) : varianteIndicateur gère déjà
  // 'poste:<code>'/'statut:<code>' en plus des codes statiques, avec son propre repli 'neutre' —
  // évite de dupliquer cette même logique de préfixe ici pour 'statut:<code>'.
  return VARIANTE_PAR_DATE_CLE[code] ?? varianteIndicateur(code);
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
export const COULEURS_VERDICT = { verdict_valide: '#0ca30c', verdict_invalide: '#d03b3b' };

// "Formation vs prêt à l'embauche" : deux issues positives, pas un statut bon/mauvais — palette
// catégorielle (identité), pas la palette de statut. Violet + vert, cohérent avec les variantes de
// badge déjà choisies pour ces mêmes indicateurs (voir VARIANTE_PAR_INDICATEUR : 'violet'/
// 'vert-clair') sans reprendre le vert de "Réussis" ci-dessus (nuance différente : #008300 vs
// #0ca30c) pour ne pas laisser croire aux deux graphiques qu'ils mesurent la même chose.
export const COULEURS_ORIENTATION = { orientation_envoi_formation: '#4a3aa7', orientation_pret_embauche: '#008300' };

// Répartition par poste : une couleur par CODE de poste (stable même si un filtre réduit le
// nombre de barres affichées), 8 teintes validées ensemble (voir script) + une 9e (cyan) ajoutée
// et revalidée pour couvrir les 9 postes ACCECIT (5 bureau + 4 hôtel) sans repli sur "Autre" —
// point à revisiter si l'entité en configure davantage un jour. "Non spécifié" (aucun poste
// renseigné sur l'évaluation) volontairement HORS de cette palette catégorielle : un gris neutre
// signale "pas de donnée", jamais confondu avec un vrai poste.
export const COULEURS_POSTE = {
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
export const COULEUR_POSTE_NON_SPECIFIE = '#9ca3af';

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
export const STYLE_TOOLTIP_GRAPHIQUE = {
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
export const STYLE_TOOLTIP_ITEM_GRAPHIQUE = { color: 'var(--couleur-texte)', fontSize: '1rem' };

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
export const STYLE_TOOLTIP_ITEM_CAMEMBERT = { color: 'var(--couleur-back-office)', fontSize: '1rem' };

// Corrige le tooltip des camemberts qui remplaçait, au survol, le texte "4 (80%)" affiché en
// permanence dans la part (labelPartCamembert) par un simple "Réussis : 4" — le pourcentage
// disparaissait. recharts ne l'expose pourtant pas via le payload du tooltip par défaut : Pie.js
// calcule bien un `percent` par part (utilisé par labelPartCamembert), mais seulement sur l'objet
// secteur interne — le `tooltipPayload` transmis au Tooltip ne porte que { name, value, payload:
// <donnée brute> }, sans percent (voir recharts/lib/polar/Pie.js, tooltipPayload vs `prev`). D'où
// ce formatter dédié, qui recalcule le total sur le même tableau que le camembert (mêmes valeurs,
// donc même pourcentage arrondi que labelPartCamembert) plutôt que de dépendre d'un champ absent.
export function creerFormatteurTooltipCamembert(donnees) {
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
export function useSuiviCurseurCamembert() {
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
export function labelPartCamembert({ cx, cy, midAngle, innerRadius, outerRadius, percent, value }) {
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
export function bornesParDefaut() {
  const maintenant = new Date();
  const annee = maintenant.getFullYear();
  const moisIndex = maintenant.getMonth();
  const dernierJourDuMois = new Date(annee, moisIndex + 1, 0).getDate();
  return {
    dateDebut: formatDateLocaleISO(annee, moisIndex, 1),
    dateFin: formatDateLocaleISO(annee, moisIndex, dernierJourDuMois),
  };
}
