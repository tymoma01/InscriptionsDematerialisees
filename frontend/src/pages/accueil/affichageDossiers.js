// Affichage de la liste « Dossiers candidats » (TableauDeBordAccueil.jsx) : couleurs de statut,
// infobulles, disponibilités et regroupements de filtres — fonctions pures, testées dans
// affichageDossiers.test.js.

// Actions groupées (audit 2026-08-24, "Dossiers candidats", seuil abaissé à 1 le 2026-08-25) : la
// barre apparaît dès qu'un seul candidat est sélectionné — une action groupée reste utile même
// pour un seul dossier (ex. export des pièces sans repasser par la fiche dossier).
export const SEUIL_SELECTION_ACTIONS_GROUPEES = 1;

// Mapping purement visuel, propre à cette page (pas au moteur générique DossierList/StatutBadge,
// voir Modularité CLAUDE.md), en attendant que `statuts` porte une polarité succès/échec/attente
// en base : un code absent de ce mapping (autre entité, nouveau statut) retombe simplement sur un
// badge neutre plutôt que d'échouer.
// Une variante distincte par statut (voir styles/variables.css, --statut-*) plutôt que les 4
// polarités génériques seules — même mapping que Backoffice.jsx (dupliqué plutôt que partagé :
// quelques lignes de données, pas de quoi justifier un module commun, voir CLAUDE.md conventions
// du projet).
const VARIANTE_PAR_CODE_ACCECIT = {
  // 'nouveau' réintroduit (workflow v5, audit 2026-08-21) : redevenu réellement observable
  // ("Inscrit" persistant tant qu'aucune pièce n'a été capturée, voir dossierService.
  // inscrireCandidat/pieceJustificativeService.js) — était retiré depuis le 2026-08-19 tant que ce
  // statut n'était qu'un artefact transitoire (voir scripts/basculerDossiersNouveauEnAttentePieces.js
  // pour l'historique de ce retrait). 'neutre' plutôt que 'attente' : rien n'est encore en cours,
  // contrairement à en_attente_pieces (une collecte a débuté).
  nouveau: 'neutre',
  en_attente_pieces: 'attente',
  en_attente_verification: 'attente', // workflow hérité, plus jamais atteint
  // 'test_non_planifie' (workflow v5) : 'rose' (audit 2026-08-25, second correctif) — partageait
  // à l'origine 'attente' avec en_attente_pieces (même badge ambre pour deux étapes distinctes du
  // workflow), puis 'neutre-fort' (gris) dans un premier correctif, jugé encore insuffisamment
  // distinctif à côté des 8 autres teintes toutes chromatiques (attente=ambre, bleu, violet,
  // vert-clair, alerte=orange, echec=rouge, succes=vert, neutre=gris clair pour "Inscrit") — un
  // gris reste perçu comme "pas de couleur" plutôt que comme une couleur à part entière. 'rose'
  // (voir --statut-rose-* dans variables.css) ne recoupe aucune famille déjà utilisée (ni le
  // rouge d'echec, ni le violet de test_realise, ni l'ambre d'attente/l'orange d'alerte) — 'dore'/
  // 'echec-fort' restaient eux trop proches de ces deux dernières familles pour ce même besoin.
  test_non_planifie: 'rose',
  test_planifie: 'bleu',
  // 'test_realise' (workflow v5) : violet, inutilisé ailleurs dans ce mapping — le test a eu lieu
  // mais aucun verdict n'est encore rendu, état à surveiller pour relancer un formateur qui tarde
  // à évaluer (CLAUDE.md, besoin Accueil/Coordination : "historique des relances").
  test_realise: 'violet',
  test_non_realise: 'alerte',
  invalide: 'echec',
  valide_envoi_formation: 'succes',
  valide_pret_embauche: 'vert-clair',
  // Suivi de formation : 'echec-fort', distinct de 'echec' ("Invalidé") — voir
  // VerificationPieces.jsx pour le détail du choix de couleur.
  formation_non_validee: 'echec-fort',
  // Statut terminal "Embauché" : 'vert-fonce', voir variables.css pour le
  // détail (troisième teinte verte de ce funnel, distincte de 'succes'/'vert-clair' ci-dessus).
  embauche: 'vert-fonce',
};
export function varianteStatut(code) {
  return VARIANTE_PAR_CODE_ACCECIT[code] ?? 'neutre';
}

