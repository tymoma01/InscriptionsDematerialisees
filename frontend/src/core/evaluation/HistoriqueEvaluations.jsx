import { useEffect, useMemo, useState } from 'react';
import StatutBadge from '../workflow/StatutBadge';
import { normaliserTexte } from '../filtres/normaliserTexte';
import { useParametreURL } from '../filtres/useParametreURL';
import FiltrePlageDate from '../filtres/FiltrePlageDate';
import { listerHistoriqueEvaluations, listerCreneauxDisponibles } from '../../services/evaluationService';
import './HistoriqueEvaluations.css';

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

// Libellés des postes hôtel — mêmes codes/libellés que BlocDisponibilites.jsx (POSTES_HOTEL) et
// GrilleEvaluation.jsx (POSTE_HOTEL_LIBELLES), dupliqués ici plutôt que partagés : quelques
// lignes de données, même choix déjà fait ailleurs dans le projet (voir VARIANTE_PAR_CODE_ACCECIT,
// TableauDeBordAccueil.jsx/Backoffice.jsx).
const POSTE_HOTEL_LIBELLES = {
  femme_valet_chambre: 'Femme/Valet de chambre',
  cafetier: 'Cafétier(ère)',
  equipier: 'Équipier(ère)',
  gouvernant: 'Gouvernant(e)',
};
const POSTE_BUREAU_LIBELLES = {
  nettoyage: 'Nettoyage',
  vitrerie: 'Vitrerie',
  machiniste: 'Machiniste',
  chef_equipe: "Chef d'équipe",
  autres: 'Autres',
};

// postes_codes : plusieurs postes peuvent avoir été évalués dans une même évaluation (blocs
// empilés, voir GrilleEvaluation.jsx / backend evaluationEngine.enregistrerEvaluation) — tableau
// vide/absent = repli sur le questionnaire générique (poste hôtel/bureau sans questionnaire dédié,
// ou dossier créé avant l'ajout des questionnaires bureau), voir backend evaluationEngine.js,
// trouverQuestionnairePourPoste. Un dossier bureau évalué par un Inspecteur a désormais un poste
// résolu comme un dossier hôtel (voir GrilleEvaluation.jsx, postesCandidats) : le libellé
// "Générique" ne concerne donc plus que ce vrai cas de repli, pas systématiquement le bureau.
function libellePostes(postesCodes) {
  if (!postesCodes || postesCodes.length === 0) return 'Générique';
  return postesCodes.map((posteCode) => POSTE_HOTEL_LIBELLES[posteCode] ?? POSTE_BUREAU_LIBELLES[posteCode] ?? posteCode).join(', ');
}

// Ordre chronologique du vocabulaire bureau — même liste que CRENEAUX_PAR_TYPE_POSTE.bureau côté
// backend (evaluationRepository.js), dupliquée ici (même choix que POSTE_HOTEL_LIBELLES ci-dessus).
// Sert à la fois de source pour le select "Créneaux souhaités" (voir optionsCreneaux plus bas,
// alimenté par listerCreneauxDisponibles) ET de repère d'ordre pour le tri de la colonne "Créneau"
// ci-dessous (jamais un tri alphabétique de chaînes : '18h-21h' triait avant '6h-9h', bug corrigé
// audit 2026-09-18 côté backend, même piège évité ici).
const ORDRE_CRENEAUX_BUREAU = ['6h-9h', '9h-18h', '18h-21h'];

// Vocabulaire hôtel — même liste que CRENEAUX_PAR_TYPE_POSTE.hotel côté backend. Le rôle Inspecteur
// reste normalement scopé secteur bureau (voir evaluationEngine.listerHistorique), mais une ligne
// dont les données restent incohérentes en base (même cas que le correctif du select ci-dessus,
// audit 2026-09-18) peut encore afficher un code hôtel ici — ce tri doit rester correct même dans
// ce cas, pas seulement pour le vocabulaire bureau.
const ORDRE_CRENEAUX_HOTEL = ['matin', 'midi', 'soir'];

