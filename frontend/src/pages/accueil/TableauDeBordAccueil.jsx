import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DossierList from '../../core/dossier/DossierList';
import FiltresStatut from '../../core/dossier/FiltresStatut';
import FiltresRechercheDossiers from '../../core/dossier/FiltresRechercheDossiers';
import { filtrerDossiers } from '../../core/dossier/filtrerDossiers';
import { useParametreURL, useEnsembleURL } from '../../core/filtres/useParametreURL';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import { useSession } from '../../core/auth/useSession';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import { listerDossiers, listerStatuts } from '../../services/dossierService';
import { useRafraichissementAuto } from '../../core/dossier/useRafraichissementAuto';
import ModaleRelanceGroupee from '../../core/dossier/ModaleRelanceGroupee';
import ModaleReplanificationGroupee from '../../core/dossier/ModaleReplanificationGroupee';
import { listerPiecesJustificatives } from '../../services/pieceJustificativeService';
import api from '../../services/api';
import './TableauDeBordAccueil.css';

// Actions groupées (audit 2026-08-24, "Dossiers candidats", seuil abaissé à 1 le 2026-08-25) : la
// barre apparaît dès qu'un seul candidat est sélectionné — une action groupée reste utile même
// pour un seul dossier (ex. export des pièces sans repasser par la fiche dossier).
const SEUIL_SELECTION_ACTIONS_GROUPEES = 1;

// Mêmes statuts que STATUTS_REPLANIFIABLES (pages/recruteur/Validation.jsx, pages/coordination/
// Tests.jsx) — dupliqué ici plutôt que partagé (voir CLAUDE.md, conventions du projet) : sert à
// exclure de la replanification groupée les dossiers qui n'ont encore jamais eu de test planifié
// (nouveau/en_attente_pieces/test_non_planifie) ET ceux dont le test a eu lieu mais n'a pas encore
// de verdict (test_realise, pas de transition replanifier_test depuis ce statut dans
// workflow.config.json — il faut d'abord un verdict avant de pouvoir reprogrammer).
const STATUTS_REPLANIFIABLES_ACCECIT = [
  'test_planifie',
  'test_non_realise',
  'invalide',
  'valide_envoi_formation',
  'valide_pret_embauche',
];

// Mapping purement visuel, propre à cette page (pas au moteur générique DossierList/StatutBadge,
// voir Modularité CLAUDE.md) — donnée de test locale au même titre que
// formulaireConfig.accecit.js le temps que `statuts` porte une polarité succès/échec/attente en
// base : un code absent de ce mapping (autre entité, nouveau statut) retombe simplement sur un
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
  // Suivi de formation (audit 2026-08-28) : 'echec-fort', distinct de 'echec' ("Invalidé") — voir
  // VerificationPieces.jsx pour le détail du choix de couleur.
  formation_non_validee: 'echec-fort',
  // Statut terminal "Embauché" (audit 2026-08-31) : 'vert-fonce', voir variables.css pour le
  // détail (troisième teinte verte de ce funnel, distincte de 'succes'/'vert-clair' ci-dessus).
  embauche: 'vert-fonce',
};
function varianteStatut(code) {
  return VARIANTE_PAR_CODE_ACCECIT[code] ?? 'neutre';
}

// Libellés des postes (colonne "Poste" de DossierList.jsx) — mêmes codes/libellés que
// BlocDisponibilites.jsx (POSTES_BUREAU/POSTES_HOTEL), dupliqué plutôt que partagé (même
// convention que VARIANTE_PAR_CODE_ACCECIT ci-dessus, voir CLAUDE.md conventions du projet) : un
// code absent (poste ajouté au formulaire mais pas encore ici) retombe simplement sur le code
// brut plutôt que d'échouer.
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

// Libellés/options du filtre "Expérience" (colonne DossierList.jsx, audit 2026-09-02) — mêmes
// codes que BlocDisponibilites.jsx (formulaire d'inscription), dupliqués plutôt que partagés
// (même convention que LIBELLES_POSTE_PAR_CODE_ACCECIT ci-dessus, voir CLAUDE.md conventions du
// projet).
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

// Variante StatutBadge par code d'expérience (audit 2026-09-02, badge coloré colonne
// "Expérience") — même principe que varianteStatut ci-dessous : DossierList.jsx reste générique,
// c'est cette page (qui connaît le vocabulaire ACCECIT) qui fournit la traduction code -> variante.
// Noms de variante alignés sur les codes eux-mêmes (StatutBadge.css, `--experience-*`), pas de
// mapping arbitraire à retenir séparément.
const VARIANTE_EXPERIENCE_PAR_CODE_ACCECIT = {
  aucune: 'experience-aucune',
  plus_6_mois: 'experience-6mois',
  plus_2_ans: 'experience-2ans',
  plus_5_ans: 'experience-5ans',
};
function varianteExperience(code) {
  return VARIANTE_EXPERIENCE_PAR_CODE_ACCECIT[code] ?? 'neutre';
}