// Infobulle "Test planifié" (audit 2026-09-14, demande utilisateur, colonne "Statut") — même
// format date/heure que Planification.jsx (Suivi des tests, FORMAT_DATE_HEURE), dupliqué plutôt
// que partagé (voir CLAUDE.md conventions du projet) : cohérence visuelle avec l'écran qui affiche
// déjà ce même rendez-vous en toutes lettres.
const FORMAT_DATE_HEURE_INFOBULLE = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

// Passée à DossierList (prop `infoBulleStatut`, voir son commentaire d'en-tête) — ACCECIT-specific
// (le composant générique ne sait pas ce qui justifie une infobulle), scopée au SEUL statut
// 'test_planifie' : les autres statuts n'ont pas d'information de rendez-vous à montrer ici (le
// dossier n'a alors soit aucun rendez-vous de test actif, soit un rendez-vous déjà consommé —
// honoré/absent/annulé/remplacé —, hors périmètre de cette demande). `dossier.rendezvousTestActif`
// (voir dossierService.listerDossiers) : déjà chargé avec la liste des dossiers, aucune requête
// supplémentaire nécessaire — LEFT JOIN LATERAL côté back sur le rendez-vous de test 'prevu'/
// 'confirme' le plus récent du dossier. Retourne un TABLEAU de lignes (une par information, voir
// DossierList.jsx) ou undefined (aucune infobulle) plutôt qu'une chaîne unique, même contrat que
// le composant générique attend.
export function infoBulleStatut(dossier) {
  if (dossier.statut_code !== 'test_planifie' || !dossier.rendezvousTestActif) return undefined;
  const { dateHeure, formateurPrenom, formateurNom } = dossier.rendezvousTestActif;
  const formateur = formateurPrenom || formateurNom ? `${formateurPrenom ?? ''} ${formateurNom ?? ''}`.trim() : null;
  // "Pour : " — précède la date/heure pour lever
  // l'ambiguïté avec une autre date qu'un agent pourrait s'attendre à voir ici (ex. date de
  // dernière mise à jour) : "Pour : 12/09/2026 08:00" se lit sans équivoque comme "ce test est
  // prévu pour cette date-là".
  const lignes = [`Pour : ${FORMAT_DATE_HEURE_INFOBULLE.format(new Date(dateHeure))}`];
  lignes.push(formateur ? `Formateur : ${formateur}` : 'Formateur : non assigné');
  return lignes;
}

// 'AAAA-MM-JJ' -> 'JJ/MM' (audit 2026-09-28, bouton "Dispo : ..." sous le badge "Validé - prêt à
// l'embauche") — simple découpage de chaîne, JAMAIS `new Date(...)` : ces dates sont déjà des
// chaînes 'AAAA-MM-JJ' pures (voir dossierService.js/disponibiliteEmbaucheService.js côté back),
// un passage par Date() risquerait un décalage d'un jour selon le fuseau du navigateur pour une
// date sans heure (même précaution que versDateInput, InformationsInscription.jsx).
function formaterDateCourte(valeurIso) {
  const [, mois, jour] = valeurIso.split('-');
  return `${jour}/${mois}`;
}

// Rôles autorisés à CORRIGER la disponibilité (audit 2026-09-28, demande utilisateur explicite
// point 5) — même liste que modificationInscription côté back
// (backend/src/api/routes/dossiers.routes.js, route POST /:dossierId/disponibilite-embauche),
// dupliquée plutôt que partagée (CLAUDE.md, conventions du projet) : les deux doivent rester en
// phase manuellement si cette liste change. Les autres rôles (Formateur/Inspecteur) voient le
// même bouton "Dispo : ..." en LECTURE SEULE (voir sousBadgeStatutDisponibilite plus bas) — la
// vraie barrière reste côté serveur (403, déjà vérifié par les tests backend), masquer le clic ici
// n'est qu'un confort d'affichage.