// Ordre d'affichage combiné (audit 2026-09-19, demande utilisateur : les badges d'une même ligne
// apparaissaient dans l'ordre brut de stockage en base, incohérent d'une ligne à l'autre) — bureau
// puis hôtel, une valeur hors des deux vocabulaires (ne devrait pas arriver) repoussée en fin sans
// faire échouer le tri.
const ORDRE_CRENEAUX = [...ORDRE_CRENEAUX_BUREAU, ...ORDRE_CRENEAUX_HOTEL];

// Copie triée par ordre chronologique du vocabulaire (jamais l'ordre de stockage en base, ni un tri
// alphabétique) — voir ORDRE_CRENEAUX ci-dessus. Array.prototype.sort est stable (spec ES2019+),
// donc deux codes absents du vocabulaire gardent leur ordre relatif d'origine en fin de liste.
function trierCreneaux(creneaux) {
  return [...(creneaux ?? [])].sort((a, b) => {
    const indiceA = ORDRE_CRENEAUX.indexOf(a);
    const indiceB = ORDRE_CRENEAUX.indexOf(b);
    return (indiceA === -1 ? ORDRE_CRENEAUX.length : indiceA) - (indiceB === -1 ? ORDRE_CRENEAUX.length : indiceB);
  });
}

// Palette "Créneau" (audit 2026-09-18, demande utilisateur) — 3 variantes StatutBadge déjà
// utilisées ailleurs dans l'app pour des besoins catégoriels (pas un jugement positif/négatif,
// contrairement à 'echec'/'succes'/'vert-clair' déjà pris par la colonne "Résultat" de CE même
// tableau, à ne pas réutiliser ici pour éviter toute confusion visuelle) : 'bleu'/'violet' déjà
// utilisées pour des statuts neutres de planification (TableauDeBordAccueil.jsx, Planification.jsx,
// PanneauHistoriqueRendezvous.jsx), 'dore' déjà utilisée pour des badges de poste (catégoriel, pas
// un statut — voir Indicateurs.jsx, PREFIXE_POSTE). Indicateur emoji associé (voir le select plus
// bas) : couleur la plus proche du badge rendu, un <option> natif ne pouvant pas porter de
// background-color/pseudo-élément fiable cross-navigateur — un simple caractère Unicode coloré
// fonctionne partout, contrairement à du CSS ciblant <option>.
const CRENEAU_VARIANTES = { '6h-9h': 'bleu', '9h-18h': 'dore', '18h-21h': 'violet' };
const CRENEAU_EMOJI = { '6h-9h': '🔵', '9h-18h': '🟤', '18h-21h': '🟣' };

// Recherche élargie (nom/prénom du candidat, n° de dossier, poste(s) évalué(s), résultat) — même
// principe que Dossiers candidats/Suivi des tests (filtrerDossiers.js/Planification.jsx) : toutes
// les colonnes visibles du tableau (audit 2026-08-20), jamais seulement un sous-ensemble. Nom/
// prénom comparés mot par mot, insensible à l'ordre de saisie ; poste/résultat comparés par simple
// inclusion sur le libellé AFFICHÉ (libelleResultat, défini plus bas — function déclarée, donc
// disponible ici malgré l'ordre du fichier), jamais resultat_global/orientation bruts : un agent
// tape "invalidé" ou "prêt à l'embauche", pas les codes internes 'invalide'/'pret_embauche'.
// Dupliqué plutôt que partagé : `evaluation` n'a pas la même forme qu'un `dossier`/`rdv`, et cette
// page n'a ni téléphone ni email à chercher. Une saisie numérique courte ("91") ne vise QUE le n°
// de dossier, en égalité stricte — même correctif qu'ailleurs (audit 2026-08-19) : une simple
// inclusion remonterait aussi "191"/"912"/etc. Pas de cas "saisie numérique longue" à gérer ici
// (contrairement à filtrerDossiers.js/Planification.jsx) : cette page n'a aucun champ téléphone,
// une telle saisie ne matche donc simplement rien (repli naturel sur nom/poste/résultat ci-dessous,
// tous non numériques).
function rechercheCorrespond(evaluation, { motsRechercheNom, rechercheNormaliseeTexte, rechercheChiffresSeuls, rechercheEstNumeroDossier }) {
  if (rechercheEstNumeroDossier) {
    return String(evaluation.dossier_id) === rechercheChiffresSeuls;
  }
  const nomComplet = normaliserTexte(`${evaluation.candidat_prenom} ${evaluation.candidat_nom}`.toLowerCase());
  const correspondNom = motsRechercheNom.every((mot) => nomComplet.includes(mot));
  const postes = normaliserTexte(libellePostes(evaluation.postes_codes).toLowerCase());
  const correspondPoste = postes.includes(rechercheNormaliseeTexte);
  const resultat = normaliserTexte(libelleResultat(evaluation).toLowerCase());
  const correspondResultat = resultat.includes(rechercheNormaliseeTexte);
  return correspondNom || correspondPoste || correspondResultat;
}