// Tous les statuts réellement atteignables aujourd'hui dans le workflow actif — propre à cette
// page, pas au moteur générique FiltresStatut.jsx qui reste piloté entièrement par la prop
// `statuts` qu'on lui passe. "En attente de vérification" (workflow hérité) n'y figure
// volontairement pas : plus aucun dossier ne peut l'atteindre.
const CODES_STATUTS_FILTRES_ACCUEIL = [
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
  // Suivi de formation (audit 2026-08-28) : oublié lors de l'ajout initial du statut lui-même
  // (VARIANTE_PAR_CODE_ACCECIT le portait déjà, pas cette liste) — un dossier "Formation non
  // validée" restait visible dans le tableau/"Tous" mais impossible à isoler par filtre dédié.
  'formation_non_validee',
  // Statut terminal "Embauché" (audit 2026-08-31) : même raison que les deux verdicts positifs
  // ci-dessus — sans cette entrée, les dossiers embauchés restent visibles via "Tous" mais
  // impossibles à isoler par filtre dédié.
  'embauche',
];

// Codes agrégés sous le bouton "Test réalisé" (demande explicite, audit 2026-08-21) : à la
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
// formation_non_validee ajouté (audit 2026-08-28) : par la règle même de ce commentaire ("tout
// dossier dont le test a réellement eu lieu, quel que soit le verdict") — un dossier n'atteint ce
// statut qu'après avoir déjà été confirmé test_realise puis valide_envoi_formation (voir
// workflow.config.json), son test a donc, lui aussi, réellement eu lieu. Omis lors de l'ajout
// initial du statut, corrigé ici pour rester cohérent avec les 4 codes déjà présents.
const CODES_STATUTS_TEST_REALISE_ACCECIT = [
  'test_realise',
  'invalide',
  'valide_envoi_formation',
  'valide_pret_embauche',
  'formation_non_validee',
  // 'embauche' ajouté (audit 2026-08-31, même raison que 'formation_non_validee' ci-dessus) : un
  // dossier embauché est passé par valide_pret_embauche, donc par un test réellement tenu.
  'embauche',
];
function codesPourFiltreStatut(code) {
  return code === 'test_realise' ? CODES_STATUTS_TEST_REALISE_ACCECIT : [code];
}