// Formats EXACTS demandés : "Dispo : immédiate"
// (déclaration d'origine immédiate, jamais corrigée, sans date de fin) / "Dispo : immédiate →
// JJ/MM" (idem, avec une date de fin) / "Dispo : à partir du JJ/MM" (date de début connue, sans
// fin) / "Dispo : JJ/MM → JJ/MM" (date de début ET de fin connues — extension logique du format
// précédent, non explicitement donnée mais cohérente avec elle). `dateDebut: null` signifie
// "immédiate" (voir dossierService.calculerDisponibiliteEffective) — ne peut survenir QUE sans
// correction, une correction ayant toujours une date de début concrète.
// "Dispo : non renseignée" (ajustement 2026-09-28, demande utilisateur explicite point 3) :
// `nonRenseignee: true` UNIQUEMENT quand le candidat n'a STRICTEMENT rien déclaré ET qu'aucune
// correction n'existe (voir dossierService.calculerDisponibiliteEffective) — distinct
// d'"immédiate" (déclaration explicite, disponibiliteImmediate: true), vérifié avant toute autre
// chose ci-dessous.
export function formaterDisponibiliteEffective({ dateDebut, dateFin, nonRenseignee }) {
  if (nonRenseignee) return 'Dispo : non renseignée';
  if (dateDebut === null) {
    return dateFin ? `Dispo : immédiate → ${formaterDateCourte(dateFin)}` : 'Dispo : immédiate';
  }
  return dateFin
    ? `Dispo : ${formaterDateCourte(dateDebut)} → ${formaterDateCourte(dateFin)}`
    : `Dispo : à partir du ${formaterDateCourte(dateDebut)}`;
}

// Expérience (libellés, codes, couleurs, pastille) : module partagé core/dossier/BadgeExperience.jsx
//, commun à Dossiers candidats et Suivi des tests.

// Tous les statuts réellement atteignables aujourd'hui dans le workflow actif — propre à cette
// page, pas au moteur générique FiltresStatut.jsx qui reste piloté entièrement par la prop
// `statuts` qu'on lui passe. "En attente de vérification" (workflow hérité) n'y figure
// volontairement pas : plus aucun dossier ne peut l'atteindre.
export const CODES_STATUTS_FILTRES_ACCUEIL = [
  // "Inscrit" (audit 2026-08-21, complète l'ajout initial de Test non planifié/Test réalisé
  // ci-dessous) : redevenu réellement observable depuis le retrait de la bascule automatique
  // nouveau -> en_attente_pieces (workflow v5, point 1) — jusqu'ici visible seulement via "Tous",
  // sans bouton de filtre dédié pour l'isoler des dossiers déjà entrés en collecte de pièces.
  'nouveau',
  'en_attente_pieces',
  // "Test non planifié" (workflow v5) : pièces obligatoires complètes, test pas encore planifié —
  // même ordre que le workflow (voir workflow.config.json, ordre 25 entre en_attente_pieces=20 et
  // test_planifie=30) ; l'ORDRE de ce tableau lui-même n'a aucune incidence sur l'affichage
  // (statutsFiltres filtre `statuts`, déjà trié par `ordre` côté back, voir plus bas), seul
  // l'ensemble des codes retenus compte ici.
  'test_non_planifie',
  'test_planifie',
  // "Test réalisé" (workflow v5) : test confirmé tenu, évaluation pas encore soumise — utile pour
  // repérer un formateur/inspecteur qui tarde à évaluer (demande explicite, "relancer un formateur
  // qui tarde").
  'test_realise',
  // Permet à l'accueil d'isoler d'un coup les dossiers en attente de replanification après un
  // test invalidé, sans devoir les repérer dans la liste complète (voir Validation.jsx,
  // STATUTS_REPLANIFIABLES, pour l'action "Replanifier" elle-même). "invalide" remplace
  // "verdict_negatif" (workflow v3, verdict_negatif retiré du parcours actif).
  'test_non_realise',
  'invalide',
  // Ajoutés pour couvrir les deux verdicts positifs (voir 9778d03) : sans ces deux entrées, les
  // dossiers validés (embauche directe ou envoi en formation) restaient visibles dans la liste
  // mais impossibles à isoler par filtre sur cette page, contrairement au back-office recruteur.
  'valide_envoi_formation',
  'valide_pret_embauche',
  // Suivi de formation : oublié lors de l'ajout initial du statut lui-même
  // (VARIANTE_PAR_CODE_ACCECIT le portait déjà, pas cette liste) — un dossier "Formation non
  // validée" restait visible dans le tableau/"Tous" mais impossible à isoler par filtre dédié.
  'formation_non_validee',
  // Statut terminal "Embauché" : même raison que les deux verdicts positifs
  // ci-dessus — sans cette entrée, les dossiers embauchés restent visibles via "Tous" mais
  // impossibles à isoler par filtre dédié.
  'embauche',
];