// Combine resultat_global + orientation en un seul libellé — mêmes formulations que
// workflow.config.json (statuts valide_envoi_formation/valide_pret_embauche/invalide), pour rester
// cohérent avec le vocabulaire déjà utilisé ailleurs dans le back-office (TableauDeBordAccueil.jsx/
// Backoffice.jsx, VARIANTE_PAR_CODE_ACCECIT). Un verdict positif d'Inspecteur (bureau) a
// orientation=NULL (pas de notion de formation, voir backend evaluationEngine.js) — repli sur
// "prêt à l'embauche" plutôt que "envoyé en formation" dans ce cas : le bureau réutilise
// exactement le statut valide_pret_embauche, jamais valide_envoi_formation (voir
// CODE_ACTION_VALIDE_BUREAU côté back).
function libelleResultat(evaluation) {
  if (evaluation.resultat_global === 'invalide') return 'Invalidé';
  if (evaluation.orientation === 'envoi_formation') return 'Validé - envoyé en formation';
  return 'Validé - prêt à l\'embauche';
}

function varianteResultat(evaluation) {
  if (evaluation.resultat_global === 'invalide') return 'echec';
  return evaluation.orientation === 'envoi_formation' ? 'succes' : 'vert-clair';
}

// Une entrée par colonne triable, même patron que DossierList.jsx/Utilisateurs.jsx/
// Planification.jsx. "Candidat" trie sur le nom de famille, pas la chaîne "prénom nom" affichée.
const COLONNES_BASE = [
  { cle: 'candidat_nom', libelle: 'Candidat', extraire: (e) => (e.candidat_nom ?? '').toLowerCase() },
  { cle: 'postes_codes', libelle: 'Poste(s) évalué(s)', extraire: (e) => libellePostes(e.postes_codes).toLowerCase() },
  { cle: 'date_evaluation', libelle: 'Date du test', extraire: (e) => new Date(e.date_evaluation).getTime() },
  { cle: 'resultat_global', libelle: 'Résultat', extraire: (e) => libelleResultat(e).toLowerCase() },
];

// Colonne "Créneau" (audit 2026-09-18, demande utilisateur) — creneaux (tableau JSONB, voir
// evaluationRepository.listerEvaluationsParFormateur, même donnée que le filtre "Créneaux
// souhaités" ci-dessous, aucune nouvelle source). Tri sur le créneau le plus TÔT de l'évaluation
// (voir ORDRE_CRENEAUX_BUREAU) plutôt qu'un tri alphabétique des codes joints — même piège que le
// select ci-dessus, une chaîne triée mettrait '18h-21h' avant '6h-9h'. Repli sur la fin du
// vocabulaire (jamais -1/NaN) si vide ou valeur hors vocabulaire — ne devrait pas arriver pour
// l'Inspecteur (seul rôle affichant cette colonne, voir `afficherInspecteur`, toujours scopé
// secteur bureau côté serveur), mais évite un tri incohérent si jamais un cas limite se présentait.
const COLONNE_CRENEAU = {
  cle: 'creneaux',
  libelle: 'Créneau',
  extraire: (e) => {
    const indices = (e.creneaux ?? []).map((creneau) => {
      const indice = ORDRE_CRENEAUX_BUREAU.indexOf(creneau);
      return indice === -1 ? ORDRE_CRENEAUX_BUREAU.length : indice;
    });
    return indices.length > 0 ? Math.min(...indices) : ORDRE_CRENEAUX_BUREAU.length;
  },
};

