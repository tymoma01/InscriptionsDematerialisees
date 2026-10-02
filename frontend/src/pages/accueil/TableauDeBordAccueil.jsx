import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DossierList from '../../core/dossier/DossierList';
import FiltresStatut from '../../core/dossier/FiltresStatut';
import FiltreEntite from '../../core/dossier/FiltreEntite';
import { CODES_EXPERIENCE_ACCECIT, libelleExperience, varianteExperience } from '../../core/dossier/BadgeExperience';
import FiltresRechercheDossiers from '../../core/dossier/FiltresRechercheDossiers';
import { filtrerDossiers } from '../../core/dossier/filtrerDossiers';
import { useParametreURL, useEnsembleURL } from '../../core/filtres/useParametreURL';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import { useSession } from '../../core/auth/useSession';
import { peut, ROLE_INSPECTEUR_HOTELLERIE } from '../../core/auth/permissions';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import { listerDossiers, listerStatuts, corrigerDisponibiliteEmbauche } from '../../services/dossierService';
import { useRafraichissementAuto } from '../../core/dossier/useRafraichissementAuto';
import { dateDuJourParis } from '../../core/dossier/dateDuJourParis';
import ModaleRelanceGroupee from '../../core/dossier/ModaleRelanceGroupee';
import ModaleReplanificationGroupee from '../../core/dossier/ModaleReplanificationGroupee';
import ModaleDisponibiliteEmbauche from './ModaleDisponibiliteEmbauche';
import { listerPiecesJustificatives } from '../../services/pieceJustificativeService';
import api from '../../services/api';
import { libellePoste } from '../../core/referentiels/postes';
import { STATUTS_REPLANIFIABLES } from '../../core/referentiels/statutsDossier';
import {
  SEUIL_SELECTION_ACTIONS_GROUPEES,
  varianteStatut,
  infoBulleStatut,
  formaterDisponibiliteEffective,
  CODES_STATUTS_FILTRES_ACCUEIL,
  CODES_STATUTS_TEST_REALISE_ACCECIT,
  CODE_A_PLANIFIER,
  CODES_STATUTS_A_PLANIFIER_ACCECIT,
  codesPourFiltreStatut,
} from './affichageDossiers';
import './TableauDeBordAccueil.css';