// Codes agrégés sous le bouton "Test réalisé" : à la
// différence de tous les autres boutons ci-dessus (correspondance stricte à un seul statut), ce
// filtre doit couvrir tout dossier dont le test a RÉELLEMENT EU LIEU, quel que soit le verdict
// déjà rendu ou non — test_realise (verdict pas encore soumis) ET les trois issues qui ne sont
// atteignables QU'après confirmer_test_realise (voir workflow.config.json, workflow v5 :
// valider_envoi_formation/valider_pret_embauche/invalider_test partent tous les trois de
// test_realise, plus jamais de test_planifie). Exclut sciemment test_non_realise (le test n'a
// précisément PAS eu lieu) et tout statut antérieur. Les boutons Invalidé/Validé - envoyé en
// formation/Validé - prêt à l'embauche restent, eux, des filtres stricts à un seul statut chacun
// (un agent qui clique "Invalidé" veut voir UNIQUEMENT les dossiers invalidés, pas les mélanger
// avec les deux autres issues) — seul "Test réalisé" a besoin de cette agrégation, propre à ce
// bouton. Codes des dossiers eux-mêmes jamais réécrits ni uniformisés par cette agrégation :
// chaque ligne du tableau garde son statut/badge réel (DossierList.jsx reste piloté par
// dossier.statut_code, pas par ce filtre), seule la logique de filtrage/comptage est concernée.
// formation_non_validee ajouté : par la règle même de ce commentaire ("tout
// dossier dont le test a réellement eu lieu, quel que soit le verdict") — un dossier n'atteint ce
// statut qu'après avoir déjà été confirmé test_realise puis valide_envoi_formation (voir
// workflow.config.json), son test a donc, lui aussi, réellement eu lieu. Omis lors de l'ajout
// initial du statut, corrigé ici pour rester cohérent avec les 4 codes déjà présents.
export const CODES_STATUTS_TEST_REALISE_ACCECIT = [
  'test_realise',
  'invalide',
  'valide_envoi_formation',
  'valide_pret_embauche',
  'formation_non_validee',
  // 'embauche' ajouté (audit 2026-08-31, même raison que 'formation_non_validee' ci-dessus) : un
  // dossier embauché est passé par valide_pret_embauche, donc par un test réellement tenu.
  'embauche',
];

// Code SYNTHÉTIQUE (audit 2026-09-14, demande utilisateur, besoin Accueil "vue centralisée des
// dossiers en attente", CLAUDE.md) — n'existe dans AUCUN workflow.config.json (vérifié : aucun
// statut réel ne porte ce code), contrairement à 'test_realise' juste au-dessus qui, lui, désigne
// aussi un statut RÉEL de dossier. "À planifier" n'a donc pas sa place dans
// CODES_STATUTS_FILTRES_ACCUEIL (réservé aux codes présents dans `statuts`, la liste renvoyée par
// GET /statuts) : c'est un simple raccourci de filtrage regroupant trois statuts déjà filtrables
// individuellement (voir statutsFiltres plus bas, où l'entrée correspondante est ajoutée à la main
// plutôt que via ce tableau), jamais écrit sur un dossier ni renvoyé par le back.
export const CODE_A_PLANIFIER = 'a_planifier';
// Statuts regroupés (demande explicite) : les trois étapes AVANT tout test planifié — un candidat
// encore à faire avancer par l'accueil, avant que la responsabilité ne bascule côté formateur
// (test_planifie et suivants). Ordre sans incidence (même principe que CODES_STATUTS_FILTRES_ACCUEIL
// ci-dessus, seul l'ensemble des codes compte).
export const CODES_STATUTS_A_PLANIFIER_ACCECIT = ['nouveau', 'en_attente_pieces', 'test_non_planifie'];

export function codesPourFiltreStatut(code) {
  if (code === 'test_realise') return CODES_STATUTS_TEST_REALISE_ACCECIT;
  if (code === CODE_A_PLANIFIER) return CODES_STATUTS_A_PLANIFIER_ACCECIT;
  return [code];
}