// Colonne "Inspecteur" (audit 2026-09-17, demande utilisateur) — formateur_prenom/formateur_nom,
// voir evaluationRepository.listerEvaluationsParFormateur, même donnée que la colonne "Assigné à"
// de ListeEvaluationsAFaire.jsx ("Évaluations à venir"). N'a de sens que si la liste peut contenir
// des évaluations soumises par un autre utilisateur que celui connecté (voir `afficherInspecteur`
// en en-tête de composant ci-dessous) — insérée après "Créneau" ci-dessus, donc entre "Poste(s)
// évalué(s)" et "Date du test" au global (voir point d'insertion dans `colonnes` ci-dessous).
const COLONNE_INSPECTEUR = {
  cle: 'inspecteur',
  libelle: 'Inspecteur',
  extraire: (e) => `${e.formateur_prenom ?? ''} ${e.formateur_nom ?? ''}`.trim().toLowerCase(),
};

// Historique des évaluations déjà soumises, filtré côté serveur selon le rôle connecté (voir
// backend evaluationEngine.listerHistorique) : Formateur ne voit que ses propres évaluations,
// Inspecteur voit celles de tous les Inspecteurs (secteur bureau, audit 2026-09-17) — un même
// candidat peut apparaître plusieurs fois si repassé un test (postes_codes distincts par ligne
// d'évaluation, une évaluation pouvant elle-même couvrir plusieurs postes empilés), volontairement
// pas dédupliqué.
// `onSelectionner` laisse à l'appelant la décision d'ouvrir le détail — ce composant ne connaît pas
// DetailEvaluation.jsx, même patron que ListeEvaluationsAFaire.jsx.
//
// `afficherInspecteur` (audit 2026-09-17, demande utilisateur) : n'affiche la colonne "Inspecteur"
// que si explicitement demandé — seul pages/inspecteur/HistoriqueEvaluations.jsx la passe à true,
// depuis que la liste y montre les évaluations de TOUS les Inspecteurs (voir backend
// evaluationEngine.listerHistorique, qui ignore formateurId pour ce rôle). pages/formateur/
// HistoriqueEvaluations.jsx ne la passe pas : la liste y reste filtrée à l'utilisateur connecté, la
// colonne n'aurait donc rien d'utile à montrer (toujours son propre nom) — comportement Formateur
// inchangé, même raisonnement que `afficherAssigne` (ListeEvaluationsAFaire.jsx).
export default function HistoriqueEvaluations({ onSelectionner, afficherInspecteur = false }) {
  const [evaluations, setEvaluations] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);
  const [tri, setTri] = useState({ colonne: 'date_evaluation', ordre: 'desc' });

  // Filtres persistés dans l'URL (query params), même mécanisme que Dossiers candidats/Suivi des
  // tests — voir useParametreURL.js. S'appliquent en plus de la restriction RBAC déjà posée côté
  // serveur (listerHistoriqueEvaluations, voir son commentaire d'en-tête pour le périmètre exact
  // selon le rôle) : filtrage entièrement client sur une liste déjà scopée, jamais une restriction
  // en soi.
  const [recherche, setRecherche] = useParametreURL('q', '');
  const [dateDebutFiltre, setDateDebutFiltre] = useParametreURL('date_debut', '');
  const [dateFinFiltre, setDateFinFiltre] = useParametreURL('date_fin', '');
  // "Créneaux souhaités" (audit 2026-09-17, demande utilisateur) : contrairement aux trois
  // filtres ci-dessus, filtré EN BASE (voir listerHistoriqueEvaluations({ creneau }) dans l'effet
  // de chargement plus bas), pas sur `evaluations` déjà reçu — même useParametreURL pour rester
  // cohérent (persisté dans l'URL, comme les autres), mais son changement redéclenche un appel
  // réseau au lieu d'un simple refiltrage de `evaluationsFiltrees`.
  const [creneauFiltre, setCreneauFiltre] = useParametreURL('creneau', '');
  // Options du select ci-dessus — valeurs réellement présentes en base pour l'utilisateur connecté
  // (voir backend evaluationEngine.listerCreneauxDisponibles), jamais une liste codée en dur type
  // CRENEAUX_BUREAU (BlocDisponibilites.schema.js) : ce fichier ne connaît pas le vocabulaire
  // hôtel/bureau, seulement ce qui existe réellement dans l'historique visible par ce rôle.
  // Chargées une seule fois (n'a pas besoin de suivre `evaluations`, qui lui-même change quand
  // `creneauFiltre` change — sinon une sélection retirerait ses propres options de la liste).
  // Uniquement côté Inspecteur (voir `afficherInspecteur`) : la vue Formateur n'affiche pas ce
  // filtre, inutile d'appeler l'API pour elle.
  const [optionsCreneaux, setOptionsCreneaux] = useState([]);

  // Colonnes "Créneau" puis "Inspecteur" insérées entre "Poste(s) évalué(s)" et "Date du test"
  // uniquement quand demandé (voir `afficherInspecteur` en en-tête de fichier) — recalculée
  // seulement si la prop change (jamais en pratique, une page donnée passe toujours la même
  // valeur). splice(2, 0, ...) avec les deux colonnes dans cet ordre : l'une derrière l'autre,
  // pas besoin d'un second splice.
  const colonnes = useMemo(() => {
    if (!afficherInspecteur) return COLONNES_BASE;
    const copie = [...COLONNES_BASE];
    copie.splice(2, 0, COLONNE_CRENEAU, COLONNE_INSPECTEUR);
    return copie;
  }, [afficherInspecteur]);

  // Recharge à chaque changement de creneauFiltre (filtre serveur, voir son commentaire
  // ci-dessus) — recherche/dates n'en font volontairement pas partie, filtrées côté client sur
  // `evaluations` une fois reçu (voir evaluationsFiltrees plus bas). Repasse chargement à true à
  // chaque changement de créneau, comme au montage initial : la ligne de filtres elle-même
  // disparaît brièvement (voir `if (chargement)` plus bas) — simplification assumée plutôt qu'un
  // rendu "ancienne liste + indicateur de chargement" non demandé ici.
  useEffect(() => {
    let annule = false;
    setChargement(true);
    setErreur(null);
    listerHistoriqueEvaluations({ creneau: creneauFiltre })
      .then((valeur) => {
        if (!annule) setEvaluations(valeur);
      })
      .catch((erreur) => {
        if (!annule) setErreur(erreur.response?.data?.erreur ?? "Impossible de récupérer l'historique des évaluations.");
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, [creneauFiltre]);

  // Options du select "Créneaux souhaités" — uniquement si affiché (voir `afficherInspecteur`),
  // chargées une seule fois au montage (n'a pas à suivre creneauFiltre, voir son commentaire
  // ci-dessus). Échec silencieux (voir catch vide) : une liste d'options vide ne fait que réduire
  // le select à sa seule option "Tous", ce n'est pas une erreur bloquante pour la page comme
  // l'échec du chargement de l'historique lui-même ci-dessus.
  //
  // Réinitialisation d'une valeur périmée (audit 2026-09-18, correctif) : creneauFiltre est
  // persisté dans l'URL (useParametreURL), donc un lien déjà partagé/en favori avec ?creneau=matin
  // — valeur du vocabulaire hôtel, plus jamais proposée par le select depuis le correctif du filtre
  // secteur ci-dessus — resterait sinon actif indéfiniment (0 résultat permanent, aucun moyen de le
  // comprendre depuis l'écran). setCreneauFiltre est stable (useCallback, voir useParametreURL.js),
  // sans risque de boucle avec l'effet de chargement ci-dessus (qui, lui, dépend de creneauFiltre).
  useEffect(() => {
    if (!afficherInspecteur) return undefined;
    let annule = false;
    listerCreneauxDisponibles()
      .then((valeur) => {
        if (annule) return;
        setOptionsCreneaux(valeur);
        if (creneauFiltre && !valeur.includes(creneauFiltre)) setCreneauFiltre('');
      })
      .catch(() => {});
    return () => {
      annule = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- creneauFiltre volontairement absent
    // des dépendances : ne doit tourner qu'au montage (voir commentaire ci-dessus), pas à chaque
    // changement de filtre — seulement lire sa valeur courante au moment où les options arrivent.
  }, [afficherInspecteur]);

  // Filtrage client (recherche + plage de date sur date_evaluation) sur la liste déjà reçue —
  // même bornage en heure locale que filtrerDossiers.js/Planification.jsx (dateDebutFiltre/
  // dateFinFiltre viennent d'un <input type="date">, jours calendaires tels que l'agent les lit,
  // pas des instants UTC).
  const evaluationsFiltrees = useMemo(() => {
    const rechercheNormalisee = recherche.trim().toLowerCase();
    const rechercheNormaliseeTexte = normaliserTexte(rechercheNormalisee);
    const motsRechercheNom = rechercheNormalisee.split(/\s+/).filter(Boolean).map(normaliserTexte);
    const rechercheChiffresSeuls = rechercheNormalisee.replace(/[\s-]/g, '');
    const rechercheEstNumeroDossier = rechercheChiffresSeuls.length > 0 && /^\d+$/.test(rechercheChiffresSeuls);
    const debut = dateDebutFiltre ? new Date(`${dateDebutFiltre}T00:00:00`) : null;
    const fin = dateFinFiltre ? new Date(`${dateFinFiltre}T23:59:59.999`) : null;
    return evaluations.filter((evaluation) => {
      if (debut || fin) {
        const dateEvaluation = new Date(evaluation.date_evaluation);
        if (debut && dateEvaluation < debut) return false;
        if (fin && dateEvaluation > fin) return false;
      }
      if (motsRechercheNom.length === 0) return true;
      return rechercheCorrespond(evaluation, {
        motsRechercheNom,
        rechercheNormaliseeTexte,
        rechercheChiffresSeuls,
        rechercheEstNumeroDossier,
      });
    });
  }, [evaluations, recherche, dateDebutFiltre, dateFinFiltre]);

  const evaluationsTriees = useMemo(() => {
    const colonneTri = colonnes.find((colonne) => colonne.cle === tri.colonne);
    const copie = [...evaluationsFiltrees];
    copie.sort((a, b) => {
      const valeurA = colonneTri.extraire(a);
      const valeurB = colonneTri.extraire(b);
      if (valeurA < valeurB) return tri.ordre === 'asc' ? -1 : 1;
      if (valeurA > valeurB) return tri.ordre === 'asc' ? 1 : -1;
      return 0;
    });
    return copie;
  }, [evaluationsFiltrees, tri, colonnes]);

  // Reclique sur la colonne déjà active : inverse l'ordre. Nouvelle colonne : "Date du test"
  // repart décroissant (l'évaluation la plus récente en premier reste le repère le plus utile
  // pour un historique), les colonnes textuelles repartent croissant — même patron que
  // DossierList.jsx.
  const trierPar = (colonne) => {
    setTri((precedent) => {
      if (precedent.colonne === colonne) {
        return { colonne, ordre: precedent.ordre === 'asc' ? 'desc' : 'asc' };
      }
      return { colonne, ordre: colonne === 'date_evaluation' ? 'desc' : 'asc' };
    });
  };

  if (chargement) {
    return <p>Chargement de l’historique…</p>;
  }
  if (erreur) {
    return <p role="alert">{erreur}</p>;
  }
  // !creneauFiltre (audit 2026-09-17) : sans cette condition, un filtre "Créneaux souhaités" qui
  // renvoie zéro évaluation (côté serveur, voir l'effet de chargement plus haut) afficherait à tort
  // "Aucune évaluation soumise pour l'instant" — message réservé au cas où l'utilisateur n'a
  // vraiment aucune évaluation, pas à un résultat vide dû à un filtre actif (voir le message dédié
  // "Aucune évaluation ne correspond aux critères actuels" plus bas, evaluationsTriees.length === 0).
  if (evaluations.length === 0 && !creneauFiltre) {
    return <p className="historique-evaluations__vide">Aucune évaluation soumise pour l’instant.</p>;
  }

  return (
    <>
      <div className="historique-evaluations__filtres">
        <label className="historique-evaluations__filtre-recherche">
          <span>Rechercher</span>
          <input
            type="search"
            value={recherche}
            onChange={(evenement) => setRecherche(evenement.target.value)}
            placeholder="Nom, prénom, N° dossier, poste ou résultat"
          />
        </label>

        {/* "Créneaux souhaités" (audit 2026-09-17, demande utilisateur) — uniquement côté
            Inspecteur (voir `afficherInspecteur`), filtré EN BASE contrairement à Rechercher/Du/Au
            (voir l'effet de chargement plus haut) : options = optionsCreneaux, jamais une liste
            codée en dur. Indicateur emoji (audit 2026-09-18, demande utilisateur — même palette
            CRENEAU_VARIANTES que la colonne "Créneau" du tableau, voir plus bas) : un <option>
            natif ne peut pas porter de background-color/pseudo-élément CSS de façon fiable
            cross-navigateur, un caractère Unicode coloré fonctionne partout. */}
        {afficherInspecteur && (
          <label className="historique-evaluations__filtre-creneau">
            <span>Créneaux souhaités</span>
            <select value={creneauFiltre} onChange={(evenement) => setCreneauFiltre(evenement.target.value)}>
              <option value="">Tous</option>
              {optionsCreneaux.map((creneau) => (
                <option key={creneau} value={creneau}>
                  {CRENEAU_EMOJI[creneau] ?? ''} {creneau}
                </option>
              ))}
            </select>
          </label>
        )}

        {/* Même composant que Dossiers candidats/Suivi des tests (voir FiltrePlageDate.jsx) —
            filtre ici sur date_evaluation ("Date du test") plutôt que la date de dernière mise à
            jour du dossier ou du rendez-vous. */}
        <FiltrePlageDate
          dateDebutFiltre={dateDebutFiltre}
          onChangerDateDebutFiltre={setDateDebutFiltre}
          dateFinFiltre={dateFinFiltre}
          onChangerDateFinFiltre={setDateFinFiltre}
        />
      </div>

      {evaluationsTriees.length === 0 ? (
        <p className="historique-evaluations__vide">Aucune évaluation ne correspond aux critères actuels.</p>
      ) : (
        <div className="historique-evaluations__scroll">
          <table className="historique-evaluations">
            <thead>
              <tr>
                {/* N° de dossier = evaluation.dossier_id, même principe que Dossiers candidats/
                    Suivi des tests (identifiant métier plutôt qu'un simple rang d'affichage). */}
                <th scope="col" className="historique-evaluations__colonne-numero">
                  N°
                </th>
                {colonnes.map((colonne) => {
                  const actif = tri.colonne === colonne.cle;
                  return (
                    <th key={colonne.cle} scope="col" aria-sort={actif ? (tri.ordre === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <button type="button" className="historique-evaluations__entete-tri" onClick={() => trierPar(colonne.cle)}>
                        {colonne.libelle}
                        <span className="historique-evaluations__indicateur-tri" aria-hidden="true">
                          {actif ? (tri.ordre === 'asc' ? '▲' : '▼') : ''}
                        </span>
                      </button>
                    </th>
                  );
                })}
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {evaluationsTriees.map((evaluation) => (
                <tr key={evaluation.id}>
                  <td className="historique-evaluations__colonne-numero">{evaluation.dossier_id}</td>
                  <td>
                    {evaluation.candidat_prenom} {evaluation.candidat_nom}
                  </td>
                  <td>{libellePostes(evaluation.postes_codes)}</td>
                  {afficherInspecteur && (
                    <td>
                      {(evaluation.creneaux ?? []).length === 0 ? (
                        '–'
                      ) : (
                        <div className="historique-evaluations__badges">
                          {trierCreneaux(evaluation.creneaux).map((creneau) => (
                            <StatutBadge key={creneau} libelle={creneau} variante={CRENEAU_VARIANTES[creneau] ?? 'neutre'} />
                          ))}
                        </div>
                      )}
                    </td>
                  )}
                  {afficherInspecteur && (
                    <td>
                      {evaluation.formateur_prenom} {evaluation.formateur_nom}
                    </td>
                  )}
                  <td>{FORMAT_DATE.format(new Date(evaluation.date_evaluation))}</td>
                  <td>
                    <StatutBadge libelle={libelleResultat(evaluation)} variante={varianteResultat(evaluation)} />
                  </td>
                  <td>
                    <div className="historique-evaluations__actions">
                      <button
                        type="button"
                        className="historique-evaluations__action-detail"
                        onClick={() => onSelectionner(evaluation)}
                      >
                        Voir le détail
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
