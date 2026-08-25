import { useEffect, useRef, useState } from 'react';
import { listerFormateurs } from '../../services/formateurService';
import { listerLieux, creerLieu, modifierLieu, listerRendezvousAssociesLieu, supprimerLieu } from '../../services/lieuService';
import { creerRendezvousAvecTransitions, listerRendezvousTest, listerRendezvous } from '../../services/rendezvousService';
import CalendrierHebdomadaireDisponibilite from './CalendrierHebdomadaireDisponibilite';
import { dateDuJourParis } from './dateDuJourParis';
import { trouverLieuSimilaire } from './detectionLieuSimilaire';
import './ModalePlanificationTest.css';

const FORMAT_DATE_HEURE = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

// L'input natif type="datetime-local" s'est révélé peu fiable au tactile pour sa partie
// heure/minute (segment difficile à cibler précisément) — remplacé par un input type="date"
// combiné à deux <select> classiques pour l'heure et les minutes : un select est un composant
// natif que l'agent peut ouvrir et faire défiler au doigt. Minutes par pas de 15 : granularité
// suffisante pour planifier un test, une liste des 60 valeurs serait inutilement longue à faire
// défiler sur tablette.
const HEURES_DISPONIBLES = Array.from({ length: 24 }, (_, heure) => String(heure).padStart(2, '0'));
const MINUTES_DISPONIBLES = ['00', '15', '30', '45'];

// Alignée sur CAPACITE_MAX_FORMATEUR_PAR_CRENEAU côté back (rendezvousService.js) : un formateur
// peut évaluer jusqu'à 2 candidats sur le même créneau exact, pas seulement 1.
const CAPACITE_MAX_FORMATEUR_PAR_CRENEAU = 2;

// Groupes du sélecteur de personne — mêmes codes que backend rbac.js (ROLES.FORMATEUR/
// ROLES.INSPECTEUR), littéraux en dur plutôt qu'une constante partagée (le projet n'exporte
// aujourd'hui aucun équivalent front de ROLES, même choix déjà fait par Connexion.jsx/
// BoutonNouvelleInscription.jsx pour leurs propres comparaisons de rôle).
const GROUPES_ROLE = [
  { code: 'formateur', libelle: 'Formateurs' },
  { code: 'inspecteur', libelle: 'Inspecteurs' },
];