// Tableau de bord Accueil (CLAUDE.md, besoins Accueil/Coordination : "vue centralisée des
// dossiers en attente") — liste les dossiers de l'entité courante, filtrables par statut. Une
// seule action par ligne, "Étudier le dossier" (Validation.jsx : pièces + export ZIP +
// transitions + notes + informations d'inscription complètes, tous statuts) — fusion de l'ancien
// Back-office recruteur (/recruteur/dossiers, supprimé) dans cette page, seule différence relevée
// à l'audit entre les deux tableaux (mêmes colonnes, mêmes filtres, même route API
// GET /api/dossiers, mêmes rôles ROLES_CONSULTATION_DOSSIERS côté back).
// Les actions "Pièces"/"Relances"/"Replanifier", auparavant directement sur cette ligne,
// vivent désormais sur la fiche dossier elle-même (audit 2026-08-19, colonne Actions surchargée
// sur tablette — jusqu'à 4 boutons par ligne) : voir Validation.jsx, qui reste le seul et même
// écran de destination, pour ne pas éclater la fiche dossier en plusieurs pages divergentes selon
// l'entrée utilisée.
export default function TableauDeBordAccueil() {
  const { utilisateur, chargement: chargementSession } = useSession();
  const navigate = useNavigate();

  const [statuts, setStatuts] = useState([]);
  // Filtres persistés dans l'URL (query params) plutôt qu'en state React local (CLAUDE.md, retour
  // arrière navigateur depuis une fiche dossier : le filtre actif ne doit pas se perdre) — voir
  // useParametreURL.js. null = tous les statuts (comportement par défaut inchangé).
  const [statutFiltre, setStatutFiltre] = useParametreURL('statut', null);
  const [dossiers, setDossiers] = useState([]);
  const [chargementDossiers, setChargementDossiers] = useState(true);
  const [erreur, setErreur] = useState(null);

  // Recherche nom/prénom + plage de date, combinées au statutFiltre ci-dessus — filtrage
  // entièrement client (voir filtrerDossiers.js), la liste `dossiers` étant déjà intégralement en
  // mémoire.
  const [recherche, setRecherche] = useParametreURL('q', '');
  const [dateDebutFiltre, setDateDebutFiltre] = useParametreURL('date_debut', '');
  const [dateFinFiltre, setDateFinFiltre] = useParametreURL('date_fin', '');

  // Filtre "Entité" (Hôtellerie/Tertiaire) — même patron que Backoffice.jsx (recruteur) : deux
  // boutons indépendamment activables, jamais d'option "Toutes" dédiée (ferait doublon avec le
  // bouton "Tous" déjà porté par FiltresStatut ci-dessous), Set vide = aucune restriction.
  // Filtrage entièrement client (dossier.postesHotel/postesBureau déjà présents sur chaque
  // dossier renvoyé par GET /api/dossiers, voir filtrerDossiers.js), même mécanisme que
  // recherche/dateDebutFiltre/dateFinFiltre ci-dessus.
  const [entitesFiltre, basculerEntiteFiltre] = useEnsembleURL('entites');

  // Filtre "Expérience" (audit 2026-09-02) — même mécanisme que le sélecteur "Poste" du tableau
  // de bord Indicateurs (Indicateurs.jsx) : un <select> simple, persistant dans l'URL comme les
  // autres filtres de cette page, filtrage entièrement client (dossier.experience déjà présent
  // sur chaque dossier renvoyé par GET /api/dossiers, voir dossierService.listerDossiers).
  // '' = toutes les tranches d'expérience confondues, jamais une valeur de code réelle.
  const [experienceFiltre, setExperienceFiltre] = useParametreURL('experience', '');

  useEffect(() => {
    listerStatuts()
      .then(setStatuts)
      .catch(() => {
        // Filtres non critiques : la liste des dossiers ci-dessous reste consultable même si
        // ce second appel échoue, donc pas de message d'erreur bloquant pour si peu.
      });
  }, []);

  // Un seul chargement, tous statuts confondus (statutFiltre n'est plus un paramètre de requête,
  // voir son commentaire de déclaration) : le filtrage par statut se fait désormais entièrement
  // client, comme recherche/dateDebutFiltre/dateFinFiltre/entitesFiltre ci-dessous — nécessaire
  // pour calculer le compteur de CHAQUE bouton de statut (dossiersFiltresSansStatut ci-dessous) à
  // partir de la même liste en mémoire, plutôt que de ne connaître que le statut actuellement
  // sélectionné.
  useEffect(() => {
    let annule = false;
    setChargementDossiers(true);
    setErreur(null);
    listerDossiers()
      .then((valeur) => {
        if (!annule) setDossiers(valeur);
      })
      .catch((erreur) => {
        if (!annule) setErreur(erreur.response?.data?.erreur ?? 'Impossible de récupérer les dossiers.');
      })
      .finally(() => {
        if (!annule) setChargementDossiers(false);
      });
    return () => {
      annule = true;
    };
  }, []);

  // Rafraîchissement automatique (audit 2026-08-24) : silencieux (ne touche jamais
  // chargementDossiers/erreur ci-dessus, réservés au chargement initial) — un échec ponctuel de
  // ce re-fetch en arrière-plan n'a pas à afficher d'erreur, le prochain tick réessaiera.
  useRafraichissementAuto(() => {
    listerDossiers()
      .then(setDossiers)
      .catch(() => {});
  });

  // Recherche/dates uniquement (pas encore l'entité ni le statut) : base commune aux compteurs
  // "Hôtellerie"/"Tertiaire" ci-dessous, qui doivent chacun ignorer l'état courant du filtre
  // entité (Set) pour répondre à la question "combien de dossiers dans CETTE entité si je clique
  // ce bouton", indépendamment de l'autre bouton entité déjà actif ou non.
  const dossiersRechercheDate = useMemo(
    () => filtrerDossiers(dossiers, { recherche, dateDebutFiltre, dateFinFiltre, libellePoste, entitesFiltre: new Set() }),
    [dossiers, recherche, dateDebutFiltre, dateFinFiltre],
  );

  // Recherche/dates/entité (ni statut ni expérience) : base commune aux DEUX familles de
  // compteurs ci-dessous (statut et expérience, chacune devant ignorer SON PROPRE filtre pour
  // répondre à "combien de dossiers si je clique CE bouton", tout en tenant compte de l'AUTRE
  // filtre déjà actif) — même principe que dossiersRechercheDate ci-dessus pour Hôtellerie/
  // Tertiaire, généralisé aux deux filtres à badges de cette page.
  const dossiersFiltresBase = useMemo(
    () => filtrerDossiers(dossiers, { recherche, dateDebutFiltre, dateFinFiltre, libellePoste, entitesFiltre }),
    [dossiers, recherche, dateDebutFiltre, dateFinFiltre, entitesFiltre],
  );

  // Recherche/dates/entité/expérience (pas encore le statut) : c'est cette liste, group par
  // statut_code, qui donne le compteur de CHAQUE bouton de statut (y compris "Tous") — le nombre
  // de résultats qu'on obtiendrait en cliquant ce bouton compte tenu des autres filtres actifs.
  const dossiersFiltresSansStatut = useMemo(
    () => dossiersFiltresBase.filter((dossier) => !experienceFiltre || dossier.experience === experienceFiltre),
    [dossiersFiltresBase, experienceFiltre],
  );

  // Recherche/dates/entité/statut (pas encore l'expérience) : symétrique de
  // dossiersFiltresSansStatut ci-dessus, pour les compteurs des badges "Expérience" (audit
  // 2026-09-02) — chaque badge doit lui aussi refléter le statut déjà sélectionné.
  const dossiersFiltresSansExperience = useMemo(() => {
    if (!statutFiltre) return dossiersFiltresBase;
    const codes = codesPourFiltreStatut(statutFiltre);
    return dossiersFiltresBase.filter((dossier) => codes.includes(dossier.statut_code));
  }, [dossiersFiltresBase, statutFiltre]);

  const compteursParExperience = useMemo(() => {
    const compte = {};
    dossiersFiltresSansExperience.forEach((dossier) => {
      if (!dossier.experience) return;
      compte[dossier.experience] = (compte[dossier.experience] ?? 0) + 1;
    });
    return compte;
  }, [dossiersFiltresSansExperience]);

  // Liste finale affichée : les deux filtres à badges (statut + expérience) combinés en ET, en
  // plus de recherche/dates/entité déjà dans dossiersFiltresBase.
  const dossiersFiltres = useMemo(
    () => dossiersFiltresSansExperience.filter((dossier) => !experienceFiltre || dossier.experience === experienceFiltre),
    [dossiersFiltresSansExperience, experienceFiltre],
  );

  // Sélection multiple + actions groupées (audit 2026-08-24) — même patron que Planification.jsx
  // (Suivi des tests) : un Set d'ids, jamais réinitialisé au changement de filtre/recherche (une
  // sélection faite sous un filtre reste valable si l'agent élargit/change ensuite le filtre,
  // même choix que dossiersSelectionnes là-bas). `dossierIdsVisibles` = dossiersFiltres actuel :
  // DossierList.jsx ne fait que TRIER ce qu'on lui donne (jamais filtrer, voir son commentaire
  // d'en-tête), "tout ce qui est affiché" est donc exactement dossiersFiltres, sans recalcul côté
  // enfant.
  const [dossiersSelectionnes, setDossiersSelectionnes] = useState(new Set());
  const dossierIdsVisibles = useMemo(() => dossiersFiltres.map((dossier) => dossier.id), [dossiersFiltres]);
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

  // Objets complets (pas seulement les ids) des dossiers sélectionnés — lus depuis `dossiers`
  // (liste complète déjà en mémoire, voir plus haut), pas `dossiersFiltres` : une sélection reste
  // exploitable par les modales même si l'agent modifie ensuite le filtre/la recherche pendant
  // qu'une sélection est déjà faite (voir commentaire ci-dessus). Sert aux deux modales groupées
  // ci-dessous (nom du candidat affiché par ligne, postesBureau/postesHotel pour la
  // replanification).
  const dossiersSelectionnesObjets = useMemo(
    () => dossiers.filter((dossier) => dossiersSelectionnes.has(dossier.id)),
    [dossiers, dossiersSelectionnes],
  );

  // Replanification groupée (point 5, audit 2026-08-25) : n'exclut QUE le statut courant, jamais
  // l'historique du dossier (un dossier "test_non_planifie" a pu être planifié puis reprogrammé
  // en amont, seul son statut ACTUEL détermine s'il l'est encore) — voir
  // STATUTS_REPLANIFIABLES_ACCECIT ci-dessus.
  const dossiersEligiblesReplanification = useMemo(
    () => dossiersSelectionnesObjets.filter((dossier) => STATUTS_REPLANIFIABLES_ACCECIT.includes(dossier.statut_code)),
    [dossiersSelectionnesObjets],
  );
  const dossiersExclusReplanification = useMemo(
    () => dossiersSelectionnesObjets.filter((dossier) => !STATUTS_REPLANIFIABLES_ACCECIT.includes(dossier.statut_code)),
    [dossiersSelectionnesObjets],
  );

  // Modale ouverte pour les actions groupées "Relances"/"Replanifier des tests" — 'relance' |
  // 'replanification' | null. "Export des pièces" n'en a pas besoin (téléchargement direct
  // déclenché par lancerExportPieces ci-dessous) : c'est la seule des trois actions qui ne demande
  // aucune saisie supplémentaire à l'agent avant de s'exécuter.
  const [modaleGroupeeOuverte, setModaleGroupeeOuverte] = useState(null);

  // Vide la sélection et ferme la modale — appelé quand une modale groupée se termine avec succès
  // (voir onTermine des deux modales) : l'agent revient sur une liste "propre", cohérente avec le
  // comportement d'une action individuelle réussie (retour à l'écran précédent).
  const terminerActionGroupee = () => {
    setModaleGroupeeOuverte(null);
    setDossiersSelectionnes(new Set());
  };

  // Export groupé des pièces (point 4, audit 2026-08-25) : exclut du ZIP les dossiers n'ayant
  // strictement aucune pièce chargée (une capture n'a jamais eu lieu pour eux), au lieu de laisser
  // le back leur créer un sous-dossier vide avec un simple "_aucune_piece.txt" (comportement
  // toujours en place pour un dossier isolé, voir dossiers.routes.js). Vérification faite ici,
  // dossier par dossier via GET /dossiers/:id/pieces (même endpoint que CaptureTablette.jsx/
  // Validation.jsx), avant de déclencher le téléchargement — pas d'endpoint groupé dédié, ce
  // volume (quelques dizaines de dossiers au plus) ne justifie pas d'en ajouter un.
  // Résultat conservé dans messageExportPieces (dossiersExclus, aucunExport) pour affichage sous la
  // barre d'actions groupées ; réinitialisé plus bas dès que la sélection change (message qui ne
  // correspondrait plus à ce qui est coché).
  const [verificationExportEnCours, setVerificationExportEnCours] = useState(false);
  const [messageExportPieces, setMessageExportPieces] = useState(null);

  useEffect(() => {
    setMessageExportPieces(null);
  }, [dossiersSelectionnes]);

  const lancerExportPieces = async () => {
    if (verificationExportEnCours) return;
    setVerificationExportEnCours(true);
    setMessageExportPieces(null);
    try {
      const comptes = await Promise.all(
        dossiersSelectionnesObjets.map((dossier) =>
          listerPiecesJustificatives(dossier.id)
            .then((pieces) => pieces.length)
            .catch(() => 0),
        ),
      );
      const dossiersAvecPieces = [];
      const dossiersSansPiece = [];
      dossiersSelectionnesObjets.forEach((dossier, index) => {
        (comptes[index] > 0 ? dossiersAvecPieces : dossiersSansPiece).push(dossier);
      });

      if (dossiersSansPiece.length > 0) {
        setMessageExportPieces({ dossiersExclus: dossiersSansPiece, aucunExport: dossiersAvecPieces.length === 0 });
      }

      if (dossiersAvecPieces.length === 0) return;

      // Téléchargement réel (pas un fetch en blob) — même patron que le lien précédent : le back
      // pose déjà Content-Disposition: attachment (voir dossiers.routes.js), le navigateur gère le
      // téléchargement seul via le cookie de session (same-origin). Ancre créée dynamiquement
      // plutôt qu'un <a> statique dans le JSX : l'URL dépend du résultat de la vérification
      // ci-dessus (dossierIds filtrés), connu seulement à l'exécution.
      const lien = document.createElement('a');
      lien.href = `${api.defaults.baseURL}/dossiers/pieces/export-zip-groupe?dossierIds=${dossiersAvecPieces.map((dossier) => dossier.id).join(',')}`;
      lien.setAttribute('download', '');
      document.body.appendChild(lien);
      lien.click();
      lien.remove();
    } finally {
      setVerificationExportEnCours(false);
    }
  };

  const compteursParStatut = useMemo(() => {
    const compte = {};
    dossiersFiltresSansStatut.forEach((dossier) => {
      compte[dossier.statut_code] = (compte[dossier.statut_code] ?? 0) + 1;
    });
    // "Test réalisé" : compteur agrégé (voir CODES_STATUTS_TEST_REALISE_ACCECIT ci-dessus), pas
    // le simple compte de dossiers au statut test_realise seul — recalculé à partir des comptes
    // individuels déjà posés ci-dessus. Chacun des 4 codes garde par ailleurs SA propre valeur
    // pour son propre bouton (ex. compte.invalide reste le nombre réel de dossiers invalidés pour
    // le bouton "Invalidé" ci-dessous) : seule la clé 'test_realise' de cet objet est réécrite ici.
    compte.test_realise = CODES_STATUTS_TEST_REALISE_ACCECIT.reduce((somme, code) => somme + (compte[code] ?? 0), 0);
    return compte;
  }, [dossiersFiltresSansStatut]);

  // Compteur des boutons "Hôtellerie"/"Tertiaire" : recherche/dates/statut appliqués, entité
  // ignorée (voir dossiersRechercheDate ci-dessus) — chaque bouton compte comme si LUI SEUL était
  // sélectionné, pour rester cohérent avec le comportement de clic (Set, indépendamment activable).
  // Volontairement PAS mutuellement exclusifs (audit 2026-08-18, point de vigilance "double
  // comptage") : un dossier avec à la fois un poste Hôtellerie et un poste Tertiaire (candidat
  // intéressé par les deux familles, cas permis par BlocDisponibilites.jsx) compte dans les deux
  // boutons plutôt que d'être arbitrairement rattaché à une seule "entité principale" — le
  // masquer d'un des deux filtres cacherait un candidat réellement pertinent au recruteur qui
  // consulte CE filtre. Ce choix implique Tous < Hôtellerie + Tertiaire si un tel dossier existe
  // un jour (aucun actuellement) : ce n'est pas un bug, "Tous" (filtrerDossiers.js) reste exact
  // car calculé comme le nombre de dossiers DISTINCTS ayant au moins un poste, pas comme la somme
  // de ces deux compteurs.
  // codesPourFiltreStatut (pas une simple égalité de code) : "Test réalisé" étant un filtre
  // agrégé (voir plus haut), ces deux compteurs doivent eux aussi compter les 4 statuts agrégés
  // quand ce bouton est actif, sous peine de rester bloqués sur le seul sous-ensemble test_realise
  // pendant que le tableau/compteur "Test réalisé" affichent déjà l'ensemble élargi.
  const compteurHotel = useMemo(
    () =>
      dossiersRechercheDate.filter(
        (dossier) =>
          (!statutFiltre || codesPourFiltreStatut(statutFiltre).includes(dossier.statut_code)) &&
          (!experienceFiltre || dossier.experience === experienceFiltre) &&
          (dossier.postesHotel ?? []).length > 0,
      ).length,
    [dossiersRechercheDate, statutFiltre, experienceFiltre],
  );
  const compteurBureau = useMemo(
    () =>
      dossiersRechercheDate.filter(
        (dossier) =>
          (!statutFiltre || codesPourFiltreStatut(statutFiltre).includes(dossier.statut_code)) &&
          (!experienceFiltre || dossier.experience === experienceFiltre) &&
          (dossier.postesBureau ?? []).length > 0,
      ).length,
    [dossiersRechercheDate, statutFiltre, experienceFiltre],
  );

  const statutsFiltres = useMemo(
    () => statuts.filter((statut) => CODES_STATUTS_FILTRES_ACCUEIL.includes(statut.code)),
    [statuts],
  );

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
      <div className="tableau-bord-accueil">
        <header className="tableau-bord-accueil__entete">
          <h1>Dossiers candidats</h1>
          {/* Bouton "Planification des tests" retiré (refonte navigation, 2026-08-17) : couvert
              par le lien "Suivi des tests" de la barre de navigation commune, voir
              BarreNavigation.jsx (montée dans PageBackOffice.jsx). */}
          <EnTeteBackOffice />
        </header>

        <FiltresRechercheDossiers
          recherche={recherche}
          onChangerRecherche={setRecherche}
          dateDebutFiltre={dateDebutFiltre}
          onChangerDateDebutFiltre={setDateDebutFiltre}
          dateFinFiltre={dateFinFiltre}
          onChangerDateFinFiltre={setDateFinFiltre}
        />
        {/* Filtre "Expérience" (audit 2026-09-02, refonte visuelle) — badges cliquables, même
            disposition/composant visuel que la boîte de badges de statut juste en dessous
            (.filtres-statut__statuts, réutilisée telle quelle plutôt que dupliquée) : boîte
            ivoire, boutons pilule, compteur entre parenthèses. Comportement de sélection
            DÉLIBÉRÉMENT différent de FiltresStatut.jsx (pas de bouton "Tous" séparé) : cliquer le
            badge déjà actif le désactive (retour à experienceFiltre === ''), alors qu'un bouton de
            statut ne se désactive que via "Tous" — demande explicite, cohérente avec l'absence
            d'équivalent "Tous" pour ce filtre à 4 valeurs seulement. data-experience (comme
            data-statut) : accroche de couleur par valeur, voir TableauDeBordAccueil.css. */}
        <div
          className="filtres-statut__statuts tableau-bord-accueil__filtres-experience"
          role="group"
          aria-label="Filtrer par expérience"
        >
          {/* Titre visible à l'intérieur du cadre (audit 2026-09-02, régression signalée : le
              <select> retiré portait le seul libellé "Expérience" existant, perdu au passage aux
              badges) — même span nu, sans style dédié, que "Poste"/"Formateur" devant leurs propres
              filtres (Indicateurs.jsx/Planification.jsx) : pas un nouveau traitement visuel
              inventé ici. */}
          <span className="tableau-bord-accueil__filtres-experience-titre">Expérience</span>
          {CODES_EXPERIENCE_ACCECIT.map((code) => (
            <button
              key={code}
              type="button"
              data-experience={code}
              className={experienceFiltre === code ? 'actif' : ''}
              onClick={() => setExperienceFiltre(experienceFiltre === code ? '' : code)}
            >
              {libelleExperience(code)}
              <strong> ({compteursParExperience[code] ?? 0})</strong>
            </button>
          ))}
        </div>
        <FiltresStatut
          statuts={statutsFiltres}
          statutFiltre={statutFiltre}
          onChangerStatutFiltre={setStatutFiltre}
          compteurTous={dossiersFiltresSansStatut.length}
          compteurs={compteursParStatut}
          filtresSupplementaires={
            <div className="tableau-bord-accueil__filtre-entite" role="group" aria-label="Filtrer par entité">
              {/* data-entite (même patron que data-statut, FiltresStatut.jsx) : accroche de style
                  pour TableauDeBordAccueil.css (point 2, audit 2026-08-25 — couleurs Hôtellerie/
                  Tertiaire distinctes), sans que ce bouton n'ait à porter la couleur lui-même en
                  ligne. */}
              <button
                type="button"
                data-entite="hotel"
                className={entitesFiltre.has('hotel') ? 'actif' : ''}
                aria-pressed={entitesFiltre.has('hotel')}
                onClick={() => basculerEntiteFiltre('hotel')}
              >
                Hôtellerie <strong>({compteurHotel})</strong>
              </button>
              <button
                type="button"
                data-entite="bureau"
                className={entitesFiltre.has('bureau') ? 'actif' : ''}
                aria-pressed={entitesFiltre.has('bureau')}
                onClick={() => basculerEntiteFiltre('bureau')}
              >
                Tertiaire <strong>({compteurBureau})</strong>
              </button>
            </div>
          }
        />

        {/* Barre d'actions groupées (audit 2026-08-24, seuil abaissé à 1 le 2026-08-25) — sticky
            en haut de la zone de contenu (voir TableauDeBordAccueil.css) : reste visible pendant
            que l'agent défile la liste pour continuer à cocher des candidats, plutôt que de
            disparaître dès que la barre de filtres/le premier écran de lignes défile hors champ. */}
        {dossiersSelectionnes.size >= SEUIL_SELECTION_ACTIONS_GROUPEES && (
          <div className="tableau-bord-accueil__actions-groupees" role="toolbar" aria-label="Actions groupées">
            <span className="tableau-bord-accueil__actions-groupees-compteur">
              {dossiersSelectionnes.size} candidat{dossiersSelectionnes.size > 1 ? 's' : ''} sélectionné
              {dossiersSelectionnes.size > 1 ? 's' : ''}
            </span>
            {/* Vérification asynchrone (lancerExportPieces) avant de déclencher le téléchargement
                réel — voir son commentaire d'en-tête : le lien statique <a href download> a été
                remplacé par un bouton, l'URL finale (dossiers filtrés) n'étant connue qu'une fois
                la vérification terminée. */}
            <button
              type="button"
              className="tableau-bord-accueil__bouton-action-groupee"
              onClick={lancerExportPieces}
              disabled={verificationExportEnCours}
            >
              {verificationExportEnCours ? 'Vérification…' : 'Export des pièces'}
            </button>
            <button
              type="button"
              className="tableau-bord-accueil__bouton-action-groupee"
              onClick={() => setModaleGroupeeOuverte('relance')}
            >
              Relances
            </button>
            <button
              type="button"
              className="tableau-bord-accueil__bouton-action-groupee"
              onClick={() => setModaleGroupeeOuverte('replanification')}
            >
              Replanifier des tests
            </button>
            {/* "Effacer la sélection" (audit 2026-08-25) — même libellé que le bouton déjà en place
                sur le panneau "Dossiers sélectionnés" du tableau de bord Indicateurs (Indicateurs.jsx,
                onClick={() => setSelectionIndicateurs(new Set())}), pour rester cohérent d'un écran à
                l'autre malgré un state différent (ici dossiersSelectionnes, un Set d'ids de dossiers,
                pas un Set de codes d'indicateurs) : remet la sélection à zéro, ce qui fait
                disparaître cette barre elle-même au rendu suivant (le seuil
                SEUIL_SELECTION_ACTIONS_GROUPEES n'est alors plus atteint). Classe modificatrice
                --effacer (distinction visuelle, audit 2026-08-25) EN PLUS de la classe de base
                (garde le même gabarit — padding/taille/police — que les 3 boutons voisins, voir
                TableauDeBordAccueil.css) : seule la couleur change, pas la taille. */}
            <button
              type="button"
              className="tableau-bord-accueil__bouton-action-groupee tableau-bord-accueil__bouton-action-groupee--effacer"
              onClick={() => setDossiersSelectionnes(new Set())}
            >
              Effacer la sélection
            </button>
          </div>
        )}

        {/* Résultat de l'exclusion des dossiers sans pièce (point 4, audit 2026-08-25) — affiché
            sous la barre plutôt que dans une modale : "Export des pièces" ne s'ouvre jamais dans
            une modale (voir plus haut), ce message est donc le seul retour disponible pour
            l'agent. Réinitialisé (messageExportPieces) dès que la sélection change, voir l'effet
            correspondant plus haut dans ce fichier. */}
        {messageExportPieces && messageExportPieces.dossiersExclus.length > 0 && (
          <div className="tableau-bord-accueil__message-export" role="status">
            <p>
              {messageExportPieces.aucunExport
                ? `Aucun export généré : ${messageExportPieces.dossiersExclus.length} dossier(s) sélectionné(s) n'ont aucune pièce disponible.`
                : `${messageExportPieces.dossiersExclus.length} dossier(s) non exporté(s), aucune pièce disponible.`}
            </p>
            <details>
              <summary>Voir le détail</summary>
              <ul>
                {messageExportPieces.dossiersExclus.map((dossier) => (
                  <li key={dossier.id}>
                    N°{dossier.id} - {dossier.candidat_nom} {dossier.candidat_prenom}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        )}

        {chargementDossiers && <p>Chargement des dossiers…</p>}
        {erreur && <p role="alert">{erreur}</p>}

        {!chargementDossiers && !erreur && (
          <DossierList
            dossiers={dossiersFiltres}
            varianteStatut={varianteStatut}
            libellePoste={libellePoste}
            libelleExperience={libelleExperience}
            varianteExperience={varianteExperience}
            dossiersSelectionnes={dossiersSelectionnes}
            onTogglerSelectionDossier={togglerSelectionDossier}
            toutSelectionne={tousVisiblesSelectionnes}
            onTogglerSelectionnerTout={togglerSelectionnerTout}
            actions={[
              {
                libelle: 'Étudier le dossier',
                onSelectionner: (dossier) => navigate(`/recruteur/dossiers/${dossier.id}/validation`),
                // Style back-office accent (cadre séparé, dégradé brun/doré, largeur fixe forçant
                // le retour à la ligne "Étudier / le / dossier") conservé tel quel malgré le
                // retrait de Pièces/Relances/Replanifier (voir DossierList.css,
                // .dossier-list__action--accent) : mise en forme déjà validée avant la
                // simplification de la colonne Actions, pas de raison d'en changer maintenant que
                // ce bouton y est seul. `alignerADroite` retiré (audit 2026-08-19) : poussait le
                // bouton à l'extrême droite de la cellule, utile pour le distinguer des autres
                // actions quand elles existaient encore — seul restant, il est maintenant centré
                // via .dossier-list__actions (voir DossierList.css).
                accent: true,
              },
            ]}
          />
        )}
      </div>

      {/* key={[...dossiersSelectionnes].join(',')} : force un remontage complet de la modale si la
          sélection change pendant qu'elle est fermée puis rouverte (improbable mais possible via
          les cases de la colonne de sélection restées visibles derrière un fond semi-opaque) —
          chaque ouverture doit repartir d'un chargement propre (formateurs/lieux/derniers
          rendez-vous), jamais d'un état résiduel d'une ouverture précédente sur une autre
          sélection. */}
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
    </PageBackOffice>
  );
}