// Tableau de bord Accueil (CLAUDE.md, besoins Accueil/Coordination : "vue centralisée des
// dossiers en attente") — liste les dossiers de l'entité courante, filtrables par statut. Une
// seule action par ligne, "Étudier le dossier" (Validation.jsx : pièces + export ZIP +
// transitions + notes + informations d'inscription complètes, tous statuts) — fusion de l'ancien
// Back-office recruteur (/recruteur/dossiers, supprimé) dans cette page, seule différence relevée
// à l'audit entre les deux tableaux (mêmes colonnes, mêmes filtres, même route API
// GET /api/dossiers, mêmes rôles consultationDossiers côté back).
// Les actions "Pièces"/"Relances"/"Replanifier", auparavant directement sur cette ligne,
// vivent désormais sur la fiche dossier elle-même (audit 2026-08-19, colonne Actions surchargée
// sur tablette — jusqu'à 4 boutons par ligne) : voir Validation.jsx, qui reste le seul et même
// écran de destination, pour ne pas éclater la fiche dossier en plusieurs pages divergentes selon
// l'entrée utilisée.
// `vue` : 'inspecteur_hotellerie' pour l'onglet Admin « Vue Inspecteur Hôtellerie » (voir
// App.jsx) — mêmes dossiers (périmètre appliqué côté serveur, Admin seulement), mêmes pastilles et
// filtres que ce rôle ; l'Admin garde ses actions et sa fiche complète.
export default function TableauDeBordAccueil({ vue = null }) {
  const { utilisateur, chargement: chargementSession } = useSession();
  // Actions groupées : chacune affichée seulement aux rôles que le serveur accepte
  // (aucun bouton menant à un 403) ; si aucune ne l'est (RH), la sélection multiple elle-même
  // disparaît (plus de cases à cocher menant à une barre vide).
  const peutExporterPiecesGroupe = peut(utilisateur, 'exportPiecesGroupe');
  const peutActionsGroupeesSuivi = peut(utilisateur, 'gestionRendezvous');
  const selectionMultipleDisponible = peutExporterPiecesGroupe || peutActionsGroupeesSuivi;
  // Inspecteur Hôtellerie : le serveur ne lui renvoie que les dossiers Hôtellerie de ses
  // 5 statuts (et ces seuls statuts) — pastilles réduites à ces statuts + « Tous », sans « À
  // planifier » ni pastilles de secteur ; aucune case à cocher (selectionMultipleDisponible faux).
  const estInspecteurHotellerie = utilisateur?.roleCode === ROLE_INSPECTEUR_HOTELLERIE || vue === ROLE_INSPECTEUR_HOTELLERIE;
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
  // Code postal : champ de filtre séparé (audit code postal), plus couvert par `recherche`
  // ci-dessus — même mécanisme useParametreURL que les autres filtres de cette page.
  const [codePostalFiltre, setCodePostalFiltre] = useParametreURL('codePostal', '');
  const [dateDebutFiltre, setDateDebutFiltre] = useParametreURL('date_debut', '');
  const [dateFinFiltre, setDateFinFiltre] = useParametreURL('date_fin', '');

  // Filtre "Entité" (Hôtellerie/Tertiaire) — même patron que Backoffice.jsx (recruteur) : deux
  // boutons indépendamment activables, jamais d'option "Toutes" dédiée (ferait doublon avec le
  // bouton "Tous" déjà porté par FiltresStatut ci-dessous), Set vide = aucune restriction.
  // Filtrage entièrement client (dossier.postesHotel/postesBureau déjà présents sur chaque
  // dossier renvoyé par GET /api/dossiers, voir filtrerDossiers.js), même mécanisme que
  // recherche/dateDebutFiltre/dateFinFiltre ci-dessus.
  const [entitesFiltre, basculerEntiteFiltre] = useEnsembleURL('entites');

  // Filtre "Expérience" — même mécanisme que le sélecteur "Poste" du tableau
  // de bord Indicateurs (Indicateurs.jsx) : un <select> simple, persistant dans l'URL comme les
  // autres filtres de cette page, filtrage entièrement client (dossier.experience déjà présent
  // sur chaque dossier renvoyé par GET /api/dossiers, voir dossierService.listerDossiers).
  // '' = toutes les tranches d'expérience confondues, jamais une valeur de code réelle.
  const [experienceFiltre, setExperienceFiltre] = useParametreURL('experience', '');

  // Filtre "Disponibilité des candidats prêts à l'embauche" (audit 2026-09-28 ; dispoFin RETIRÉ
  // le même jour, demande utilisateur explicite : "je pense qu'il faut qu'on puisse filtrer par
  // date de début de dispo uniquement" — un seul champ visible, mais côté back cette date sert de
  // comparaison PONCTUELLE des deux côtés (dateDebut ET dateFin du candidat, voir
  // dossierRepository.listerDossiers) : "qui est réellement disponible à cette date", pas "qui a
  // une disponibilité qui commence un jour peu importe quand". La date de fin déclarée/corrigée
  // d'un candidat reste visible par ailleurs, voir formaterDisponibiliteEffective/
  // sousBadgeStatutDisponibilite plus bas : ce n'est que le FILTRE qui n'en tient plus compte comme
  // borne distincte, rien n'a disparu de l'affichage) — persisté dans l'URL comme les autres
  // filtres de cette page. Filtrage SERVEUR (contrairement à recherche/statut/expérience/entité
  // ci-dessus, tous client) : demande utilisateur explicite — voir l'effet de chargement plus bas,
  // dont cette valeur fait désormais partie des dépendances.
  const [dispoDebut, setDispoDebut] = useParametreURL('dispo_debut', '');
  // Brouillon LOCAL du champ de date, distinct de la valeur ci-dessus effectivement appliquée
  // (persistée dans l'URL, qui déclenche le rechargement serveur) — "Appliquer"/"Effacer" (demande
  // utilisateur explicite, pas de filtrage au fil de la saisie comme les autres champs de cette
  // page) copient/vident ce brouillon vers la valeur appliquée. Initialisé depuis l'URL (pas '') :
  // un lien partagé/mis en favori avec ce filtre déjà actif doit afficher la date déjà saisie dans
  // le champ, pas un champ vide à côté d'une liste déjà filtrée.
  // Sans dispo_debut dans l'URL, préremplissage avec la date du jour (correctif interface
  // 2026-09-28) — brouillon SEULEMENT : le filtre n'est appliqué qu'au clic sur "Appliquer", la
  // liste reste complète à l'ouverture. dateDuJourParis (fuseau Europe/Paris, jamais UTC) : pas de
  // veille affichée entre minuit et 2 h.
  const [dispoDebutBrouillon, setDispoDebutBrouillon] = useState(() => dispoDebut || dateDuJourParis());
  const filtreDisponibiliteActif = Boolean(dispoDebut);

  const appliquerFiltreDisponibilite = () => {
    if (!dispoDebutBrouillon) return;
    setDispoDebut(dispoDebutBrouillon);
  };
  // "Effacer" retire le filtre appliqué et remet le champ à la date du jour (même état qu'à
  // l'ouverture de l'écran), pas à vide.
  const effacerFiltreDisponibilite = () => {
    setDispoDebutBrouillon(dateDuJourParis());
    setDispoDebut('');
  };

  // Fenêtre de correction de disponibilité — `dossierDispoAConfirmer` porte le
  // dossier COMPLET (pas seulement son id) : ModaleDisponibiliteEmbauche.jsx a besoin de
  // disponibiliteDeclaree/disponibiliteEffective pour son préremplissage/sa lecture seule, déjà
  // présents sur l'objet dossier (voir dossierService.listerDossiers), aucun second appel réseau.
  const [dossierDispoAConfirmer, setDossierDispoAConfirmer] = useState(null);
  const [dispoEnregistrementEnCours, setDispoEnregistrementEnCours] = useState(false);
  const [erreurDispo, setErreurDispo] = useState(null);

  const enregistrerCorrectionDisponibilite = async ({ dateDebut, dateFin, commentaire }) => {
    setDispoEnregistrementEnCours(true);
    setErreurDispo(null);
    try {
      await corrigerDisponibiliteEmbauche(dossierDispoAConfirmer.id, { dateDebut, dateFin, commentaire });
      setDossierDispoAConfirmer(null);
      // Re-fetch immédiat (pas d'attente du prochain rafraîchissement automatique) : l'agent doit
      // voir sa correction reflétée dans le bouton "Dispo : ..." sans délai — même filtre dispo
      // que la liste actuellement affichée, sinon le dossier corrigé disparaîtrait à tort si sa
      // nouvelle période ne chevauche plus plus la période filtrée (comportement attendu, mais
      // recalculé ici avec les VRAIES valeurs déjà appliquées, pas un simple retrait local).
      listerDossiers({ dispoDebut, vue })
        .then(setDossiers)
        .catch(() => {});
    } catch (erreur) {
      setErreurDispo(
        erreur.response?.data?.erreur ?? "Impossible d'enregistrer cette disponibilité. Merci de réessayer.",
      );
    } finally {
      setDispoEnregistrementEnCours(false);
    }
  };

  // Passée à DossierList (prop `sousBadgeStatut`, voir son commentaire d'en-tête) — bouton
  // "Dispo : ..." sous le badge "Validé - prêt à l'embauche", SEULEMENT quand le filtre est
  // réellement appliqué (demande utilisateur explicite point B3 : "Quand ce filtre est actif") et
  // seulement pour ce statut précis, jamais les autres (une disponibilité "corrigible" n'a de sens
  // que pour un dossier à ce statut, voir disponibiliteEmbaucheService.js côté back qui refuse
  // exactement la même chose). `dossier.disponibiliteEffective` toujours présent sur un dossier
  // valide_pret_embauche (voir dossierService.listerDossiers), jamais un second appel réseau ici.
  function sousBadgeStatutDisponibilite(dossier) {
    // TOUJOURS affiché pour tout dossier "Validé - prêt à l'embauche" (ajustement 2026-09-28,
    // demande utilisateur explicite point 2, CORRIGE la version précédente qui le masquait tant
    // que le filtre de période n'était pas appliqué — filtreDisponibiliteActif retiré de cette
    // condition, n'est plus utilisé QUE par le filtre lui-même désormais).
    if (dossier.statut_code !== 'valide_pret_embauche') return null;
    // "Dispo : non renseignée" (point 3) : même bouton cliquable qu'une disponibilité déjà
    // connue, pour permettre à l'agent de la SAISIR une première fois — formaterDisponibiliteEffective
    // gère déjà ce texte, voir son commentaire (nonRenseignee).
    const texte = formaterDisponibiliteEffective(dossier.disponibiliteEffective);
    const contenu = (
      <>
        {texte}
        {/* Mention discrète (demande utilisateur explicite point 4) — jamais dans le texte
            principal du bouton, pour ne pas alourdir la lecture rapide de "Dispo : ...". */}
        {dossier.disponibiliteEffective.corrigee && (
          <span className="tableau-bord-accueil__dispo-corrigee"> (corrigé)</span>
        )}
      </>
    );
    // Cliquable UNIQUEMENT pour les rôles autorisés à corriger (demande utilisateur explicite
    // point 5) — les autres (Formateur/Inspecteur) voient le même texte, même emplacement, en
    // simple lecture seule (un <span>, jamais un <button> : ni curseur pointer, ni onClick posé).
    if (!peut(utilisateur, 'modificationInscription')) {
      return <span className="tableau-bord-accueil__dispo-lecture-seule">{contenu}</span>;
    }
    return (
      <button type="button" onClick={() => setDossierDispoAConfirmer(dossier)}>
        {contenu}
      </button>
    );
  }

  useEffect(() => {
    listerStatuts({ vue })
      .then(setStatuts)
      .catch(() => {
        // Filtres non critiques : la liste des dossiers ci-dessous reste consultable même si
        // ce second appel échoue, donc pas de message d'erreur bloquant pour si peu.
      });
  }, []);

  // Tous statuts confondus (statutFiltre n'est plus un paramètre de requête, voir son commentaire
  // de déclaration) : le filtrage par statut se fait entièrement client, comme
  // recherche/dateDebutFiltre/dateFinFiltre/entitesFiltre ci-dessous — nécessaire pour calculer le
  // compteur de CHAQUE bouton de statut (dossiersFiltresSansStatut ci-dessous) à partir de la même
  // liste en mémoire, plutôt que de ne connaître que le statut actuellement sélectionné.
  //
  // dispoDebut en dépendance — SEUL filtre de cette page à recharger depuis le
  // serveur : ce chargement n'est donc plus "un seul", contrairement au commentaire historique
  // ci-dessus (conservé pour le reste, toujours vrai pour tous les AUTRES filtres) — se
  // redéclenche à chaque application/effacement du filtre "Disponibilité des candidats prêts à
  // l'embauche" (voir appliquerFiltreDisponibilite/effacerFiltreDisponibilite plus haut).
  useEffect(() => {
    let annule = false;
    setChargementDossiers(true);
    setErreur(null);
    listerDossiers({ dispoDebut, vue })
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
  }, [dispoDebut]);

  // Rafraîchissement automatique : silencieux (ne touche jamais
  // chargementDossiers/erreur ci-dessus, réservés au chargement initial) — un échec ponctuel de
  // ce re-fetch en arrière-plan n'a pas à afficher d'erreur, le prochain tick réessaiera.
  // dispoDebut transmis ici aussi : sinon, ce rafraîchissement périodique
  // silencieux écraserait la liste déjà filtrée côté serveur par la liste COMPLÈTE dès le
  // prochain tick, quelques secondes après avoir appliqué le filtre.
  useRafraichissementAuto(() => {
    listerDossiers({ dispoDebut, vue })
      .then(setDossiers)
      .catch(() => {});
  });

  // Recherche/dates uniquement (pas encore l'entité ni le statut) : base commune aux compteurs
  // "Hôtellerie"/"Tertiaire" ci-dessous, qui doivent chacun ignorer l'état courant du filtre
  // entité (Set) pour répondre à la question "combien de dossiers dans CETTE entité si je clique
  // ce bouton", indépendamment de l'autre bouton entité déjà actif ou non.
  const dossiersRechercheDate = useMemo(
    () =>
      filtrerDossiers(dossiers, {
        recherche,
        codePostalFiltre,
        dateDebutFiltre,
        dateFinFiltre,
        libellePoste,
        entitesFiltre: new Set(),
      }),
    [dossiers, recherche, codePostalFiltre, dateDebutFiltre, dateFinFiltre],
  );

  // Recherche/dates/entité (ni statut ni expérience) : base commune aux DEUX familles de
  // compteurs ci-dessous (statut et expérience, chacune devant ignorer SON PROPRE filtre pour
  // répondre à "combien de dossiers si je clique CE bouton", tout en tenant compte de l'AUTRE
  // filtre déjà actif) — même principe que dossiersRechercheDate ci-dessus pour Hôtellerie/
  // Tertiaire, généralisé aux deux filtres à badges de cette page.
  const dossiersFiltresBase = useMemo(
    () =>
      filtrerDossiers(dossiers, {
        recherche,
        codePostalFiltre,
        dateDebutFiltre,
        dateFinFiltre,
        libellePoste,
        entitesFiltre,
      }),
    [dossiers, recherche, codePostalFiltre, dateDebutFiltre, dateFinFiltre, entitesFiltre],
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
  //
  // Masquage par défaut des dossiers "Embauché" — statut
  // TERMINAL (workflow.config.json, estFinal: true), plus rien à traiter pour l'accueil une fois
  // ce point atteint : n'a plus sa place dans la liste de travail quotidienne, "Tous" y compris,
  // sauf quand l'agent le demande EXPLICITEMENT en cliquant le badge "Embauché" lui-même
  // (statutFiltre === 'embauche' ci-dessous). Ajoutée ICI, tout en bas de la chaîne de dérivation
  // (après recherche/dates/entité/statut/expérience, déjà appliqués en amont dans
  // dossiersFiltresSansExperience/experienceFiltre) — pas plus haut (dossiersFiltresBase/
  // dossiersFiltresSansStatut) : ces deux-là alimentent aussi les COMPTEURS (Tous, badges de statut,
  // Hôtellerie/Tertiaire, Expérience), qui doivent tous rester des décomptes réels de la base,
  // inchangés — seul l'AFFICHAGE des lignes du tableau (et donc dossierIdsVisibles/la sélection
  // multiple qui en dépend juste en dessous) est concerné, jamais un chiffre affiché sur un badge.
  // Se combine donc automatiquement, en ET, avec absolument tous les autres filtres déjà actifs
  // (recherche/code postal/dates/entité/expérience/statut) : simple condition supplémentaire sur la
  // toute dernière liste dérivée, sans dépendre de leur état.
  const dossiersFiltres = useMemo(
    () =>
      dossiersFiltresSansExperience.filter(
        (dossier) =>
          (!experienceFiltre || dossier.experience === experienceFiltre) &&
          (statutFiltre === 'embauche' || dossier.statut_code !== 'embauche'),
      ),
    [dossiersFiltresSansExperience, experienceFiltre, statutFiltre],
  );

  // Sélection multiple + actions groupées — même patron que Planification.jsx
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
  // STATUTS_REPLANIFIABLES ci-dessus.
  const dossiersEligiblesReplanification = useMemo(
    () => dossiersSelectionnesObjets.filter((dossier) => STATUTS_REPLANIFIABLES.includes(dossier.statut_code)),
    [dossiersSelectionnesObjets],
  );
  const dossiersExclusReplanification = useMemo(
    () => dossiersSelectionnesObjets.filter((dossier) => !STATUTS_REPLANIFIABLES.includes(dossier.statut_code)),
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
    // "À planifier" : même principe, somme des 3 statuts
    // déjà comptés individuellement ci-dessus (nouveau/en_attente_pieces/test_non_planifie),
    // chacun gardant par ailleurs son propre compteur pour son propre bouton.
    compte[CODE_A_PLANIFIER] = CODES_STATUTS_A_PLANIFIER_ACCECIT.reduce((somme, code) => somme + (compte[code] ?? 0), 0);
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

  // "À planifier" inséré juste après "En attente de pièces" (audit 2026-09-27, demande
  // utilisateur — déplacé de la tête de liste, où il vivait depuis son ajout, audit 2026-09-14) :
  // entrée construite à la main, pas via CODES_STATUTS_FILTRES_ACCUEIL (voir le commentaire de
  // CODE_A_PLANIFIER plus haut — ce code n'existe dans aucun `statuts` renvoyé par le back, rien à
  // filtrer depuis ce tableau pour lui). S'ajoute aux 3 statuts qu'il regroupe, ne les remplace
  // pas : Inscrit/En attente de pièces/Test non planifié restent chacun leur propre bouton,
  // inchangés. `indexApresEnAttentePieces` : position d'insertion dans `filtres` (déjà trié par
  // `ordre` côté back, voir CODES_STATUTS_FILTRES_ACCUEIL) plutôt qu'un index fixe — repli en tête
  // de liste (comportement d'avant ce correctif) si 'en_attente_pieces' n'apparaît pas dans
  // `statuts` (cas limite, jamais rencontré en pratique).
  const statutsFiltres = useMemo(() => {
    const filtres = statuts.filter((statut) => CODES_STATUTS_FILTRES_ACCUEIL.includes(statut.code));
    if (estInspecteurHotellerie) return filtres;
    const entreeAPlanifier = { code: CODE_A_PLANIFIER, libelle: 'À planifier' };
    const indexApresEnAttentePieces = filtres.findIndex((statut) => statut.code === 'en_attente_pieces') + 1;
    if (indexApresEnAttentePieces === 0) {
      return [entreeAPlanifier, ...filtres];
    }
    return [...filtres.slice(0, indexApresEnAttentePieces), entreeAPlanifier, ...filtres.slice(indexApresEnAttentePieces)];
  }, [statuts, estInspecteurHotellerie]);

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
          <h1>{vue === ROLE_INSPECTEUR_HOTELLERIE ? 'Dossiers candidats - Inspecteur' : 'Dossiers candidats'}</h1>
          {/* Bouton "Planification des tests" retiré (refonte navigation, 2026-08-17) : couvert
              par le lien "Suivi des tests" de la barre de navigation commune, voir
              BarreNavigation.jsx (montée dans PageBackOffice.jsx). */}
          <EnTeteBackOffice />
        </header>

        {/* Statut + entité Hôtellerie/Tertiaire en haut (demande utilisateur) — ce sont les deux
            filtres consultés en premier à l'accueil (état du dossier, secteur du candidat), le
            reste (recherche nom/prénom, dates, expérience) suit juste en dessous, toujours
            visible (plus de bouton "Plus de filtres" pour le masquer, retiré le 2026-09-11). */}
        <FiltresStatut
          statuts={statutsFiltres}
          statutFiltre={statutFiltre}
          onChangerStatutFiltre={setStatutFiltre}
          compteurTous={dossiersFiltresSansStatut.length}
          compteurs={compteursParStatut}
          filtresSupplementaires={
            estInspecteurHotellerie ? undefined : (
            <FiltreEntite
              entitesFiltre={entitesFiltre}
              onBasculerEntite={basculerEntiteFiltre}
              compteurHotel={compteurHotel}
              compteurBureau={compteurBureau}
            />
            )
          }
        />

        {/* Recherche/dates/expérience — plus de bouton "Plus de filtres" pour les masquer (retiré
            le 2026-09-11, décision utilisateur : composant PanneauFiltresRepliable.jsx supprimé,
            ce bloc reste désormais visible en permanence sur les 3 écrans qui le portaient,
            Dossiers candidats/Suivi des tests/Suivi des formations). */}
        <FiltresRechercheDossiers
          recherche={recherche}
          onChangerRecherche={setRecherche}
          codePostalFiltre={codePostalFiltre}
          onChangerCodePostalFiltre={setCodePostalFiltre}
          dateDebutFiltre={dateDebutFiltre}
          onChangerDateDebutFiltre={setDateDebutFiltre}
          dateFinFiltre={dateFinFiltre}
          onChangerDateFinFiltre={setDateFinFiltre}
        />
        {/* Expérience + Disponibilité des candidats prêts à l'embauche, sur la même ligne (audit
            2026-09-28, demande utilisateur explicite : "réduis sa largeur à son contenu. À sa
            droite, sur la même ligne, un nouveau bloc") — Expérience réduite à son contenu
            (voir TableauDeBordAccueil.css), le second bloc prend le reste de la largeur. */}
        <div className="tableau-bord-accueil__ligne-experience-disponibilite">
          {/* Filtre "Expérience" (audit 2026-09-02, refonte visuelle) — badges cliquables, même
              disposition/composant visuel que la boîte de badges de statut (.filtres-statut__statuts,
              réutilisée telle quelle plutôt que dupliquée) : boîte ivoire, boutons pilule, compteur
              entre parenthèses. Comportement de sélection DÉLIBÉRÉMENT différent de FiltresStatut.jsx
              (pas de bouton "Tous" séparé) : cliquer le badge déjà actif le désactive (retour à
              experienceFiltre === ''), alors qu'un bouton de statut ne se désactive que via "Tous" —
              demande explicite, cohérente avec l'absence d'équivalent "Tous" pour ce filtre à 4
              valeurs seulement. data-experience (comme data-statut) : accroche de couleur par
              valeur, voir TableauDeBordAccueil.css. */}
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
            {/* Badges regroupés dans leur propre bloc flex — le titre reste
                calé sur le bord gauche du cadre (premier item, largeur naturelle), tandis que ce
                bloc prend le reste de la largeur (flex: 1) et centre les 4 badges en son sein, voir
                TableauDeBordAccueil.css. */}
            <div className="tableau-bord-accueil__filtres-experience-badges">
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
          </div>

          {/* Filtre "Disponibilité des candidats prêts à l'embauche" — une
              seule date ("À partir de", ex-"Du") + Appliquer/Effacer, dans le même style que les autres filtres de
              cette page (boîte ivoire, voir TableauDeBordAccueil.css). Champ "Au" RETIRÉ le même
              jour (demande utilisateur explicite, pour que la boîte tienne dans sa cellule en
              prod). Côté back, cette date sert de comparaison PONCTUELLE des deux côtés — dateDebut
              ET dateFin du candidat (voir dossierRepository.listerDossiers) : "qui est réellement
              disponible à cette date", jamais "qui a une disponibilité qui commence un jour peu
              importe quand" (un candidat dont la disponibilité commence après cette date
              n'apparaît pas). La date de fin déclarée/corrigée d'un candidat reste affichée par
              ailleurs (voir formaterDisponibiliteEffective/sousBadgeStatutDisponibilite plus bas),
              ce filtre n'en tient simplement plus compte comme borne DISTINCTE, il compare
              désormais les deux dates du candidat à cette même date filtrée. Filtrage SERVEUR (voir
              l'effet de chargement plus haut) : `filtreDisponibiliteActif` ne pilote plus que CE
              filtre (date/requête serveur) — le bouton "Dispo : ..." sous le badge "Validé - prêt
              à l'embauche" (sousBadgeStatutDisponibilite plus bas), lui, s'affiche désormais pour
              TOUT dossier à ce statut, que ce filtre soit actif ou non (ajustement 2026-09-28,
              demande utilisateur explicite : "que le filtre de période soit actif ou non"). */}
          <div
            className="filtres-statut__statuts tableau-bord-accueil__filtre-disponibilite-embauche"
            role="group"
            aria-label="Filtrer par disponibilité des candidats prêts à l'embauche"
          >
            {/* Libellé raccourci (ajustement 2026-09-28, demande utilisateur explicite : le texte
                complet touchait le bloc "Expérience" voisin) — aria-label du groupe ci-dessus
                garde le texte complet et descriptif, seul le libellé VISIBLE est raccourci.
                De nouveau sur UNE seule ligne (correctif interface 2026-09-28, remplace le <br />
                de l'ajustement précédent) : white-space: nowrap côté CSS ; sur écran étroit, c'est
                le bloc des champs qui passe sous le titre, jamais le titre qui se coupe. */}
            <span className="tableau-bord-accueil__filtre-disponibilite-embauche-titre">
              Disponibilité (prêts à l&apos;embauche)
            </span>
            <div className="tableau-bord-accueil__filtre-disponibilite-embauche-champs">
              <label htmlFor="dispo-embauche-debut">
                À partir de
                <input
                  id="dispo-embauche-debut"
                  type="date"
                  value={dispoDebutBrouillon}
                  onChange={(evenement) => setDispoDebutBrouillon(evenement.target.value)}
                />
              </label>
              <button type="button" onClick={appliquerFiltreDisponibilite} disabled={!dispoDebutBrouillon}>
                Appliquer
              </button>
              {/* Désactivé quand il n'y a rien à effacer : aucun filtre appliqué ET champ déjà à
                  la date du jour (préremplissage, correctif interface 2026-09-28 — le champ n'est
                  plus jamais vide à l'ouverture). Historique :
                  désactivé tant qu'aucune date n'est saisie NULLE PART (demande utilisateur
                  explicite, ajustement de mise en page 2026-09-28) — ni dans le brouillon en
                  cours de saisie, ni dans le filtre déjà appliqué : auparavant conditionné au
                  seul filtre appliqué (filtreDisponibiliteActif), ce qui laissait "Effacer"
                  cliquable-mais-inutile alors qu'aucune date n'était encore saisie, et
                  inversement ne permettait pas de vider un brouillon non encore appliqué. */}
              <button
                type="button"
                onClick={effacerFiltreDisponibilite}
                disabled={dispoDebutBrouillon === dateDuJourParis() && !filtreDisponibiliteActif}
              >
                Effacer
              </button>
            </div>
          </div>
        </div>

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
            {/* Masqué aux rôles que le serveur refuse (2026-09-30 : RH notamment, voir
                exportPiecesGroupe, miroir de dossiers.routes.js) — aucun bouton menant
                à un 403. */}
            {peutExporterPiecesGroupe && (
              <button
                type="button"
                className="tableau-bord-accueil__bouton-action-groupee"
                onClick={lancerExportPieces}
                disabled={verificationExportEnCours}
              >
                {verificationExportEnCours ? 'Vérification…' : 'Export des pièces'}
              </button>
            )}
            {/* « Relances » / « Replanifier des tests » : écritures réservées côté serveur à
                Accueil/Coordination, Planning et Admin (gestionRendezvous). */}
            {peutActionsGroupeesSuivi && (
              <>
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
              </>
            )}
            {/* "Effacer la sélection" — même libellé que le bouton déjà en place
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
            infoBulleStatut={infoBulleStatut}
            sousBadgeStatut={sousBadgeStatutDisponibilite}
            // Sans action groupée disponible pour ce rôle (RH) : pas de colonne de sélection
            // (DossierList n'affiche les cases que si dossiersSelectionnes est fourni).
            dossiersSelectionnes={selectionMultipleDisponible ? dossiersSelectionnes : undefined}
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
                // ce bouton y est seul. `alignerADroite` retiré : poussait le
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

      {dossierDispoAConfirmer && (
        <ModaleDisponibiliteEmbauche
          dossier={dossierDispoAConfirmer}
          enCours={dispoEnregistrementEnCours}
          erreur={erreurDispo}
          onAnnuler={() => {
            setDossierDispoAConfirmer(null);
            setErreurDispo(null);
          }}
          onConfirmer={enregistrerCorrectionDisponibilite}
        />
      )}
    </PageBackOffice>
  );
}
