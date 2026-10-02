import { useEffect, useRef, useState } from 'react';
import { obtenirInscriptionComplete, modifierInscription } from '../../services/dossierService';
import { listerPiecesJustificatives, obtenirApercuPiece } from '../../services/pieceJustificativeService';
import { useSession } from '../auth/useSession';
import { useRafraichissementAuto } from './useRafraichissementAuto';
import PanneauApercuPiece from '../pieceJustificative/PanneauApercuPiece';
import StatutBadge from '../workflow/StatutBadge';
import { peut } from '../auth/permissions';
import { LIBELLES_POSTE, POSTES_BUREAU, POSTES_HOTEL } from '../referentiels/postes';
import {
  CODE_PHOTO_IDENTITE,
  LIBELLES_CIVILITE,
  LIBELLES_CRENEAU,
  CRENEAUX_HOTEL,
  CRENEAUX_BUREAU,
  LIBELLES_JOUR,
  JOURS,
  LIBELLES_LANGUE,
  LANGUES,
  LIBELLES_TYPE_POSTE,
  LIBELLES_COMMENT_CONNU,
  LIBELLES_EXPERIENCE,
  EXPERIENCE,
  SITUATIONS_FAMILIALES,
  LIBELLES_SITUATION_FAMILIALE,
  LIBELLES_CONSENTEMENT_DIFFUSION,
  LIBELLE_PIECE_ORPHELINE,
  libelle,
  libelleListe,
  formaterDate,
  versDateInput,
  Ligne,
  Champ,
  GroupeCases,
  ErreurChamp,
  LIBELLES_CHAMPS_ERREUR,
  IconePersonne,
  IconeCarnetAdresses,
  IconeMallette,
  IconeTrombone,
  EnteteCarte,
  BadgePositifNeutre,
} from './elementsInformationsInscription';
import './InformationsInscription.css';