// Panneau de planification d'un test : choix de la date/heure et du formateur, puis (1) création
// du rendez-vous, (2) avancement du statut du dossier via le moteur de transitions générique —
// une seule transaction côté back (voir rendezvousService.creerRendezvousAvecTransitions), pour
// que la création du rendez-vous et le changement de statut réussissent ou échouent ensemble
// (plus de rendez-vous "orphelin" possible, voir l'incident historique sur le dossier 62).
//
// Composant générique, extrait de CaptureTablette.jsx (première planification, depuis
// en_attente_pieces) pour être réutilisé par TableauDeBordAccueil.jsx (replanification, depuis
// test_non_realise ou invalide) : `codeAction` est reçu en prop plutôt que figé en
// constante interne — ce composant ne connaît aucun statut ni transition en dur (voir
// Modularité, CLAUDE.md), c'est à l'appelant de savoir depuis quelle action il ouvre ce panneau.
// Le moteur de transitions (workflowEngine.appliquerTransition) résout lui-même la bonne ligne
// transitions_statut à partir du statut courant réel du dossier : pas besoin ici de choisir entre
// plusieurs origines possibles pour un même codeAction (ex. "replanifier_test" existe en
// configuration à la fois depuis test_non_realise et invalide).
// postesBureau/postesHotel (Phase 1, informatif — voir evaluationEngine.resoudrePosteCode) : les
// postes déclarés au dossier (dossierService.obtenirDossier / listerDossiers), reçus en prop
// plutôt que résolus ici — ce composant ne fait aucun appel réseau pour les récupérer, comme
// dossierId/titre déjà transmis par l'appelant. libellePoste : même principe que le prop
// `varianteStatut` de DossierList.jsx — vocabulaire propre à ACCECIT (voir BlocDisponibilites.jsx),
// ce composant générique affiche le code brut si non fourni plutôt que d'échouer.
export default function ModalePlanificationTest({
  dossierId,
  codeAction,
  titre,
  postesBureau = [],
  postesHotel = [],
  libellePoste,
  onAnnuler,
  onReussite,
}) {
  const panneauRef = useRef(null);

  const [formateurs, setFormateurs] = useState([]);
  const [chargementFormateurs, setChargementFormateurs] = useState(true);
  const [erreurFormateurs, setErreurFormateurs] = useState(null);

  // Lieux de test configurés pour l'entité (table `lieux`, migration 044) — contrairement au
  // formateur, optionnel : un échec de chargement ou une liste vide ne doit pas empêcher de
  // planifier un test (voir plus bas, le formulaire entier n'est pas gated sur chargementLieux,
  // contrairement à chargementFormateurs).
  const [lieux, setLieux] = useState([]);
  const [chargementLieux, setChargementLieux] = useState(true);
  const [erreurLieux, setErreurLieux] = useState(null);
  const [lieuId, setLieuId] = useState('');

  // Création ET modification de lieu à la volée (boutons "+"/crayon à côté du sélecteur, voir plus
  // bas) — un seul formulaire inline partagé entre les deux (même champ, mêmes actions), pas deux
  // panneaux séparés : `panneauLieuMode` distingue 'creation' de 'edition' (null = fermé), plutôt
  // que deux booléens indépendants qui pourraient en théorie être vrais tous les deux à la fois.
  // `lieuIdEnEdition` retient QUEL lieu est modifié en mode 'edition' — distinct de `lieuId`
  // (celui sélectionné pour le rendez-vous en cours) : l'agent peut ouvrir l'édition du lieu
  // actuellement sélectionné, mais rien n'empêche que la modale évolue un jour vers l'édition d'un
  // lieu non sélectionné (ex. depuis un futur écran d'admin) sans que ce state ait à changer de
  // forme. Réinitialisés à la fermeture (annulation ou succès), jamais laissés ouverts avec un
  // champ résiduel.
  const [panneauLieuMode, setPanneauLieuMode] = useState(null);
  const [lieuIdEnEdition, setLieuIdEnEdition] = useState(null);
  // Trois champs structurés depuis la migration 047 (remplace l'ancien champ unique `lieuFormLibelle`
  // texte libre, voir audit du 2026-08-13) : `lieuFormAdresse` obligatoire, `lieuFormMetroAcces`/
  // `lieuFormInstructions` optionnels — mêmes trois champs que la table `lieux` côté back.
  const [lieuFormAdresse, setLieuFormAdresse] = useState('');
  const [lieuFormMetroAcces, setLieuFormMetroAcces] = useState('');
  const [lieuFormInstructions, setLieuFormInstructions] = useState('');
  const [lieuFormEnCours, setLieuFormEnCours] = useState(false);
  const [lieuFormErreur, setLieuFormErreur] = useState(null);
  // Avertissement anti-doublon (voir soumettreLieu plus bas) — uniquement en création, jamais en
  // édition (modifier un lieu existant n'a pas de raison de se comparer à lui-même) : le lieu
  // existant détecté comme similaire, ou null tant qu'aucune tentative de création ne l'a
  // déclenché. Jamais un blocage (voir detectionLieuSimilaire.js) : juste de quoi proposer
  // "Utiliser ce lieu" / "Créer quand même" à l'agent avant l'appel réseau réel.
  const [lieuSimilaireDetecte, setLieuSimilaireDetecte] = useState(null);

  const fermerPanneauLieu = () => {
    setPanneauLieuMode(null);
    setLieuIdEnEdition(null);
    setLieuFormAdresse('');
    setLieuFormMetroAcces('');
    setLieuFormInstructions('');
    setLieuFormErreur(null);
    setLieuSimilaireDetecte(null);
  };

  // Suppression de lieu (bouton poubelle, voir plus bas) — panneau distinct de celui de création/
  // édition ci-dessus (fermé indépendamment, voir cliquerSupprimerLieu) : la suppression a sa
  // propre étape intermédiaire de chargement (GET des rendez-vous associés) avant même de savoir
  // quelle UI afficher, contrairement à création/édition qui s'ouvrent immédiatement sur le même
  // formulaire — les regrouper dans panneauLieuMode aurait forcé un état "ouvert mais en attente
  // de savoir quoi montrer" que ce mode ne connaît pas aujourd'hui.
  const [panneauSuppressionOuvert, setPanneauSuppressionOuvert] = useState(false);
  const [rendezvousAssocies, setRendezvousAssocies] = useState([]);
  const [chargementRendezvousAssocies, setChargementRendezvousAssocies] = useState(false);
  const [lieuDestinationMigrationId, setLieuDestinationMigrationId] = useState('');
  const [suppressionEnCours, setSuppressionEnCours] = useState(false);
  const [erreurSuppressionLieu, setErreurSuppressionLieu] = useState(null);

  const fermerPanneauSuppression = () => {
    setPanneauSuppressionOuvert(false);
    setRendezvousAssocies([]);
    setLieuDestinationMigrationId('');
    setErreurSuppressionLieu(null);
  };

  // Appel réel de suppression — partagé par les deux chemins (confirmation simple, confirmation
  // de migration, voir plus bas) : `lieuDestinationId` absent pour le premier, fourni pour le
  // second. Le back (lieuService.supprimerLieu) revérifie de toute façon les rendez-vous associés
  // au moment de l'appel plutôt que de faire confiance à ce qu'on lui montre ici (un rendez-vous a
  // pu être créé entre-temps) — cet appel peut donc échouer même après un GET préalable rassurant,
  // voir erreurSuppressionLieu.
  const executerSuppressionLieu = async (lieuASupprimerId, lieuDestinationId) => {
    setSuppressionEnCours(true);
    setErreurSuppressionLieu(null);
    try {
      await supprimerLieu(lieuASupprimerId, lieuDestinationId ? { lieuDestinationId } : undefined);
      setLieux((precedent) => precedent.filter((l) => l.id !== lieuASupprimerId));
      // Le lieu supprimé était sélectionné pour ce rendez-vous : bascule sur le lieu de
      // destination s'il y en a un (continuité — c'est littéralement le même lieu physique),
      // sinon revient à "-" plutôt que de garder un id qui ne correspond plus à rien dans le
      // sélecteur.
      if (String(lieuASupprimerId) === lieuId) {
        setLieuId(lieuDestinationId ? String(lieuDestinationId) : '');
      }
      fermerPanneauSuppression();
    } catch (erreur) {
      setErreurSuppressionLieu(
        erreur.response?.data?.erreur ?? "Le serveur n'a pas pu supprimer ce lieu. Merci de réessayer.",
      );
    } finally {
      setSuppressionEnCours(false);
    }
  };

  // Clic sur le bouton poubelle — vérifie d'abord s'il existe des rendez-vous associés (GET,
  // lecture seule, pas de confirmation nécessaire pour ce seul appel) avant de décider entre
  // confirmation native simple (window.confirm, même patron que CaptureTablette.jsx pour la
  // suppression d'une pièce justificative) et panneau de migration : impossible de savoir laquelle
  // des deux UI proposer sans connaître d'abord ce compte.
  const cliquerSupprimerLieu = async () => {
    if (!lieuSelectionne || chargementRendezvousAssocies) return;
    fermerPanneauLieu(); // un seul panneau lieu ouvert à la fois (création/édition vs suppression)
    setChargementRendezvousAssocies(true);
    setErreurSuppressionLieu(null);
    try {
      const associes = await listerRendezvousAssociesLieu(lieuSelectionne.id);
      if (associes.length === 0) {
        const confirme = window.confirm(
          `Supprimer définitivement le lieu « ${lieuSelectionne.adresse} » ? Cette action est irréversible.`,
        );
        if (confirme) await executerSuppressionLieu(lieuSelectionne.id);
      } else {
        setRendezvousAssocies(associes);
        setPanneauSuppressionOuvert(true);
      }
    } catch (erreur) {
      setErreurSuppressionLieu(
        erreur.response?.data?.erreur ?? "Impossible de vérifier les rendez-vous associés à ce lieu. Merci de réessayer.",
      );
    } finally {
      setChargementRendezvousAssocies(false);
    }
  };

  const confirmerMigrationEtSuppression = () => {
    if (!lieuDestinationMigrationId || suppressionEnCours) return;
    executerSuppressionLieu(lieuSelectionne.id, Number(lieuDestinationMigrationId));
  };

  // Ce panneau s'ouvre en bas de page (sous la liste de pièces ou la liste de dossiers selon
  // l'appelant, voir ModalePlanificationTest.css) : sans amener la vue jusqu'à lui, l'agent ne le
  // voit pas apparaître et doit défiler manuellement pour s'en apercevoir. `block: 'start'` cale
  // le haut du panneau (son titre) en haut de viewport plutôt que 'nearest'/'center', pour
  // toujours afficher l'en-tête même quand le panneau est plus haut que l'écran (tablette en
  // portrait) — cohérent quel que soit l'appelant, puisque géré ici une seule fois plutôt que
  // dupliqué dans CaptureTablette.jsx et TableauDeBordAccueil.jsx.
  //
  // Dépend de [dossierId, codeAction] plutôt que [] : sur TableauDeBordAccueil.jsx, le panneau
  // n'est pas démonté/remonté entre deux ouvertures si l'agent clique "Replanifier" sur un autre
  // dossier sans avoir fermé le panneau précédent (même position dans l'arbre React, seules les
  // props changent) — un tableau de dépendances vide ne réexécuterait alors le scroll qu'à la
  // toute première ouverture. En dépendant de l'identité de ce qui est planifié, l'effet se
  // redéclenche à chaque nouvelle cible, y compris sans démontage.
  //
  // `chargementFormateurs` est aussi une dépendance, et l'effet ne scrolle pas tant qu'il vaut
  // encore true : à l'ouverture initiale (avant que GET /formateurs ait répondu), le panneau
  // n'affiche que "Chargement des formateurs…", bien plus court qu'une fois le calendrier de
  // disponibilité affiché — scroller sur cette hauteur provisoire atterrit trop haut dans le
  // document (donc, une fois le panneau grandi, le titre se retrouve au-dessus du viewport et
  // l'agent voit le calendrier en premier). En attendant la fin du chargement, l'effet scrolle
  // sur la hauteur finale réelle du panneau. Lors d'un changement de dossier alors que les
  // formateurs sont déjà en cache (chargementFormateurs déjà à false, cas normal après la toute
  // première ouverture sur cette page), l'effet scrolle immédiatement comme avant.
  useEffect(() => {
    if (chargementFormateurs) return;
    panneauRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [dossierId, codeAction, chargementFormateurs]);

  const [dateTest, setDateTest] = useState('');
  const [heureTest, setHeureTest] = useState('');
  const [minuteTest, setMinuteTest] = useState('');
  // Secteur du dossier (Hôtellerie vs Tertiaire/Bureau) — dérivé des postes déclarés (postesBureau
  // et postesHotel ne sont jamais tous deux peuplés sur un même dossier, voir postesDisponibles
  // plus bas) : détermine si un seul des deux onglets Formateurs/Inspecteurs a un sens ici (audit
  // 2026-08-25, demande utilisateur — éviter qu'un agent assigne par erreur un Inspecteur à un
  // test hôtel ou un Formateur à un test bureau, jusqu'ici une simple discipline procédurale, voir
  // aussi le garde-fou correspondant côté back, rendezvousService.creerRendezvous). `null` si le
  // dossier n'a déclaré aucun poste (cas déjà rencontré, dossiers sans poste) : les deux onglets
  // restent alors visibles, comportement inchangé plutôt que de bloquer la planification.
  const secteurDossier = postesBureau.length > 0 ? 'bureau' : postesHotel.length > 0 ? 'hotel' : null;
  // Seul groupe pertinent quand le secteur est déterminé — jamais recalculé indépendamment de
  // secteurDossier ci-dessus, pour ne jamais risquer de diverger entre la présélection et le
  // filtrage des onglets affichés plus bas (GROUPES_ROLE.filter).
  const groupeImposeParSecteur = secteurDossier === 'bureau' ? 'inspecteur' : secteurDossier === 'hotel' ? 'formateur' : null;

  // Groupe affiché avant le choix de la personne précise (voir GROUPES_ROLE ci-dessus) —
  // présélectionné selon le secteur du dossier ci-dessus (Inspecteurs pour un dossier bureau,
  // Formateurs pour un dossier hôtel ou par défaut si le secteur est indéterminé) plutôt que
  // toujours le même groupe : évite à l'agent de devoir cliquer "Inspecteurs" à chaque
  // planification d'un test bureau.
  const [groupeRole, setGroupeRole] = useState(() => groupeImposeParSecteur ?? 'formateur');
  const [formateurId, setFormateurId] = useState('');
  // Note libre optionnelle pour le formateur/inspecteur assigné (migration 049) — distincte des
  // notes générales du dossier (bloc "Notes" de la fiche candidat, NotesDossier.jsx) : propre à
  // CE rendez-vous, envoyée dans l'email de convocation formateur/inspecteur uniquement (jamais
  // au candidat, voir invitationTestService.js), remplacée à chaque nouvelle
  // planification/replanification comme postesCoches ci-dessus — pas d'édition ultérieure hors
  // replanification, cohérent avec le reste de ce formulaire (aucun champ ici n'est modifiable
  // après coup en dehors d'une nouvelle ouverture de ce panneau).
  const [notePlanification, setNotePlanification] = useState('');
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [erreurEnvoi, setErreurEnvoi] = useState(null);

  // Créneaux du formateur sélectionné, pour le seul jour choisi (voir calendrier mensuel plus
  // bas pour la vue d'ensemble par mois) — sert uniquement au message d'alerte + désactivation du
  // bouton ci-dessous. Confort visuel seulement : compterRendezvousFormateurAuCreneau côté
  // serveur reste le garde-fou qui fait foi (409 ErreurCreneauPris à la création).
  const [creneauxJourSelectionne, setCreneauxJourSelectionne] = useState([]);

  // Postes déclarés du dossier, à plat (posteBureau et posteHotel ne sont jamais tous les deux
  // peuplés sur un même dossier, voir dossierService.js : typePoste est soit 'bureau' soit
  // 'hotel') — recalculé à chaque rendu plutôt que mémoïsé, tableau trop court pour que ça compte.
  const postesDisponibles = [...postesBureau, ...postesHotel];

  // Tous pré-cochés à l'ouverture (comportement demandé) — Set plutôt qu'un tableau, pratique
  // pour cocher/décocher sans reconstruire toute la liste à chaque clic.
  const [postesCoches, setPostesCoches] = useState(() => new Set(postesDisponibles));

  // Réinitialise la sélection quand le dossier change (voir l'effet de scroll ci-dessus pour la
  // même raison : sur TableauDeBordAccueil.jsx, ce panneau n'est pas démonté/remonté entre deux
  // ouvertures sur des dossiers différents, il faut donc un effet plutôt qu'un état initial calculé
  // une seule fois). Clé sur les codes eux-mêmes (JSON.stringify), pas seulement dossierId : couvre
  // aussi le cas où la liste de postes déclarés changerait pour un même dossier entre deux ouvertures.
  useEffect(() => {
    setPostesCoches(new Set(postesDisponibles));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dossierId, JSON.stringify(postesDisponibles)]);

  // Même raison que l'effet ci-dessus (pas de démontage entre deux dossiers sur
  // TableauDeBordAccueil) : re-présélectionne le bon groupe (Inspecteurs/Formateurs) si l'agent
  // ouvre ce panneau pour un autre dossier sans l'avoir fermé — groupeImposeParSecteur recalculé
  // à chaque rendu à partir des props courantes (voir sa déclaration plus haut), jamais divergent
  // de la valeur utilisée par le filtrage des onglets plus bas.
  useEffect(() => {
    setGroupeRole(groupeImposeParSecteur ?? 'formateur');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dossierId, groupeImposeParSecteur]);

  // Vide d'abord la note (même raison que les deux effets ci-dessus : une note tapée pour un
  // premier candidat ne doit jamais rester affichée, ni a fortiori être pré-remplie, pour un
  // second dossier ouvert sans fermer ce panneau) — puis reprend celle du rendez-vous de test
  // actuellement actif pour CE dossier, s'il en existe un (replanification : ce rendez-vous est
  // celui que la nouvelle planification va remplacer, voir rendezvousRepository.
  // neutraliserRendezvousActifsDossier côté back). Reste vide si aucun rendez-vous de test actif
  // n'existe (planification initiale, comportement inchangé).
  //
  // Ne teste PAS `codeAction` (jamais 'planifier_test'/'replanifier_test' en dur ici, voir
  // Modularité CLAUDE.md) : ce composant ne sait pas pour quelle action il a été ouvert, il se
  // contente de chercher s'il existe déjà un rendez-vous à remplacer et d'en reprendre la note —
  // même résultat, sans connaître le vocabulaire de transitions d'ACCECIT.
  useEffect(() => {
    let annule = false;
    setNotePlanification('');
    listerRendezvous(dossierId)
      .then((rendezvousDuDossier) => {
        if (annule) return;
        const rendezvousActif = rendezvousDuDossier.find(
          (rdv) => rdv.type_rdv === 'test' && ['prevu', 'confirme'].includes(rdv.statut),
        );
        if (rendezvousActif?.note_planification) {
          setNotePlanification(rendezvousActif.note_planification);
        }
      })
      .catch(() => {
        // Non bloquant : le champ reste simplement vide si cette recherche échoue (ex. rôle
        // Formateur/Inspecteur sans accès à GET /rendezvous, voir ROLES_GESTION_RENDEZVOUS côté
        // back — ce panneau n'est aujourd'hui ouvert que par Accueil/Coordination/Admin, mais
        // rien ne doit bloquer la saisie manuelle d'une nouvelle note si cet appel échouait).
      });
    return () => {
      annule = true;
    };
  }, [dossierId]);

  const togglerPoste = (code) => {
    setPostesCoches((precedent) => {
      const suivant = new Set(precedent);
      if (suivant.has(code)) suivant.delete(code);
      else suivant.add(code);
      return suivant;
    });
  };

  // Liste combinée formateurs + inspecteurs (voir GET /api/formateurs, role_code désormais inclus
  // dans chaque ligne) — la sélection de la personne précise, une fois filtrée par groupe, est
  // gérée par l'effet séparé ci-dessous plutôt qu'ici : ce fetch ne se relance jamais (dossier
  // changé ou pas, dépendances vides), alors que la personne présélectionnée doit se recalculer à
  // chaque changement de groupe/dossier.
  useEffect(() => {
    let annule = false;
    listerFormateurs()
      .then((valeur) => {
        if (annule) return;
        setFormateurs(valeur);
      })
      .catch((erreur) => {
        if (!annule) setErreurFormateurs(erreur.response?.data?.erreur ?? 'Impossible de récupérer la liste des formateurs.');
      })
      .finally(() => {
        if (!annule) setChargementFormateurs(false);
      });
    return () => {
      annule = true;
    };
  }, []);

  // Lieux disponibles (voir GET /api/lieux) — fetch indépendant de celui des formateurs
  // ci-dessus : un échec ici ne doit pas bloquer la planification (voir lieux plus bas, champ
  // optionnel), contrairement à erreurFormateurs qui empêche l'affichage du formulaire entier.
  useEffect(() => {
    let annule = false;
    listerLieux()
      .then((valeur) => {
        if (!annule) setLieux(valeur);
      })
      .catch((erreur) => {
        if (!annule) setErreurLieux(erreur.response?.data?.erreur ?? 'Impossible de récupérer la liste des lieux.');
      })
      .finally(() => {
        if (!annule) setChargementLieux(false);
      });
    return () => {
      annule = true;
    };
  }, []);

  // Appel réseau réel — POST ou PATCH /api/lieux (lieuService.js front, lieux.routes.js back)
  // selon `panneauLieuMode`, puis la liste locale est mise à jour directement (ajout ou
  // remplacement de l'entrée), sans refetch : dans les deux cas le lieu est déjà persisté en base
  // à ce stade (voir lieuRepository.js côté back), donc bien disponible pour toute planification
  // future — juste inutile de recharger la liste complète alors que la réponse contient déjà la
  // version à jour. En création, le nouveau lieu est aussi sélectionné immédiatement (setLieuId) ;
  // en édition, `lieuId` ne bouge pas puisque c'est déjà le lieu en cours d'édition qui reste
  // sélectionné. Séparée de soumettreLieu ci-dessous : c'est elle qu'on appelle directement quand
  // l'agent confirme "Créer quand même" malgré l'avertissement de doublon, sans repasser par la
  // vérification qui vient de le déclencher.
  const envoyerLieu = async ({ adresse, metroAcces, instructions }) => {
    setLieuFormEnCours(true);
    setLieuFormErreur(null);
    try {
      if (panneauLieuMode === 'edition') {
        const lieu = await modifierLieu(lieuIdEnEdition, { adresse, metroAcces, instructions });
        setLieux((precedent) => precedent.map((l) => (l.id === lieu.id ? lieu : l)));
      } else {
        const lieu = await creerLieu({ adresse, metroAcces, instructions });
        setLieux((precedent) => [...precedent, lieu]);
        setLieuId(String(lieu.id));
      }
      fermerPanneauLieu();
    } catch (erreur) {
      setLieuFormErreur(
        erreur.response?.data?.erreur ?? "Le serveur n'a pas pu enregistrer ce lieu. Merci de réessayer.",
      );
    } finally {
      setLieuFormEnCours(false);
    }
  };

  // Soumission du formulaire inline "+"/crayon (voir plus bas) — en CRÉATION uniquement (une
  // édition ne se compare pas à elle-même), compare d'abord le libellé saisi aux lieux déjà
  // chargés (detectionLieuSimilaire.js, purement local — pas de round-trip serveur juste pour ça)
  // avant d'appeler l'API : une correspondance forte n'empêche jamais la création (voir
  // lieuSimilaireDetecte plus haut), elle affiche seulement l'avertissement "Utiliser ce lieu" /
  // "Créer quand même" à la place de l'envoi immédiat — c'est le clic sur l'un de ces deux boutons
  // (voir plus bas) qui décide de la suite, pas cette fonction.
  const soumettreLieu = () => {
    const adresse = lieuFormAdresse.trim();
    if (!adresse || lieuFormEnCours) return;

    if (panneauLieuMode === 'creation') {
      const similaire = trouverLieuSimilaire(lieux, adresse);
      if (similaire) {
        setLieuSimilaireDetecte(similaire);
        return;
      }
    }

    envoyerLieu({ adresse, metroAcces: lieuFormMetroAcces.trim(), instructions: lieuFormInstructions.trim() });
  };

  // "Utiliser ce lieu" (voir l'avertissement de doublon) — sélectionne le lieu existant détecté à
  // la place de créer un nouveau, comme si l'agent l'avait choisi directement dans le sélecteur.
  const utiliserLieuSimilaire = () => {
    setLieuId(String(lieuSimilaireDetecte.id));
    fermerPanneauLieu();
  };

  // "Créer quand même" — l'agent confirme qu'il s'agit bien d'un lieu distinct malgré la
  // ressemblance (ex. deux structures différentes à la même adresse) : appelle directement
  // envoyerLieu, sans repasser par soumettreLieu (qui redéclencherait le même avertissement).
  const creerLieuMalgreSimilarite = () => {
    const adresse = lieuFormAdresse.trim();
    setLieuSimilaireDetecte(null);
    envoyerLieu({ adresse, metroAcces: lieuFormMetroAcces.trim(), instructions: lieuFormInstructions.trim() });
  };

  // Liste filtrée sur le groupe actif — c'est elle qui alimente le <select> plus bas, jamais la
  // liste combinée brute.
  const formateursDuGroupe = formateurs.filter((formateur) => formateur.role_code === groupeRole);

  // Présélectionne la première personne du groupe actif, dès que la liste combinée est chargée ET
  // à chaque changement de groupe (clic sur l'onglet, ou représélection automatique à l'ouverture
  // sur un autre dossier, voir l'effet dossierId/postesBureau ci-dessus) — même principe que la
  // sélection initiale d'origine (premier de la liste), appliqué désormais au sous-groupe plutôt
  // qu'à la liste entière. '' si le groupe est vide (ex. aucun inspecteur configuré pour cette
  // entité) : le <select> reste alors vide et le bouton de soumission désactivé (voir plus bas,
  // même garde qu'avant).
  useEffect(() => {
    setFormateurId(formateursDuGroupe.length > 0 ? String(formateursDuGroupe[0].id) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupeRole, formateurs]);

  useEffect(() => {
    if (!formateurId || !dateTest) {
      setCreneauxJourSelectionne([]);
      return undefined;
    }
    let annule = false;
    // Bornes du seul jour choisi (dateFin exclusive) — calcul par arithmétique locale de Date
    // (pas de toISOString ici) pour ne jamais glisser sur le jour voisin selon le fuseau du
    // navigateur, cf. cleJourLocal dans CalendrierDisponibiliteFormateur.jsx.
    const [annee, mois, jour] = dateTest.split('-').map(Number);
    const lendemain = new Date(annee, mois - 1, jour + 1);
    const dateFin = `${lendemain.getFullYear()}-${String(lendemain.getMonth() + 1).padStart(2, '0')}-${String(lendemain.getDate()).padStart(2, '0')}`;

    listerRendezvousTest({ formateurId: Number(formateurId), dateDebut: dateTest, dateFin })
      .then((valeur) => {
        if (!annule) setCreneauxJourSelectionne(valeur);
      })
      .catch(() => {
        if (!annule) setCreneauxJourSelectionne([]);
      });
    return () => {
      annule = true;
    };
  }, [formateurId, dateTest]);

  // Même recombinaison que celle utilisée au submit (voir plus bas) : null tant que les trois
  // contrôles ne sont pas tous renseignés, pour ne pas comparer un créneau incomplet.
  const dateHeureChoisieIso = dateTest && heureTest && minuteTest
    ? new Date(`${dateTest}T${heureTest}:${minuteTest}`).toISOString()
    : null;

  // Lieu couramment choisi pour ce rendez-vous (pas celui en cours d'édition, voir
  // lieuIdEnEdition plus haut) — sert à savoir si le bouton crayon a un sens (rien à modifier tant
  // qu'aucun lieu n'est sélectionné) et à préremplir le formulaire d'édition avec son libellé
  // actuel au clic.
  const lieuSelectionne = lieux.find((lieu) => String(lieu.id) === lieuId);

  const nombreDejaPresentsSurCreneau = dateHeureChoisieIso === null
    ? 0
    : creneauxJourSelectionne.filter((rendezvous) => new Date(rendezvous.date_heure).toISOString() === dateHeureChoisieIso).length;
  const creneauDejaPris = nombreDejaPresentsSurCreneau >= CAPACITE_MAX_FORMATEUR_PAR_CRENEAU;

  // Lieu désormais obligatoire (audit 2026-08-19, décision produit) — '' (option "-") ou aucun
  // lieu choisi bloque la confirmation, même garde-fou frontend que dateTest/formateurId
  // ci-dessous. Le back revalide indépendamment (voir creationRendezvousSchema, rendezvous.routes.js) :
  // ce composant ne fait ici que donner un retour immédiat à l'agent avant l'appel réseau.
  const lieuManquant = !lieuId;

  const soumettre = async (evenement) => {
    evenement.preventDefault();
    if (!dateTest || !heureTest || !minuteTest || !formateurId || !lieuId || envoiEnCours || creneauDejaPris) return;

    setEnvoiEnCours(true);
    setErreurEnvoi(null);

    const formateurChoisi = formateurs.find((f) => String(f.id) === formateurId);
    // Recombine les trois contrôles séparés (date + heure + minute) dans le même format que
    // produisait l'ancien input datetime-local ('aaaa-mm-jjTHH:mm'), pour ne rien changer côté
    // service/back (voir creerRendezvous, qui attend une chaîne convertible en Date).
    const dateHeureIso = dateHeureChoisieIso;

    // Une seule transition à appliquer : `codeAction` reçu en prop (voir en-tête de fichier) —
    // le moteur de transitions choisit lui-même la bonne ligne transitions_statut selon le statut
    // courant réel du dossier.
    const transitions = [
      {
        codeAction,
        commentaire: `Test planifié le ${FORMAT_DATE_HEURE.format(new Date(dateHeureIso))} avec ${formateurChoisi.prenom} ${formateurChoisi.nom}.`,
      },
    ];

    // Création du rendez-vous et changement de statut en une seule transaction côté back (voir
    // rendezvousService.creerRendezvousAvecTransitions) : soit les deux réussissent, soit aucun
    // des deux n'est enregistré — plus de rendez-vous "orphelin" possible si la transition échoue.
    try {
      await creerRendezvousAvecTransitions(dossierId, {
        typeRdv: 'test',
        dateHeure: dateHeureIso,
        formateurId: Number(formateurId),
        // '' (aucun lieu choisi, champ optionnel) -> undefined plutôt que NaN/0 : le back retombe
        // alors sur l'adresse par défaut ACCECIT (voir invitationTestService.js, LIEU_TEST_ACCECIT).
        lieuId: lieuId ? Number(lieuId) : undefined,
        postesSelectionnes: [...postesCoches],
        // '' (champ laissé vide, optionnel) -> undefined plutôt qu'une chaîne vide : le back
        // stocke alors NULL (voir rendezvousRepository.creerRendezvous), jamais '' — cohérent
        // avec lieuId ci-dessus.
        notePlanification: notePlanification.trim() || undefined,
        transitions,
      });
    } catch (erreur) {
      setEnvoiEnCours(false);
      setErreurEnvoi(
        erreur.response
          ? (erreur.response.data?.erreur ?? "Le serveur n'a pas pu enregistrer la planification. Merci de réessayer.")
          : 'Connexion au serveur impossible. Vérifiez le réseau et réessayez.',
      );
      return;
    }

    setEnvoiEnCours(false);
    onReussite({ dateHeure: dateHeureIso, formateurNom: `${formateurChoisi.prenom} ${formateurChoisi.nom}` });
  };

  return (
    <div ref={panneauRef} className="modale-planification-test" role="dialog" aria-label={titre}>
      <div className="modale-planification-test__entete">
        <h3>{titre}</h3>
        <button type="button" onClick={onAnnuler} disabled={envoiEnCours}>
          Fermer
        </button>
      </div>

      {chargementFormateurs && <p>Chargement des formateurs…</p>}
      {erreurFormateurs && <p role="alert">{erreurFormateurs}</p>}

      {!chargementFormateurs && !erreurFormateurs && formateurs.length === 0 && (
        <p role="alert">Aucun formateur ni inspecteur disponible pour cette entité - impossible de planifier un test.</p>
      )}

      {!chargementFormateurs && formateurs.length > 0 && (
        <form className="modale-planification-test__formulaire" onSubmit={soumettre}>
          {/* Choix du groupe avant la personne précise (voir GROUPES_ROLE) — deux onglets
              mutuellement exclusifs, pas de "Tous" (contrairement à FiltresStatut.jsx, pensé pour
              "Tous + N options" : ici un groupe doit toujours être actif, sinon aucune personne
              à proposer dans le <select> juste en dessous). Placé avant le <select> lui-même,
              qui ne liste que les personnes du groupe actif. Filtré sur le secteur du dossier
              (groupeImposeParSecteur, voir sa déclaration plus haut) quand celui-ci est déterminé :
              un seul onglet reste alors affiché, non togglable (disabled) puisqu'il n'y a plus
              qu'une option — évite qu'un agent assigne par erreur un Inspecteur à un test hôtel ou
              un Formateur à un test bureau (audit 2026-08-25). Les deux onglets restent visibles et
              togglables comme avant si le secteur est indéterminé (aucun poste déclaré sur le
              dossier). */}
          <div className="modale-planification-test__groupes-role" role="group" aria-label="Groupe">
            {GROUPES_ROLE.filter((groupe) => !groupeImposeParSecteur || groupe.code === groupeImposeParSecteur).map(
              (groupe) => (
                <button
                  key={groupe.code}
                  type="button"
                  className={groupeRole === groupe.code ? 'actif' : ''}
                  onClick={() => setGroupeRole(groupe.code)}
                  disabled={Boolean(groupeImposeParSecteur)}
                >
                  {groupe.libelle}
                </button>
              ),
            )}
          </div>

          {/* Texte du label regroupé dans un unique <span> (plutôt que texte + astérisque comme
              deux enfants directs du label) : le label est en display: flex/column pour
              empiler son contenu au-dessus du <select> imbriqué — un texte et un astérisque
              comme deux enfants directs se seraient sinon empilés l'un sous l'autre au lieu de
              rester sur la même ligne. Placé avant le calendrier et la date/heure : le formateur
              doit être connu avant d'afficher ses disponibilités. */}
          <label>
            <span>
              {groupeRole === 'inspecteur' ? 'Inspecteur' : 'Formateur'} <span className="champ-obligatoire">*</span>
            </span>
            {formateursDuGroupe.length === 0 ? (
              <p role="alert" className="modale-planification-test__groupe-vide">
                Aucun{groupeRole === 'inspecteur' ? ' inspecteur' : ' formateur'} disponible pour cette entité.
              </p>
            ) : (
              <select
                id="planification-formateur"
                value={formateurId}
                onChange={(evenement) => setFormateurId(evenement.target.value)}
                required
              >
                {formateursDuGroupe.map((formateur) => (
                  <option key={formateur.id} value={formateur.id}>
                    {formateur.prenom} {formateur.nom}
                  </option>
                ))}
              </select>
            )}
          </label>

          {/* Calendrier hebdomadaire Outlook réel (voir son commentaire d'en-tête,
              CalendrierHebdomadaireDisponibilite.jsx — remplace le calendrier mensuel Neon,
              audit 2026-08-26) : un clic sur un créneau libre préremplit directement les trois
              contrôles date/heure/minute ci-dessous, qui restent la seule source de vérité pour
              la date/l'heure choisies (l'agent peut toujours les ajuster manuellement ensuite). */}
          <CalendrierHebdomadaireDisponibilite
            formateurId={formateurId}
            dateSelectionnee={dateTest}
            heureSelectionnee={heureTest}
            minuteSelectionnee={minuteTest}
            onSelectionnerCreneau={(jour, heure, minute) => {
              setDateTest(jour);
              setHeureTest(heure);
              setMinuteTest(minute);
            }}
          />

          {/* Date/heure et lieu côte à côte sur la même ligne (décision produit) — deux fieldsets
              distincts plutôt qu'un seul : le lieu est optionnel et sans rapport direct avec les
              trois contrôles date/heure/minute qui, eux, partagent une seule légende. */}
          <div className="modale-planification-test__ligne-date-heure-lieu">
            {/* fieldset plutôt qu'un simple label : trois contrôles distincts (date, heure,
                minute) partagent une seule légende. Le texte de la légende reste un bloc unique
                (pas de display: flex sur le fieldset/legend ici), donc l'astérisque reste sur la
                même ligne. */}
            <fieldset className="modale-planification-test__champ-date-heure">
              <legend>
                Date et heure du test <span className="champ-obligatoire">*</span>
              </legend>
              <div className="modale-planification-test__date-heure-controles">
                <input
                  id="planification-date"
                  type="date"
                  value={dateTest}
                  min={dateDuJourParis()}
                  onChange={(evenement) => setDateTest(evenement.target.value)}
                  required
                />
                <select
                  id="planification-heure"
                  aria-label="Heure"
                  value={heureTest}
                  onChange={(evenement) => setHeureTest(evenement.target.value)}
                  required
                >
                  <option value="">--</option>
                  {HEURES_DISPONIBLES.map((heure) => (
                    <option key={heure} value={heure}>
                      {heure}
                    </option>
                  ))}
                </select>
                <span aria-hidden="true">:</span>
                <select
                  id="planification-minute"
                  aria-label="Minutes"
                  value={minuteTest}
                  onChange={(evenement) => setMinuteTest(evenement.target.value)}
                  required
                >
                  <option value="">--</option>
                  {MINUTES_DISPONIBLES.map((minute) => (
                    <option key={minute} value={minute}>
                      {minute}
                    </option>
                  ))}
                </select>
              </div>
            </fieldset>

            {/* Fieldset séparé, à côté de "Date et heure du test" plutôt qu'à l'intérieur
                (décision produit). Optionnel (contrairement à date/heure/formateur) : un
                rendez-vous peut rester sans lieu précisé, voir soumettre() ci-dessus et
                invitationTestService.js côté back (repli sur LIEU_TEST_ACCECIT). Ni le
                chargement ni une éventuelle erreur ne bloquent le reste du formulaire —
                contrairement aux formateurs, la liste de lieux n'est pas indispensable pour
                planifier un test. */}
            <fieldset className="modale-planification-test__champ-lieu">
              <legend>
                Lieu <span className="champ-obligatoire">*</span>
              </legend>
              {chargementLieux ? (
                <p className="modale-planification-test__lieu-etat">Chargement des lieux…</p>
              ) : erreurLieux ? (
                <p role="alert" className="modale-planification-test__lieu-etat">
                  {erreurLieux}
                </p>
              ) : (
                <div className="modale-planification-test__lieu-select-ligne">
                  {lieux.length === 0 ? (
                    <p className="modale-planification-test__lieu-etat">Aucun lieu configuré pour cette entité.</p>
                  ) : (
                    <select id="planification-lieu" value={lieuId} onChange={(evenement) => setLieuId(evenement.target.value)}>
                      <option value="">-</option>
                      {/* Adresse seule dans la liste déroulante (pas metroAcces/instructions,
                          voir migration 047) — une ligne par option, le détail complet reste
                          visible dans le formulaire de création/édition ci-dessous. */}
                      {lieux.map((lieu) => (
                        <option key={lieu.id} value={lieu.id}>
                          {lieu.adresse}
                        </option>
                      ))}
                    </select>
                  )}
                  {/* Toujours affiché, y compris liste vide/en erreur : c'est justement le moyen de
                      sortir de ces deux cas sans quitter la modale. aria-expanded plutôt qu'un
                      simple aria-label : annonce l'état ouvert/fermé du formulaire inline
                      ci-dessous aux lecteurs d'écran. */}
                  <button
                    type="button"
                    className="modale-planification-test__bouton-ajout-lieu"
                    aria-expanded={panneauLieuMode === 'creation'}
                    aria-label="Ajouter un lieu"
                    onClick={() => {
                      if (panneauLieuMode === 'creation') {
                        fermerPanneauLieu();
                        return;
                      }
                      setPanneauLieuMode('creation');
                      setLieuIdEnEdition(null);
                      setLieuFormAdresse('');
                      setLieuFormMetroAcces('');
                      setLieuFormInstructions('');
                      setLieuFormErreur(null);
                      setLieuSimilaireDetecte(null);
                    }}
                  >
                    +
                  </button>
                  {/* Visible seulement si un lieu est sélectionné (rien à modifier sinon, voir
                      lieuSelectionne plus haut) — désactivé plutôt que masqué pendant la
                      soumission, cohérent avec les autres boutons de ce formulaire (Annuler ci-
                      dessous, Fermer dans l'en-tête). */}
                  {lieuSelectionne && (
                    <button
                      type="button"
                      className="modale-planification-test__bouton-ajout-lieu"
                      aria-expanded={panneauLieuMode === 'edition'}
                      aria-label="Modifier le lieu sélectionné"
                      title="Modifier le lieu sélectionné"
                      disabled={lieuFormEnCours}
                      onClick={() => {
                        if (panneauLieuMode === 'edition') {
                          fermerPanneauLieu();
                          return;
                        }
                        setPanneauLieuMode('edition');
                        setLieuIdEnEdition(lieuSelectionne.id);
                        setLieuFormAdresse(lieuSelectionne.adresse);
                        setLieuFormMetroAcces(lieuSelectionne.metro_acces ?? '');
                        setLieuFormInstructions(lieuSelectionne.instructions ?? '');
                        setLieuFormErreur(null);
                        setLieuSimilaireDetecte(null);
                      }}
                    >
                      ✎
                    </button>
                  )}
                  {/* Même visibilité conditionnelle que le crayon ci-dessus — rien à supprimer
                      tant qu'aucun lieu n'est sélectionné. Désactivé (pas masqué) pendant la
                      vérification des rendez-vous associés ou une suppression déjà en cours,
                      même principe que les autres boutons de ce bloc. */}
                  {lieuSelectionne && (
                    <button
                      type="button"
                      className="modale-planification-test__bouton-ajout-lieu"
                      aria-label="Supprimer le lieu sélectionné"
                      title="Supprimer le lieu sélectionné"
                      disabled={chargementRendezvousAssocies || suppressionEnCours || lieuFormEnCours}
                      onClick={cliquerSupprimerLieu}
                    >
                      {chargementRendezvousAssocies ? '…' : '🗑'}
                    </button>
                  )}
                </div>
              )}

              {erreurSuppressionLieu && !panneauSuppressionOuvert && <p role="alert">{erreurSuppressionLieu}</p>}

              {panneauLieuMode && (
                <div className="modale-planification-test__ajout-lieu">
                  {/* Trois champs structurés depuis la migration 047 (remplace l'ancien champ
                      unique texte libre où adresse/accès/instructions étaient concaténés à la
                      main avec des " | ", voir audit du 2026-08-13) — seule l'adresse est
                      obligatoire, cohérent avec detectionLieuSimilaire.js qui ne compare
                      qu'elle. */}
                  <label>
                    <span>Adresse <span className="champ-obligatoire">*</span></span>
                    <input
                      type="text"
                      value={lieuFormAdresse}
                      onChange={(evenement) => {
                        setLieuFormAdresse(evenement.target.value);
                        // Toute nouvelle saisie invalide l'avertissement affiché pour l'ancien
                        // texte — l'agent doit pouvoir cliquer "Créer" à nouveau pour re-vérifier
                        // le texte modifié, pas rester bloqué sur une comparaison obsolète.
                        setLieuSimilaireDetecte(null);
                      }}
                      placeholder="Ex. Hôtel du Cadran - 14 rue de Valadon, 75007 Paris"
                      autoFocus
                    />
                  </label>
                  <label>
                    <span>Métro / Accès</span>
                    <input
                      type="text"
                      value={lieuFormMetroAcces}
                      onChange={(evenement) => setLieuFormMetroAcces(evenement.target.value)}
                      placeholder="Ex. Métro Ecole Militaire - Ligne 8"
                    />
                  </label>
                  <label>
                    <span>Instructions</span>
                    <input
                      type="text"
                      value={lieuFormInstructions}
                      onChange={(evenement) => setLieuFormInstructions(evenement.target.value)}
                      placeholder="Ex. Munissez-vous de votre pièce d'identité originale. Appuyez sur l'interphone et dites « TEST » pour ACCECIT."
                    />
                  </label>
                  {lieuFormErreur && <p role="alert">{lieuFormErreur}</p>}

                  {lieuSimilaireDetecte ? (
                    // Avertissement, pas un blocage (voir soumettreLieu/detectionLieuSimilaire.js)
                    // : role="status" plutôt que "alert" — c'est une question à trancher, pas une
                    // erreur, d'où aussi un style ambre dédié (.avertissement-doublon) plutôt que
                    // le rouge générique [role='alert'] de cette modale.
                    <div className="modale-planification-test__avertissement-doublon">
                      <p role="status">
                        Un lieu similaire existe déjà : <strong>{lieuSimilaireDetecte.adresse}</strong>. Voulez-vous
                        l&rsquo;utiliser à la place ?
                      </p>
                      <div className="modale-planification-test__ajout-lieu-actions">
                        <button type="button" onClick={utiliserLieuSimilaire} disabled={lieuFormEnCours}>
                          Utiliser ce lieu
                        </button>
                        <button type="button" onClick={creerLieuMalgreSimilarite} disabled={lieuFormEnCours}>
                          {lieuFormEnCours ? 'Création...' : 'Créer quand même'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="modale-planification-test__ajout-lieu-actions">
                      <button type="button" onClick={fermerPanneauLieu} disabled={lieuFormEnCours}>
                        Annuler
                      </button>
                      <button type="button" onClick={soumettreLieu} disabled={!lieuFormAdresse.trim() || lieuFormEnCours}>
                        {lieuFormEnCours
                          ? (panneauLieuMode === 'edition' ? 'Enregistrement...' : 'Création...')
                          : (panneauLieuMode === 'edition' ? 'Enregistrer' : 'Créer')}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Panneau de migration — seulement affiché quand la vérification (GET, voir
                  cliquerSupprimerLieu) a trouvé au moins un rendez-vous associé ; le cas "aucun
                  rendez-vous" passe par window.confirm (même patron que la suppression d'une pièce
                  justificative, CaptureTablette.jsx), pas de panneau dédié pour lui. */}
              {panneauSuppressionOuvert && (
                <div className="modale-planification-test__migration-lieu">
                  <p role="status">
                    {rendezvousAssocies.length === 1
                      ? '1 rendez-vous est encore associé à ce lieu.'
                      : `${rendezvousAssocies.length} rendez-vous sont encore associés à ce lieu.`}{' '}
                    Choisissez un lieu de destination pour les migrer avant de supprimer «{' '}
                    {lieuSelectionne?.adresse} ».
                  </p>
                  <ul className="modale-planification-test__migration-lieu-liste">
                    {rendezvousAssocies.map((rendezvousAssocie) => (
                      <li key={rendezvousAssocie.id}>
                        {rendezvousAssocie.candidatPrenom} {rendezvousAssocie.candidatNom} —{' '}
                        {FORMAT_DATE_HEURE.format(new Date(rendezvousAssocie.dateHeure))}
                      </li>
                    ))}
                  </ul>
                  <label>
                    <span>Lieu de destination</span>
                    <select
                      value={lieuDestinationMigrationId}
                      onChange={(evenement) => setLieuDestinationMigrationId(evenement.target.value)}
                    >
                      <option value="">-</option>
                      {lieux
                        .filter((lieu) => lieu.id !== lieuSelectionne?.id)
                        .map((lieu) => (
                          <option key={lieu.id} value={lieu.id}>
                            {lieu.adresse}
                          </option>
                        ))}
                    </select>
                  </label>
                  {erreurSuppressionLieu && <p role="alert">{erreurSuppressionLieu}</p>}
                  <div className="modale-planification-test__ajout-lieu-actions">
                    <button type="button" onClick={fermerPanneauSuppression} disabled={suppressionEnCours}>
                      Annuler
                    </button>
                    <button
                      type="button"
                      onClick={confirmerMigrationEtSuppression}
                      disabled={!lieuDestinationMigrationId || suppressionEnCours}
                    >
                      {suppressionEnCours ? 'Migration...' : 'Confirmer la migration et la suppression'}
                    </button>
                  </div>
                </div>
              )}
            </fieldset>
          </div>

          {/* Phase 1 (informatif uniquement, voir CLAUDE.md/décision produit) : n'apparaît que si
              le dossier a plusieurs postes déclarés — avec un seul poste, rien à choisir, l'afficher
              serait un décochage sans effet utile. Toutes les cases restent pré-cochées par défaut
              (postesCoches initialisé à l'ensemble des postes déclarés) : l'agent décoche seulement
              ceux qui ne concernent pas ce test précis. */}
          {postesDisponibles.length > 1 && (
            <fieldset className="modale-planification-test__champ-postes">
              <legend>Poste(s) testé(s)</legend>
              {postesDisponibles.map((code) => (
                <label key={code} className="modale-planification-test__poste">
                  <input type="checkbox" checked={postesCoches.has(code)} onChange={() => togglerPoste(code)} />
                  {libellePoste ? libellePoste(code) : code}
                </label>
              ))}
            </fieldset>
          )}

          {/* Note libre optionnelle pour le formateur/inspecteur assigné (migration 049) —
              distincte des notes générales du dossier (bloc "Notes" de la fiche candidat, jamais
              modifié par ce formulaire). Envoyée uniquement dans l'email de convocation
              formateur/inspecteur (voir invitationTestService.js), jamais au candidat, et non
              modifiable après coup en dehors d'une replanification (même principe que
              Poste(s) testé(s) ci-dessus). */}
          <label className="modale-planification-test__champ-note">
            <span>Note pour le formateur/inspecteur (optionnel)</span>
            <textarea
              value={notePlanification}
              onChange={(evenement) => setNotePlanification(evenement.target.value)}
              rows={3}
              maxLength={2000}
            />
          </label>

          {creneauDejaPris && (
            <p role="alert">
              Ce formateur a déjà {CAPACITE_MAX_FORMATEUR_PAR_CRENEAU} candidats prévus à cet horaire (créneau
              complet). Choisissez un autre créneau.
            </p>
          )}

          {lieuManquant && <p role="alert">Choisissez un lieu avant de confirmer la planification.</p>}

          {erreurEnvoi && <p role="alert">{erreurEnvoi}</p>}

          <div className="modale-planification-test__formulaire-actions">
            <button type="button" onClick={onAnnuler} disabled={envoiEnCours}>
              Annuler
            </button>
            <button
              type="submit"
              disabled={
                envoiEnCours || !dateTest || !heureTest || !minuteTest || !formateurId || !lieuId || creneauDejaPris
              }
            >
              {envoiEnCours ? 'Enregistrement...' : 'Confirmer la planification'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