// Section repliable "Informations d'inscription complètes" de la fiche dossier candidat
// (accessible via "Voir le dossier"/"Étudier le dossier", voir Relances.jsx/Validation.jsx) :
// reprend l'intégralité des données saisies par le candidat à l'inscription (état civil,
// coordonnées, situation professionnelle, mutuelle, consentement RGPD) ainsi que les pièces déjà
// reçues. <details>/<summary> natif plutôt qu'un état React dédié : repliée par défaut sans JS
// supplémentaire, comportement clavier/accessibilité déjà géré par le navigateur — le
// chargement réseau n'est déclenché qu'à la première ouverture (voir onToggle), pour ne pas
// alourdir le chargement de la fiche dossier par défaut.
//
// N'affiche jamais le NIR : dossierRepository.trouverInscriptionCompleteParDossierId (back) ne le
// sélectionne même pas — CLAUDE.md n'autorise son déchiffrement que côté serveur, pour un usage
// qui en a explicitement besoin, ce qui n'est pas le cas d'un affichage back-office générique
// comme celui-ci.
//
// Vue lecture seule en cartes (audit 2026-08-19, refonte visuelle sur maquette validée) — TOUTE
// donnée saisie à l'inscription reste TOUJOURS affichée, y compris les valeurs négatives/vides
// (demande explicite : plus aucun `condition && <Ligne/>` qui ferait disparaître un champ entier,
// contrairement au comportement précédent sur autreLanguePrecision/commentConnuPrecision/
// dateSignature). Le mode édition (voir demarrerEdition/Champ ci-dessous), lui, garde son ancienne
// présentation en groupes empilés simples — aucune demande de refonte sur ce mode, plus rare et
// plus fonctionnel que visuel ; seules Consentement RGPD et Pièces jointes restent hors édition
// dans les deux cas (jamais éditables, voir leur commentaire plus bas).
//
// Bouton "Modifier" (2026-08-18, CLAUDE.md) : bascule Informations personnelles/Coordonnées/
// Situation professionnelle/Mutuelle en formulaire, visible uniquement Admin/Accueil-Coordination
// (voir modificationInscription) — Consentement RGPD, Pièces jointes et Photo d'identité
// restent toujours en lecture seule ici (preuve légale horodatée pour le premier, gérées par leurs
// propres écrans/actions pour les deux autres, voir dossierService.modifierInscription côté back
// pour le détail de ce qui est volontairement exclu du schéma de modification).
//
// dossierId reçu en prop, pas de useParams() ici : ce composant ne connaît rien du routage, même
// patron que HistoriqueRelances.jsx — à l'appelant de le lire depuis le paramètre de route.
export default function InformationsInscription({ dossierId }) {
  const { utilisateur } = useSession();
  const [inscription, setInscription] = useState(null);
  const [pieces, setPieces] = useState([]);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState(null);

  // Vignette de la photo d'identité (voir CODE_PHOTO_IDENTITE) — même route/service que
  // "Voir" sur CaptureTablette.jsx (obtenirApercuPiece, GET .../pieces/:pieceId/apercu), donc le
  // même connecteur de stockage par entité (OneDrive/Microsoft Graph pour ACCECIT, voir
  // storageFactory côté back) que n'importe quelle autre pièce justificative — aucune route ni
  // logique de récupération propre à cette section. null tant qu'aucune photo n'est trouvée dans
  // `pieces` (dossier en cours, pas encore capturée) : distinct de chargement/erreur, sert à
  // choisir entre la vignette réelle et l'icône générique de repli dans la carte "Identité".
  const [photoIdentiteUrl, setPhotoIdentiteUrl] = useState(null);
  const [photoIdentiteChargement, setPhotoIdentiteChargement] = useState(false);
  const [photoIdentiteErreur, setPhotoIdentiteErreur] = useState(null);
  const [photoAgrandie, setPhotoAgrandie] = useState(false);

  // Pièce sélectionnée pour un aperçu individuel (bouton "Voir" du bloc "Pièces jointes"), ou null
  // si aucun panneau n'est ouvert — même mécanisme que CaptureTablette.jsx (PanneauApercuPiece,
  // désormais extrait en composant partagé, voir son import ci-dessus), réutilisé tel quel plutôt
  // que reconstruit ici. Cette section restant strictement en lecture seule (voir peutModifier),
  // aucune action de suppression/remplacement n'est jamais proposée depuis ce panneau.
  const [pieceEnApercu, setPieceEnApercu] = useState(null);

  // Mode édition (voir Champ/GroupeCases ci-dessus) : `brouillon` est un objet plat, exactement à
  // la forme attendue par dossierService.modifierInscription (back, modificationInscriptionSchema)
  // — envoyé tel quel à l'enregistrement, jamais reconstruit champ par champ à la soumission.
  const [edition, setEdition] = useState(false);
  const [brouillon, setBrouillon] = useState(null);
  const [enregistrementEnCours, setEnregistrementEnCours] = useState(false);
  const [erreurEnregistrement, setErreurEnregistrement] = useState(null);
  // Détail par champ (audit 2026-08-19 : un dossier bureau aux créneaux hérités du vocabulaire
  // Hôtel échouait avec le seul message générique "Données invalides.", sans dire à l'agent quel
  // champ corriger) — `details.fieldErrors` du 400 backend (zod .flatten(), voir
  // dossiers.routes.js), clé = nom de champ du schéma, valeur = tableau de messages. Affiché au
  // plus près du champ concerné quand un emplacement dédié existe (créneaux, ci-dessous), et dans
  // tous les cas repris en intégralité dans le bandeau global (voir son rendu) : un champ sans
  // emplacement dédié ne doit pas non plus rester silencieux.
  const [erreursChamps, setErreursChamps] = useState({});
  // typePoste "déjà pris en compte" par le nettoyage de creneaux (voir demarrerEdition et l'effet
  // plus bas) — null tant qu'aucune session d'édition n'est en cours.
  const typePostePrecedentRef = useRef(null);

  const peutModifier = peut(utilisateur, 'modificationInscription');
  // Pièces (dont la photo d'identité) : jamais demandées hors consultationPieces (2026-10-01,
  // Inspecteur Hôtellerie, sans accès aux pièces) — les informations d'inscription restent affichées.
  const peutVoirPieces = peut(utilisateur, 'consultationPieces');

  // Révoque l'URL locale (blob) au démontage ou si elle change — même précaution que
  // CaptureTablette.jsx (PanneauApercuPiece) pour ne pas fuiter de mémoire.
  useEffect(() => {
    return () => {
      if (photoIdentiteUrl) URL.revokeObjectURL(photoIdentiteUrl);
    };
  }, [photoIdentiteUrl]);

  const chargerInscription = () => {
    setChargement(true);
    setErreur(null);
    Promise.all([obtenirInscriptionComplete(dossierId), peutVoirPieces ? listerPiecesJustificatives(dossierId) : Promise.resolve([])])
      .then(([inscriptionValeur, piecesValeur]) => {
        setInscription(inscriptionValeur);
        setPieces(piecesValeur);

        const photoIdentite = piecesValeur.find((piece) => piece.type_piece_code === CODE_PHOTO_IDENTITE);
        if (!photoIdentite) return;
        setPhotoIdentiteChargement(true);
        obtenirApercuPiece(dossierId, photoIdentite.id)
          .then((blob) => setPhotoIdentiteUrl(URL.createObjectURL(blob)))
          .catch(() => setPhotoIdentiteErreur("Impossible de récupérer la photo d'identité."))
          .finally(() => setPhotoIdentiteChargement(false));
      })
      .catch((erreurRequete) => {
        setErreur(
          erreurRequete.response?.data?.erreur ?? "Impossible de récupérer les informations d'inscription.",
        );
      })
      .finally(() => setChargement(false));
  };

  const gererOuverture = (evenement) => {
    if (!evenement.target.open || inscription) return;
    chargerInscription();
  };

  // Rafraîchissement automatique : cette section est un <details> chargé à la
  // demande (gererOuverture ci-dessus), jamais au montage — rien à rafraîchir tant qu'elle n'a
  // jamais été ouverte (inscription === null, voir le même guard que gererOuverture). Ne recharge
  // jamais pendant une édition en cours (`edition`) : un agent qui corrige une erreur de saisie
  // (bouton "Modifier") ne doit jamais voir son brouillon écrasé par un rafraîchissement en
  // arrière-plan pendant qu'il tape — même principe que le guard déjà en place pour ne pas perdre
  // une signature/capture en cours ailleurs dans ce projet (voir CaptureTablette.jsx).
  useRafraichissementAuto(() => {
    if (inscription && !edition) chargerInscription();
  });

  const candidat = inscription?.candidat;
  const coordonnees = inscription?.blocs?.coordonnees ?? {};
  const disponibilites = inscription?.blocs?.disponibilites ?? {};
  const mutuelle = inscription?.blocs?.mutuelle ?? {};
  const consentementRgpd = inscription?.blocs?.consentement_rgpd ?? {};
  const postesRecherches = [...(disponibilites.posteBureau ?? []), ...(disponibilites.posteHotel ?? [])];

  // Reconstitue un brouillon plat à partir des données actuellement affichées — un champ que le
  // formulaire d'inscription n'a jamais renseigné (ex. dossier ancien) retombe sur une valeur par
  // défaut cohérente avec le schéma de modification (back), pour ne jamais soumettre `undefined`.
  //
  // creneaux : vidé au chargement si son contenu n'appartient pas au vocabulaire du typePoste du
  // dossier (audit 2026-08-19, dossier #91 : "matin" — vocabulaire Hôtel — encore stocké sur un
  // dossier typePoste=bureau, hérité d'avant l'ajout des créneaux Bureau) — même protection que
  // BlocDisponibilites.jsx (formulaire d'inscription candidat, useEffect sur typePosteSelectionne)
  // pour le changement de typePoste EN COURS d'édition (voir plus bas), mais celle-ci ne couvre
  // pas ce cas précis : elle ne réagit qu'à un changement de typePoste après montage, jamais à une
  // incohérence déjà présente à l'ouverture (un formulaire d'inscription neuf démarre toujours
  // creneaux=[], jamais pré-rempli avec un vocabulaire différent — cas qui ne peut arriver qu'en
  // édition sur une donnée déjà en base). Sans ce nettoyage, cocher UNE SEULE case du bon
  // vocabulaire ajoutait la nouvelle valeur au tableau sans jamais retirer le résidu (voir
  // bascule()), donc jamais de payload valide possible pour ces dossiers.
  const demarrerEdition = () => {
    setErreurEnregistrement(null);
    const typePoste = disponibilites.typePoste ?? 'hotel';
    const vocabulaireCreneaux = typePoste === 'bureau' ? CRENEAUX_BUREAU : CRENEAUX_HOTEL;
    const creneauxStockes = disponibilites.creneaux ?? [];
    const creneauxCoherents = creneauxStockes.every((code) => vocabulaireCreneaux.includes(code));
    setBrouillon({
      civilite: candidat.civilite ?? 'monsieur',
      nom: candidat.nom ?? '',
      nomNaissance: candidat.nomNaissance ?? '',
      lieuNaissance: candidat.lieuNaissance ?? '',
      nationalite: candidat.nationalite ?? '',
      prenom: candidat.prenom ?? '',
      dateNaissance: versDateInput(candidat.dateNaissance),
      situationFamiliale: candidat.situationFamiliale ?? '',
      adresse: coordonnees.adresse ?? '',
      codePostal: coordonnees.codePostal ?? '',
      ville: coordonnees.ville ?? '',
      telephone: coordonnees.telephone ?? '',
      email: coordonnees.email ?? candidat.email ?? '',
      contactUrgenceNom: coordonnees.contactUrgenceNom ?? '',
      contactUrgenceTelephone: coordonnees.contactUrgenceTelephone ?? '',
      disponibiliteImmediate: disponibilites.disponibiliteImmediate ?? true,
      dateDebut: versDateInput(disponibilites.dateDebut),
      dateFin: versDateInput(disponibilites.dateFin),
      creneaux: creneauxCoherents ? creneauxStockes : [],
      joursDisponibles: disponibilites.joursDisponibles ?? [],
      languesParlees: disponibilites.languesParlees ?? [],
      autreLanguePrecision: disponibilites.autreLanguePrecision ?? '',
      typePoste,
      posteBureau: disponibilites.posteBureau ?? [],
      posteHotel: disponibilites.posteHotel ?? [],
      experience: disponibilites.experience ?? 'aucune',
      experienceLieu: disponibilites.experienceLieu ?? '',
      experienceMissions: disponibilites.experienceMissions ?? '',
      commentConnu: disponibilites.commentConnu ?? 'bouche_a_oreille',
      commentConnuPrecision: disponibilites.commentConnuPrecision ?? '',
      cas1CmuC: mutuelle.cas1CmuC ?? 'non',
      cas2Acs: mutuelle.cas2Acs ?? 'non',
      cas3MutuelleIndividuelle: mutuelle.cas3MutuelleIndividuelle ?? 'non',
      cas4MutuelleCollective: mutuelle.cas4MutuelleCollective ?? 'non',
      certificationAucuneDispense: mutuelle.certificationAucuneDispense ?? false,
    });
    // Marque ce typePoste comme "déjà pris en compte" pour l'effet ci-dessous (typePostePrecedentRef) :
    // sans ça, l'effet le verrait comme un CHANGEMENT au premier rendu suivant (précédent = null
    // -> nouveau = typePoste) et re-viderait creneaux une seconde fois pour rien — inoffensif ici
    // (déjà [] ou déjà cohérent) mais garde l'intention de chaque mécanisme séparée : celui-ci gère
    // l'état initial, l'effet ne gère que les changements pendant l'édition (voir point 3 de la
    // demande).
    typePostePrecedentRef.current = typePoste;
    setEdition(true);
  };

  // Même protection que BlocDisponibilites.jsx (formulaire d'inscription candidat) pour un
  // changement de typePoste PENDANT l'édition (agent qui bascule Bureau <-> Hôtel sur le select
  // "Type de poste recherché") : les créneaux de l'ancien vocabulaire n'ont plus de sens une fois
  // le type de poste changé, et resteraient sinon un résidu invalide comme celui corrigé par
  // demarrerEdition ci-dessus pour le chargement initial. Vide aussi le tableau de postes de la
  // famille QUITTÉE (posteBureau/posteHotel) — audit 2026-08-24 (dossier 69, "TEST ETEST") : un
  // agent qui bascule Bureau -> Hôtel en édition gardait l'ancien posteBureau dans `brouillon` (rien
  // ne l'écrase, l'UI n'affiche que la famille courante) et le réenvoyait tel quel à l'enregistrement
  // aux côtés du nouveau posteHotel, faisant compter le dossier dans Hôtellerie ET Tertiaire à la
  // fois (voir compteurHotel/compteurBureau, TableauDeBordAccueil.jsx). typePostePrecedentRef
  // (déclaré plus haut, avec les autres états) initialisé/mis à jour par demarrerEdition (pas ici)
  // pour ne jamais vider creneaux au tout premier rendu d'une session d'édition.
  useEffect(() => {
    if (!brouillon) return;
    if (typePostePrecedentRef.current != null && typePostePrecedentRef.current !== brouillon.typePoste) {
      const champAVider = typePostePrecedentRef.current === 'bureau' ? 'posteBureau' : 'posteHotel';
      setBrouillon((precedent) => (precedent ? { ...precedent, creneaux: [], [champAVider]: [] } : precedent));
    }
    typePostePrecedentRef.current = brouillon.typePoste;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brouillon?.typePoste]);

  const annulerEdition = () => {
    setEdition(false);
    setBrouillon(null);
    setErreurEnregistrement(null);
    setErreursChamps({});
    typePostePrecedentRef.current = null;
  };

  const modifierChamp = (champ) => (valeur) => setBrouillon((precedent) => ({ ...precedent, [champ]: valeur }));

  const gererEnregistrement = async (evenement) => {
    evenement.preventDefault();
    setEnregistrementEnCours(true);
    setErreurEnregistrement(null);
    setErreursChamps({});
    try {
      const inscriptionMiseAJour = await modifierInscription(dossierId, brouillon);
      setInscription(inscriptionMiseAJour);
      setEdition(false);
      setBrouillon(null);
      typePostePrecedentRef.current = null;
    } catch (erreurRequete) {
      const donneesErreur = erreurRequete.response?.data;
      setErreurEnregistrement(donneesErreur?.erreur ?? "Impossible d'enregistrer les modifications. Merci de réessayer.");
      setErreursChamps(donneesErreur?.details?.fieldErrors ?? {});
    } finally {
      setEnregistrementEnCours(false);
    }
  };

  // Comment nous a connu + précision repliés en une seule valeur (voir grille "Situation
  // professionnelle") — évite une 6e ligne pour une précision qui n'a de sens qu'accolée à sa
  // question, sans pour autant la faire disparaître (voir demande explicite, "aucune donnée
  // masquée conditionnellement" : la précision, elle, reste absente du texte si non renseignée,
  // ce n'est pas la même chose qu'un champ entier qui disparaîtrait).
  const commentConnuValeur = disponibilites.commentConnu
    ? `${libelle(LIBELLES_COMMENT_CONNU, disponibilites.commentConnu)}${
        disponibilites.commentConnuPrecision ? ` (${disponibilites.commentConnuPrecision})` : ''
      }`
    : '-';

  // Langues parlées + précision "Autre" repliées de la même façon (voir commentConnuValeur
  // ci-dessus) — "Français, Anglais, Autre (Créole)" plutôt qu'une ligne "Précision langue" à part.
  const languesValeur = (() => {
    if (!disponibilites.languesParlees || disponibilites.languesParlees.length === 0) return '-';
    return disponibilites.languesParlees
      .map((code) =>
        code === 'autre' && disponibilites.autreLanguePrecision
          ? `Autre (${disponibilites.autreLanguePrecision})`
          : libelle(LIBELLES_LANGUE, code),
      )
      .join(', ');
  })();

  // Contact d'urgence (nom + téléphone) replié en une seule valeur (voir grille "Coordonnées") —
  // "Julien Dupont (06 12 34 56 78)" plutôt que deux lignes séparées ; aucune des deux données
  // n'est perdue, juste présentées ensemble puisqu'elles décrivent la même personne.
  const contactUrgenceValeur = coordonnees.contactUrgenceNom
    ? `${coordonnees.contactUrgenceNom}${coordonnees.contactUrgenceTelephone ? ` (${coordonnees.contactUrgenceTelephone})` : ''}`
    : '-';

  return (
    <section className="informations-inscription encadre-repliable">
      <details onToggle={gererOuverture}>
        <summary>Voir les informations d'inscription complètes</summary>

        {chargement && <p>Chargement…</p>}
        {erreur && <p role="alert">{erreur}</p>}

        {!chargement && !erreur && candidat && (
          <>
            {/* En-tête de section : bouton "Modifier" aligné à droite. Pas de titre ici (audit
                2026-08-19 : "Informations d'inscription" faisait doublon avec le texte du
                <summary> ci-dessus, "Voir les informations d'inscription complètes", qui reste
                seul responsable du repli/dépli). */}
            {peutModifier && !edition && (
              <div className="informations-inscription__entete">
                <button type="button" onClick={demarrerEdition}>
                  Modifier
                </button>
              </div>
            )}

            <form
              className="informations-inscription__contenu"
              onSubmit={gererEnregistrement}
              // Empêche la touche Entrée dans un champ texte de soumettre le formulaire par
              // inadvertance (nombreux champs texte ci-dessous, mode édition). Seul le bouton
              // "Enregistrer" doit déclencher la soumission.
              onKeyDown={(evenement) => {
                if (evenement.key === 'Enter' && evenement.target.tagName !== 'TEXTAREA') evenement.preventDefault();
              }}
            >
              {!edition ? (
                // ===== VUE LECTURE SEULE — cartes =====
                <>
                  <div className="informations-inscription__rangee informations-inscription__rangee--deux-colonnes">
                    <div className="informations-inscription__carte informations-inscription__carte--identite">
                      <EnteteCarte icone={<IconePersonne />} titre="Identité" />
                      <div className="informations-inscription__identite-corps">
                        {/* Photo d'identité si disponible, icône générique de repli sinon — jamais
                            éditable ici même en mode édition : c'est une pièce justificative (voir
                            CaptureTablette.jsx/VerificationPieces.jsx), pas un champ du formulaire
                            d'inscription. Même route de récupération (obtenirApercuPiece) que
                            "Voir" sur CaptureTablette.jsx. */}
                        {photoIdentiteChargement ? (
                          <div className="informations-inscription__identite-avatar informations-inscription__identite-avatar--generique">
                            <IconePersonne taille={28} />
                          </div>
                        ) : photoIdentiteUrl ? (
                          <button
                            type="button"
                            className="informations-inscription__identite-avatar informations-inscription__photo-identite-bouton"
                            onClick={() => setPhotoAgrandie(true)}
                          >
                            <img
                              src={photoIdentiteUrl}
                              alt="Photo d'identité du candidat — cliquer pour agrandir"
                              className="informations-inscription__identite-avatar-image"
                            />
                          </button>
                        ) : (
                          <div
                            className="informations-inscription__identite-avatar informations-inscription__identite-avatar--generique"
                            title={photoIdentiteErreur || 'Photo non fournie'}
                          >
                            <IconePersonne taille={28} />
                          </div>
                        )}

                        <div className="informations-inscription__identite-details">
                          <p className="informations-inscription__identite-nom">
                            {candidat.prenom} {candidat.nom}
                          </p>
                          <p className="informations-inscription__identite-ligne">
                            {libelle(LIBELLES_CIVILITE, candidat.civilite)} · Né(e) le {formaterDate(candidat.dateNaissance)} à{' '}
                            {candidat.lieuNaissance || '-'}
                          </p>
                          <p className="informations-inscription__identite-ligne">
                            {candidat.nationalite || '-'} · {libelle(LIBELLES_SITUATION_FAMILIALE, candidat.situationFamiliale)}
                          </p>
                          <p className="informations-inscription__identite-ligne">
                            Nom de naissance : {candidat.nomNaissance || '-'}
                          </p>
                          <p className="informations-inscription__identite-meta">
                            Inscrit(e) le {formaterDate(candidat.dateInscription)}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="informations-inscription__carte informations-inscription__carte--coordonnees">
                      <EnteteCarte icone={<IconeCarnetAdresses />} titre="Coordonnées" />
                      <Ligne libelle="Numéro et nom de rue" valeur={coordonnees.adresse} />
                      <Ligne libelle="Code postal" valeur={coordonnees.codePostal} />
                      <Ligne libelle="Ville" valeur={coordonnees.ville} />
                      <Ligne libelle="Téléphone" valeur={coordonnees.telephone} />
                      <div className="informations-inscription__ligne">
                        <span className="informations-inscription__libelle">Email</span>
                        <span className="informations-inscription__valeur informations-inscription__valeur--accent">
                          {coordonnees.email ?? candidat.email ?? '-'}
                        </span>
                      </div>
                      <Ligne libelle="Contact d'urgence" valeur={contactUrgenceValeur} />
                    </div>
                  </div>

                  <div className="informations-inscription__carte informations-inscription__carte--situation">
                    <EnteteCarte icone={<IconeMallette />} titre="Situation professionnelle" />
                    <div className="informations-inscription__grille-deux">
                      <Ligne
                        libelle="Disponibilité"
                        valeur={
                          disponibilites.disponibiliteImmediate
                            ? 'Immédiate'
                            : `Du ${formaterDate(disponibilites.dateDebut)} au ${formaterDate(disponibilites.dateFin)}`
                        }
                      />
                      <Ligne libelle="Type de poste recherché" valeur={libelle(LIBELLES_TYPE_POSTE, disponibilites.typePoste)} />
                      {/* « Êtes-vous étudiant ? » (2026-10-01, dossiers.est_etudiant) : « — » pour un dossier antérieur. */}
                      <Ligne
                        libelle="Étudiant"
                        valeur={candidat?.estEtudiant === true ? 'Oui' : candidat?.estEtudiant === false ? 'Non' : '—'}
                      />
                      <Ligne libelle="Créneaux souhaités" valeur={libelleListe(LIBELLES_CRENEAU, disponibilites.creneaux)} />
                      <Ligne libelle="Langues parlées" valeur={languesValeur} />
                      <Ligne libelle="Comment nous a connu" valeur={commentConnuValeur} />
                      <Ligne libelle="Expérience" valeur={libelle(LIBELLES_EXPERIENCE, disponibilites.experience)} />
                    </div>
                    <Ligne libelle="Jours disponibles" valeur={libelleListe(LIBELLES_JOUR, disponibilites.joursDisponibles)} />
                    <Ligne libelle="Poste(s) recherché(s)" valeur={libelleListe(LIBELLES_POSTE, postesRecherches)} />
                    <Ligne libelle="Lieu de l'expérience" valeur={disponibilites.experienceLieu} />
                    <Ligne libelle="Mission(s) effectuée(s)" valeur={disponibilites.experienceMissions} />

                    <hr className="informations-inscription__separateur" />

                    <h4 className="informations-inscription__sous-titre">Mutuelle d'entreprise</h4>
                    <div className="informations-inscription__grille-deux">
                      <div className="informations-inscription__ligne">
                        <span className="informations-inscription__libelle">CMU-C</span>
                        <BadgePositifNeutre positif={mutuelle.cas1CmuC === 'oui'} libellePositif="Oui" libelleNeutre="Non" />
                      </div>
                      <div className="informations-inscription__ligne">
                        <span className="informations-inscription__libelle">ACS</span>
                        <BadgePositifNeutre positif={mutuelle.cas2Acs === 'oui'} libellePositif="Oui" libelleNeutre="Non" />
                      </div>
                      <div className="informations-inscription__ligne">
                        <span className="informations-inscription__libelle">Mutuelle individuelle</span>
                        <BadgePositifNeutre
                          positif={mutuelle.cas3MutuelleIndividuelle === 'oui'}
                          libellePositif="Oui"
                          libelleNeutre="Non"
                        />
                      </div>
                      <div className="informations-inscription__ligne">
                        <span className="informations-inscription__libelle">Mutuelle collective</span>
                        <BadgePositifNeutre
                          positif={mutuelle.cas4MutuelleCollective === 'oui'}
                          libellePositif="Oui"
                          libelleNeutre="Non"
                        />
                      </div>
                      <div className="informations-inscription__ligne">
                        <span className="informations-inscription__libelle">Dispense certifiée</span>
                        <BadgePositifNeutre
                          positif={Boolean(mutuelle.certificationAucuneDispense)}
                          libellePositif="Oui"
                          libelleNeutre="Non"
                        />
                      </div>
                    </div>

                    <hr className="informations-inscription__separateur" />

                    <h4 className="informations-inscription__sous-titre">Consentement RGPD</h4>
                    <div className="informations-inscription__grille-deux">
                      <div className="informations-inscription__ligne">
                        <span className="informations-inscription__libelle">Autorisation de diffusion des données</span>
                        <BadgePositifNeutre
                          positif={consentementRgpd.consentementDiffusion === 'autorise'}
                          libellePositif="Autorisée"
                          libelleNeutre="Refusée"
                        />
                      </div>
                      <Ligne libelle="Signé le" valeur={formaterDate(consentementRgpd.dateSignature)} />
                    </div>
                  </div>
                </>
              ) : (
                // ===== MODE ÉDITION — formulaire simple, inchangé (voir commentaire d'en-tête du
                // composant : pas de refonte visuelle demandée sur ce mode) =====
                <>
                  <div className="informations-inscription__groupe">
                    <h3>Informations personnelles</h3>

                    <div className="informations-inscription__photo-identite">
                      <span className="informations-inscription__libelle">Photo d'identité</span>
                      {photoIdentiteChargement && <span className="informations-inscription__valeur">Chargement…</span>}
                      {!photoIdentiteChargement && photoIdentiteErreur && (
                        <span className="informations-inscription__valeur" role="alert">
                          {photoIdentiteErreur}
                        </span>
                      )}
                      {!photoIdentiteChargement && !photoIdentiteErreur && photoIdentiteUrl && (
                        <button
                          type="button"
                          className="informations-inscription__photo-identite-bouton"
                          onClick={() => setPhotoAgrandie(true)}
                        >
                          <img
                            src={photoIdentiteUrl}
                            alt="Photo d'identité du candidat — cliquer pour agrandir"
                            className="informations-inscription__photo-identite-vignette"
                          />
                        </button>
                      )}
                      {!photoIdentiteChargement && !photoIdentiteErreur && !photoIdentiteUrl && (
                        <span className="informations-inscription__valeur">Non fournie</span>
                      )}
                    </div>

                    <Champ id="edition-civilite" libelle="Civilité">
                      <select id="edition-civilite" value={brouillon.civilite} onChange={(e) => modifierChamp('civilite')(e.target.value)}>
                        <option value="monsieur">Monsieur</option>
                        <option value="madame">Madame</option>
                      </select>
                    </Champ>
                    <Champ id="edition-nom" libelle="Nom">
                      <input id="edition-nom" required value={brouillon.nom} onChange={(e) => modifierChamp('nom')(e.target.value)} />
                    </Champ>
                    <Champ id="edition-nom-naissance" libelle="Nom de naissance">
                      <input
                        id="edition-nom-naissance"
                        value={brouillon.nomNaissance}
                        onChange={(e) => modifierChamp('nomNaissance')(e.target.value)}
                      />
                    </Champ>
                    <Champ id="edition-prenom" libelle="Prénom">
                      <input id="edition-prenom" required value={brouillon.prenom} onChange={(e) => modifierChamp('prenom')(e.target.value)} />
                    </Champ>
                    <Champ id="edition-date-naissance" libelle="Date de naissance">
                      <input
                        id="edition-date-naissance"
                        type="date"
                        required
                        value={brouillon.dateNaissance}
                        onChange={(e) => modifierChamp('dateNaissance')(e.target.value)}
                      />
                    </Champ>
                    <Champ id="edition-lieu-naissance" libelle="Lieu de naissance">
                      <input
                        id="edition-lieu-naissance"
                        required
                        value={brouillon.lieuNaissance}
                        onChange={(e) => modifierChamp('lieuNaissance')(e.target.value)}
                      />
                    </Champ>
                    <Champ id="edition-nationalite" libelle="Nationalité">
                      <input
                        id="edition-nationalite"
                        required
                        value={brouillon.nationalite}
                        onChange={(e) => modifierChamp('nationalite')(e.target.value)}
                      />
                    </Champ>
                    <Champ id="edition-situation-familiale" libelle="Situation familiale">
                      <select
                        id="edition-situation-familiale"
                        value={brouillon.situationFamiliale}
                        onChange={(e) => modifierChamp('situationFamiliale')(e.target.value)}
                      >
                        {SITUATIONS_FAMILIALES.map((situation) => (
                          <option key={situation.code} value={situation.code}>
                            {situation.libelle}
                          </option>
                        ))}
                      </select>
                    </Champ>
                    <Ligne libelle="Date d'inscription" valeur={formaterDate(candidat.dateInscription)} />
                  </div>

                  <div className="informations-inscription__groupe">
                    <h3>Coordonnées</h3>
                    <Champ id="edition-adresse" libelle="Numéro et nom de rue">
                      <input id="edition-adresse" required value={brouillon.adresse} onChange={(e) => modifierChamp('adresse')(e.target.value)} />
                    </Champ>
                    <Champ id="edition-code-postal" libelle="Code postal">
                      <input
                        id="edition-code-postal"
                        type="text"
                        inputMode="numeric"
                        required
                        value={brouillon.codePostal}
                        onChange={(e) => modifierChamp('codePostal')(e.target.value)}
                      />
                    </Champ>
                    <Champ id="edition-ville" libelle="Ville">
                      <input id="edition-ville" required value={brouillon.ville} onChange={(e) => modifierChamp('ville')(e.target.value)} />
                    </Champ>
                    <Champ id="edition-telephone" libelle="Téléphone">
                      <input
                        id="edition-telephone"
                        type="tel"
                        required
                        placeholder="06 12 34 56 78"
                        value={brouillon.telephone}
                        onChange={(e) => modifierChamp('telephone')(e.target.value)}
                      />
                    </Champ>
                    <Champ id="edition-email" libelle="Email">
                      <input
                        id="edition-email"
                        type="email"
                        required
                        value={brouillon.email}
                        onChange={(e) => modifierChamp('email')(e.target.value)}
                      />
                    </Champ>
                    <Champ id="edition-contact-urgence-nom" libelle="Contact d'urgence">
                      <input
                        id="edition-contact-urgence-nom"
                        required
                        value={brouillon.contactUrgenceNom}
                        onChange={(e) => modifierChamp('contactUrgenceNom')(e.target.value)}
                      />
                    </Champ>
                    <Champ id="edition-contact-urgence-telephone" libelle="Téléphone du contact d'urgence">
                      <input
                        id="edition-contact-urgence-telephone"
                        type="tel"
                        required
                        placeholder="06 12 34 56 78"
                        value={brouillon.contactUrgenceTelephone}
                        onChange={(e) => modifierChamp('contactUrgenceTelephone')(e.target.value)}
                      />
                    </Champ>
                  </div>

                  <div className="informations-inscription__groupe">
                    <h3>Situation professionnelle</h3>
                    <Champ id="edition-disponibilite-immediate" libelle="Disponibilité immédiate">
                      <input
                        id="edition-disponibilite-immediate"
                        type="checkbox"
                        checked={brouillon.disponibiliteImmediate}
                        onChange={(e) => modifierChamp('disponibiliteImmediate')(e.target.checked)}
                      />
                    </Champ>
                    {!brouillon.disponibiliteImmediate && (
                      <>
                        <Champ id="edition-date-debut" libelle="Disponible à partir du">
                          <input
                            id="edition-date-debut"
                            type="date"
                            required
                            value={brouillon.dateDebut}
                            onChange={(e) => modifierChamp('dateDebut')(e.target.value)}
                          />
                        </Champ>
                        <ErreurChamp erreursChamps={erreursChamps} cle="dateDebut" />
                        <Champ id="edition-date-fin" libelle="Jusqu'au">
                          <input
                            id="edition-date-fin"
                            type="date"
                            required
                            value={brouillon.dateFin}
                            onChange={(e) => modifierChamp('dateFin')(e.target.value)}
                          />
                        </Champ>
                        <ErreurChamp erreursChamps={erreursChamps} cle="dateFin" />
                      </>
                    )}
                    <Champ id="edition-type-poste" libelle="Type de poste recherché">
                      <select
                        id="edition-type-poste"
                        value={brouillon.typePoste}
                        onChange={(e) => modifierChamp('typePoste')(e.target.value)}
                      >
                        <option value="hotel">Hôtel</option>
                        <option value="bureau">Bureau</option>
                      </select>
                    </Champ>
                    <Champ id="edition-creneaux" libelle="Créneaux souhaités">
                      <GroupeCases
                        options={brouillon.typePoste === 'bureau' ? CRENEAUX_BUREAU : CRENEAUX_HOTEL}
                        libelles={LIBELLES_CRENEAU}
                        valeurs={brouillon.creneaux}
                        onChange={modifierChamp('creneaux')}
                      />
                    </Champ>
                    <ErreurChamp erreursChamps={erreursChamps} cle="creneaux" />
                    <Champ id="edition-jours" libelle="Jours disponibles">
                      <GroupeCases options={JOURS} libelles={LIBELLES_JOUR} valeurs={brouillon.joursDisponibles} onChange={modifierChamp('joursDisponibles')} />
                    </Champ>
                    <ErreurChamp erreursChamps={erreursChamps} cle="joursDisponibles" />
                    <Champ id="edition-langues" libelle="Langues parlées">
                      <GroupeCases options={LANGUES} libelles={LIBELLES_LANGUE} valeurs={brouillon.languesParlees} onChange={modifierChamp('languesParlees')} />
                    </Champ>
                    {brouillon.languesParlees.includes('autre') && (
                      <Champ id="edition-autre-langue" libelle="Précision langue">
                        <input
                          id="edition-autre-langue"
                          required
                          value={brouillon.autreLanguePrecision}
                          onChange={(e) => modifierChamp('autreLanguePrecision')(e.target.value)}
                        />
                      </Champ>
                    )}
                    <Champ id="edition-postes" libelle="Poste(s) recherché(s)">
                      <GroupeCases
                        options={brouillon.typePoste === 'bureau' ? POSTES_BUREAU : POSTES_HOTEL}
                        libelles={LIBELLES_POSTE}
                        valeurs={brouillon.typePoste === 'bureau' ? brouillon.posteBureau : brouillon.posteHotel}
                        onChange={modifierChamp(brouillon.typePoste === 'bureau' ? 'posteBureau' : 'posteHotel')}
                      />
                    </Champ>
                    <ErreurChamp erreursChamps={erreursChamps} cle={brouillon.typePoste === 'bureau' ? 'posteBureau' : 'posteHotel'} />
                    <Champ id="edition-experience" libelle="Expérience">
                      <select
                        id="edition-experience"
                        value={brouillon.experience}
                        onChange={(e) => modifierChamp('experience')(e.target.value)}
                      >
                        {EXPERIENCE.map((code) => (
                          <option key={code} value={code}>
                            {LIBELLES_EXPERIENCE[code]}
                          </option>
                        ))}
                      </select>
                    </Champ>
                    {brouillon.experience !== 'aucune' && (
                      <>
                        <Champ id="edition-experience-lieu" libelle="Lieu de l'expérience">
                          <input
                            id="edition-experience-lieu"
                            required
                            value={brouillon.experienceLieu}
                            onChange={(e) => modifierChamp('experienceLieu')(e.target.value)}
                          />
                        </Champ>
                        <ErreurChamp erreursChamps={erreursChamps} cle="experienceLieu" />
                        <Champ id="edition-experience-missions" libelle="Mission(s) effectuée(s)">
                          <textarea
                            id="edition-experience-missions"
                            rows={3}
                            required
                            value={brouillon.experienceMissions}
                            onChange={(e) => modifierChamp('experienceMissions')(e.target.value)}
                          />
                        </Champ>
                        <ErreurChamp erreursChamps={erreursChamps} cle="experienceMissions" />
                      </>
                    )}
                    <Champ id="edition-comment-connu" libelle="Comment nous a connu">
                      <select
                        id="edition-comment-connu"
                        value={brouillon.commentConnu}
                        onChange={(e) => modifierChamp('commentConnu')(e.target.value)}
                      >
                        {Object.entries(LIBELLES_COMMENT_CONNU).map(([code, libelleOption]) => (
                          <option key={code} value={code}>
                            {libelleOption}
                          </option>
                        ))}
                      </select>
                    </Champ>
                    {['internet', 'autre'].includes(brouillon.commentConnu) && (
                      <Champ id="edition-comment-connu-precision" libelle="Précision">
                        <input
                          id="edition-comment-connu-precision"
                          required
                          value={brouillon.commentConnuPrecision}
                          onChange={(e) => modifierChamp('commentConnuPrecision')(e.target.value)}
                        />
                      </Champ>
                    )}
                  </div>

                  <div className="informations-inscription__groupe">
                    <h3>Mutuelle d'entreprise</h3>
                    {[
                      ['cas1CmuC', 'CMU-C'],
                      ['cas2Acs', 'ACS'],
                      ['cas3MutuelleIndividuelle', 'Mutuelle individuelle'],
                      ['cas4MutuelleCollective', 'Mutuelle collective'],
                    ].map(([champ, intitule]) => (
                      <Champ key={champ} id={`edition-${champ}`} libelle={intitule}>
                        <select id={`edition-${champ}`} value={brouillon[champ]} onChange={(e) => modifierChamp(champ)(e.target.value)}>
                          <option value="non">Non</option>
                          <option value="oui">Oui</option>
                        </select>
                      </Champ>
                    ))}
                    <Champ id="edition-certification" libelle="Dispense certifiée">
                      <input
                        id="edition-certification"
                        type="checkbox"
                        checked={brouillon.certificationAucuneDispense}
                        onChange={(e) => modifierChamp('certificationAucuneDispense')(e.target.checked)}
                      />
                    </Champ>
                  </div>

                  <div className="informations-inscription__groupe">
                    <h3>Consentement RGPD</h3>
                    <Ligne
                      libelle="Autorisation de diffusion des données"
                      valeur={libelle(LIBELLES_CONSENTEMENT_DIFFUSION, consentementRgpd.consentementDiffusion)}
                    />
                    <Ligne libelle="Signé le" valeur={formaterDate(consentementRgpd.dateSignature)} />
                  </div>
                </>
              )}

              {/* Pièces jointes — inchangée entre lecture seule et édition (jamais éditable ici,
                  voir commentaire d'en-tête du composant), toujours affichée après les cartes/
                  groupes ci-dessus quel que soit le mode. */}
              <div className="informations-inscription__carte informations-inscription__carte--pieces">
                <EnteteCarte icone={<IconeTrombone />} titre="Pièces jointes">
                  <span className="informations-inscription__pieces-compteur">
                    {pieces.length} pièce{pieces.length > 1 ? 's' : ''} reçue{pieces.length > 1 ? 's' : ''}
                  </span>
                </EnteteCarte>
                {pieces.length === 0 && (
                  <p className="informations-inscription__vide">Aucune pièce reçue pour ce dossier.</p>
                )}
                {pieces.length > 0 && (
                  // Liste verticale à une seule colonne, une pièce par ligne (audit 2026-08-19,
                  // retour sur la variante à colonnes internes multiples : nom tronqué en
                  // ellipsis, statut/date qui se rapprochaient trop du nom, alignement peu clair
                  // dès que le nombre de colonnes changeait selon la largeur disponible). `<li>`
                  // en display: contents : ses 4 enfants (nom/statut/date/action "Voir")
                  // participent directement aux 4 colonnes du <ul> ci-dessous, plutôt que d'être
                  // des cellules indépendantes par ligne — c'est ce qui garantit que
                  // statut/date/Voir tombent exactement à la même position horizontale sur TOUTES
                  // les lignes, y compris quand un nom de pièce est plus long que les autres.
                  <ul className="informations-inscription__pieces">
                    {pieces.map((piece) => (
                      <li key={piece.id} className="informations-inscription__piece">
                        {/* Pas de troncature : un nom long (ex. "Carte d'identité ou Carte de
                            séjour") passe à la ligne plutôt que d'être coupé (white-space:
                            normal côté .css, voir son commentaire). */}
                        <span className="informations-inscription__piece-nom">{piece.type_piece_libelle}</span>
                        <span className="informations-inscription__piece-date">{formaterDate(piece.date_upload)}</span>
                        <span className="informations-inscription__piece-statut">
                          <StatutBadge
                            libelle={piece.statut_verification === 'orpheline' ? LIBELLE_PIECE_ORPHELINE : '✓ Reçue'}
                            variante={piece.statut_verification === 'orpheline' ? 'alerte' : 'succes'}
                          />
                        </span>
                        {/* Ouvre PanneauApercuPiece (voir plus bas) — même mécanisme que le
                            bouton "Voir" de CaptureTablette.jsx (composant désormais partagé),
                            réutilisé tel quel plutôt que reconstruit. Consultation uniquement :
                            aucune suppression/remplacement proposé depuis cette section en
                            lecture seule, contrairement à l'écran de capture. */}
                        <button
                          type="button"
                          className="informations-inscription__piece-action"
                          onClick={() => setPieceEnApercu(piece)}
                        >
                          Voir
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {pieceEnApercu && (
                  <PanneauApercuPiece
                    dossierId={dossierId}
                    libelle={pieceEnApercu.type_piece_libelle}
                    piece={pieceEnApercu}
                    onFermer={() => setPieceEnApercu(null)}
                  />
                )}
              </div>

              {edition && (
                <div className="informations-inscription__actions-edition">
                  {erreurEnregistrement && (
                    <div role="alert" className="informations-inscription__erreur-globale">
                      <p>{erreurEnregistrement}</p>
                      {/* Détail complet (voir erreursChamps) même pour les champs déjà signalés au
                          plus près d'eux (créneaux, dates, postes...) : un agent qui n'a pas
                          remarqué l'indication en ligne au milieu d'un long formulaire retrouve
                          quand même la liste ici, avant de renvoyer inutilement la même erreur. */}
                      {Object.keys(erreursChamps).length > 0 && (
                        <ul>
                          {Object.entries(erreursChamps).map(([champ, messages]) => (
                            <li key={champ}>
                              <strong>{LIBELLES_CHAMPS_ERREUR[champ] ?? champ}</strong> : {messages.join(' ')}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  <button type="submit" disabled={enregistrementEnCours}>
                    {enregistrementEnCours ? 'Enregistrement…' : 'Enregistrer'}
                  </button>
                  <button type="button" onClick={annulerEdition} disabled={enregistrementEnCours}>
                    Annuler
                  </button>
                </div>
              )}
            </form>
          </>
        )}
      </details>

      {photoAgrandie && photoIdentiteUrl && (
        <div
          className="informations-inscription__photo-identite-overlay"
          role="dialog"
          aria-label="Photo d'identité en grand"
          onClick={() => setPhotoAgrandie(false)}
        >
          <img src={photoIdentiteUrl} alt="Photo d'identité du candidat" />
          <button type="button" onClick={() => setPhotoAgrandie(false)}>
            Fermer
          </button>
        </div>
      )}
    </section>
  );
}
