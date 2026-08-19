import { useEffect, useRef, useState } from 'react';
import { obtenirInscriptionComplete, modifierInscription } from '../../services/dossierService';
import { listerPiecesJustificatives, obtenirApercuPiece } from '../../services/pieceJustificativeService';
import { useSession } from '../auth/useSession';
import PanneauApercuPiece from '../pieceJustificative/PanneauApercuPiece';
import './InformationsInscription.css';

// Code de type de pièce (voir typesPiecesConfig.accecit.js, backend/scripts/seedTypesPieces.js)
// — pièce obligatoire, capturée uniquement à la caméra (jamais un fichier existant, voir
// CaptureTablette.jsx). Dupliqué ici tel quel plutôt que partagé (deux fichiers, même convention
// que le reste du projet).
const CODE_PHOTO_IDENTITE = 'photo_identite';

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

// Rôles autorisés à corriger une erreur de saisie via le bouton "Modifier" (CLAUDE.md, demande
// explicite du 2026-08-18 : Admin + Accueil/Coordination uniquement, ni Recruteur ni Formateur/
// Inspecteur) — restriction d'AFFICHAGE seulement, la vraie garde est côté back
// (dossiers.routes.js, ROLES_MODIFICATION_INSCRIPTION) : un appel API direct depuis un autre rôle
// serait refusé indépendamment de ce masquage.
const ROLES_MODIFICATION_INSCRIPTION = ['admin', 'accueil_coordination'];

// Mêmes libellés que les blocs du formulaire d'inscription (BlocInfosPerso.jsx,
// BlocDisponibilites.jsx, BlocMutuelle.jsx, BlocConsentementRGPD.jsx) — dupliqués plutôt que
// partagés, même convention que le reste du projet (voir CLAUDE.md, conventions du projet, et
// libellePoste répété tel quel dans chaque page back-office).
const LIBELLES_CIVILITE = { monsieur: 'Monsieur', madame: 'Madame' };
// '6h-9h'/'9h-18h'/'18h-21h' (créneaux bureau) ajoutés ici en plus de matin/midi/soir (créneaux
// hôtel, seuls déjà présents) : mêmes codes que leur libellé (déjà lisibles tels quels, voir
// commit "Ajoute les créneaux bureau") — sans cet ajout, un dossier bureau retombait sur le code
// brut en lecture seule (libelle() ci-dessous, fallback déjà en place) et le formulaire d'édition
// ci-dessous n'aurait eu aucun libellé à afficher pour ses cases à cocher.
const LIBELLES_CRENEAU = {
  matin: 'Matin',
  midi: 'Midi',
  soir: 'Soir',
  '6h-9h': '6h-9h',
  '9h-18h': '9h-18h',
  '18h-21h': '18h-21h',
};
const CRENEAUX_HOTEL = ['matin', 'midi', 'soir'];
const CRENEAUX_BUREAU = ['6h-9h', '9h-18h', '18h-21h'];
const LIBELLES_JOUR = {
  lundi: 'Lundi',
  mardi: 'Mardi',
  mercredi: 'Mercredi',
  jeudi: 'Jeudi',
  vendredi: 'Vendredi',
  samedi: 'Samedi',
  dimanche: 'Dimanche',
};
const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const LIBELLES_LANGUE = { francais: 'Français', anglais: 'Anglais', autre: 'Autre' };
const LANGUES = ['francais', 'anglais', 'autre'];
const LIBELLES_POSTE = {
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
const POSTES_BUREAU = ['nettoyage', 'vitrerie', 'machiniste', 'chef_equipe', 'autres'];
const POSTES_HOTEL = ['femme_valet_chambre', 'cafetier', 'equipier', 'gouvernant'];
const LIBELLES_TYPE_POSTE = { bureau: 'Bureau', hotel: 'Hôtel' };
const LIBELLES_COMMENT_CONNU = {
  bouche_a_oreille: 'Bouche à oreille',
  internet: 'Internet',
  cooptation: 'Cooptation',
  autre: 'Autre',
};
const SITUATIONS_FAMILIALES = [
  { code: 'celibataire', libelle: 'Célibataire' },
  { code: 'marie', libelle: 'Marié(e)' },
  { code: 'pacse', libelle: 'Pacsé(e)' },
  { code: 'divorce', libelle: 'Divorcé(e)' },
  { code: 'veuf', libelle: 'Veuf/Veuve' },
];
const LIBELLES_OUI_NON = { oui: 'Oui', non: 'Non' };
const LIBELLES_CONSENTEMENT_DIFFUSION = { autorise: 'Autorisée', refuse: 'Refusée' };
// "En attente"/"Validée"/"Rejetée" retirés (audit 2026-08-19, même correctif que Validation.jsx) :
// pieces_justificatives.statut_verification n'est modifiable par aucun écran de l'app (le PATCH
// correspondant existe côté back mais n'est appelé nulle part côté front) — ce badge restait donc
// figé sur "En attente" pour toute pièce, quel que soit son contenu réel. 'orpheline' (fichier
// disparu du stockage, détecté par le système) reste affiché : signal fiable, pas un jugement
// humain jamais fait. Toute autre pièce listée ici est simplement "Reçue" (chaque ligne vient de
// listerPiecesJustificatives, donc déjà présente — même donnée que dejaCapturee sur
// CaptureTablette.jsx).
const LIBELLE_PIECE_ORPHELINE = 'À recapturer (fichier perdu)';

function libelle(dictionnaire, code) {
  if (!code) return '-';
  return dictionnaire[code] ?? code;
}

function libelleListe(dictionnaire, codes) {
  if (!codes || codes.length === 0) return '-';
  return codes.map((code) => libelle(dictionnaire, code)).join(', ');
}

function formaterDate(valeur) {
  if (!valeur) return '-';
  return FORMAT_DATE.format(new Date(valeur));
}

// 'AAAA-MM-JJ' pour un <input type="date"> — simple troncature de la chaîne ISO déjà renvoyée par
// le back (candidat.dateNaissance en timestamptz, disponibilites.dateDebut/dateFin déjà en
// 'AAAA-MM-JJ' pur, voir BlocDisponibilites.schema.js), jamais un nouveau new Date(...) reformaté
// : éviterait un décalage d'un jour selon le fuseau du navigateur (contrairement à formaterDate
// ci-dessus, purement informatif, l'input doit rester la date EXACTE stockée).
function versDateInput(valeur) {
  return valeur ? String(valeur).slice(0, 10) : '';
}

function bascule(tableau, valeur) {
  return tableau.includes(valeur) ? tableau.filter((v) => v !== valeur) : [...tableau, valeur];
}

// Une ligne "libellé : valeur" — évite de répéter la même structure pour chacun des ~25 champs
// affichés ci-dessous.
function Ligne({ libelle: intitule, valeur }) {
  return (
    <div className="informations-inscription__ligne">
      <span className="informations-inscription__libelle">{intitule}</span>
      <span className="informations-inscription__valeur">{valeur || '-'}</span>
    </div>
  );
}

// Champ de saisie du formulaire d'édition (voir brouillon ci-dessous) — même structure visuelle
// que Ligne (libellé à gauche, valeur/contrôle à droite) pour que passer en édition ne redessine
// pas toute la mise en page.
function Champ({ id, libelle: intitule, children }) {
  return (
    <label className="informations-inscription__ligne informations-inscription__champ" htmlFor={id}>
      <span className="informations-inscription__libelle">{intitule}</span>
      {children}
    </label>
  );
}

// Groupe de cases à cocher (créneaux/jours/langues/postes) — rendu compact, une case par valeur
// possible, même patron partout où il est utilisé ci-dessous (pas de sous-composant par famille de
// codes, un seul générique suffit).
function GroupeCases({ options, libelles, valeurs, onChange }) {
  return (
    <div className="informations-inscription__cases">
      {options.map((code) => (
        <label key={code}>
          <input
            type="checkbox"
            checked={valeurs.includes(code)}
            onChange={() => onChange(bascule(valeurs, code))}
          />
          {libelle(libelles, code)}
        </label>
      ))}
    </div>
  );
}

// Message(s) d'erreur d'un champ précis (voir erreursChamps, `details.fieldErrors` du 400 backend)
// — affiché juste sous le contrôle concerné plutôt que seulement dans le bandeau global, quand un
// emplacement dédié existe pour ce champ. `null` si ce champ n'a pas d'erreur, pour ne rien
// insérer dans le flux (pas même un conteneur vide).
function ErreurChamp({ erreursChamps, cle }) {
  const messages = erreursChamps[cle];
  if (!messages || messages.length === 0) return null;
  return (
    <p role="alert" className="informations-inscription__erreur-champ">
      {messages.join(' ')}
    </p>
  );
}

// Libellés pour le récapitulatif du bandeau global (voir son rendu, plus bas) — un champ du
// schéma de modification (dossierService.js, back) absent d'ici retombe sur son nom brut plutôt
// que d'échouer, même patron que libelle()/libellePoste ailleurs dans ce fichier.
const LIBELLES_CHAMPS_ERREUR = {
  civilite: 'Civilité',
  nom: 'Nom',
  nomNaissance: 'Nom de naissance',
  prenom: 'Prénom',
  dateNaissance: 'Date de naissance',
  lieuNaissance: 'Lieu de naissance',
  nationalite: 'Nationalité',
  situationFamiliale: 'Situation familiale',
  adresse: 'Adresse',
  telephone: 'Téléphone',
  email: 'Email',
  contactUrgenceNom: "Contact d'urgence",
  contactUrgenceTelephone: "Téléphone du contact d'urgence",
  dateDebut: 'Disponible à partir du',
  dateFin: "Jusqu'au",
  creneaux: 'Créneaux souhaités',
  joursDisponibles: 'Jours disponibles',
  languesParlees: 'Langues parlées',
  autreLanguePrecision: 'Précision langue',
  typePoste: 'Type de poste recherché',
  posteBureau: 'Poste(s) recherché(s)',
  posteHotel: 'Poste(s) recherché(s)',
  commentConnu: 'Comment nous a connu',
  commentConnuPrecision: 'Précision',
  certificationAucuneDispense: 'Dispense certifiée',
};

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
// Bouton "Modifier" (2026-08-18, CLAUDE.md) : bascule Informations personnelles/Coordonnées/
// Situation professionnelle/Mutuelle en formulaire, visible uniquement Admin/Accueil-Coordination
// (voir ROLES_MODIFICATION_INSCRIPTION) — Consentement RGPD, Pièces jointes et Photo d'identité
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
  // `pieces` (dossier en cours, pas encore capturée) : distinct de chargement/erreur, sert de
  // condition "Non fournie" dans le rendu.
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

  const peutModifier = ROLES_MODIFICATION_INSCRIPTION.includes(utilisateur?.roleCode);

  // Révoque l'URL locale (blob) au démontage ou si elle change — même précaution que
  // CaptureTablette.jsx (PanneauApercuPiece) pour ne pas fuiter de mémoire.
  useEffect(() => {
    return () => {
      if (photoIdentiteUrl) URL.revokeObjectURL(photoIdentiteUrl);
    };
  }, [photoIdentiteUrl]);

  const gererOuverture = (evenement) => {
    if (!evenement.target.open || inscription) return;
    setChargement(true);
    setErreur(null);
    Promise.all([obtenirInscriptionComplete(dossierId), listerPiecesJustificatives(dossierId)])
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
  // demarrerEdition ci-dessus pour le chargement initial. typePostePrecedentRef (déclaré plus haut,
  // avec les autres états) initialisé/mis à jour par demarrerEdition (pas ici) pour ne jamais vider
  // creneaux au tout premier rendu d'une session d'édition.
  useEffect(() => {
    if (!brouillon) return;
    if (typePostePrecedentRef.current != null && typePostePrecedentRef.current !== brouillon.typePoste) {
      setBrouillon((precedent) => (precedent ? { ...precedent, creneaux: [] } : precedent));
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

  return (
    <section className="informations-inscription">
      <details onToggle={gererOuverture}>
        <summary>Voir les informations d'inscription complètes</summary>

        {chargement && <p>Chargement…</p>}
        {erreur && <p role="alert">{erreur}</p>}

        {!chargement && !erreur && candidat && (
          <>
            {peutModifier && !edition && (
              <div className="informations-inscription__actions">
                <button type="button" onClick={demarrerEdition}>
                  Modifier
                </button>
              </div>
            )}

            <form
              className="informations-inscription__contenu"
              onSubmit={gererEnregistrement}
              // Empêche la touche Entrée dans un champ texte de soumettre le formulaire par
              // inadvertance (nombreux champs texte ci-dessous) — seul le bouton "Enregistrer"
              // doit déclencher la soumission.
              onKeyDown={(evenement) => {
                if (evenement.key === 'Enter' && evenement.target.tagName !== 'TEXTAREA') evenement.preventDefault();
              }}
            >
              <div className="informations-inscription__groupe informations-inscription__groupe--personnelles">
                <h3>Informations personnelles</h3>

                {/* Vignette cliquable, même route de récupération (obtenirApercuPiece) que "Voir"
                    sur CaptureTablette.jsx — voir son commentaire d'en-tête pour le détail du
                    stockage. "Non fournie" plutôt qu'un espace vide/une erreur tant que la pièce
                    (obligatoire mais capturée par l'accueil, pas par le candidat lui-même) n'a pas
                    encore été prise. Jamais éditable ici, même en mode édition : c'est une pièce
                    justificative (voir CaptureTablette.jsx/VerificationPieces.jsx), pas un champ
                    du formulaire d'inscription. */}
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

                {!edition ? (
                  <>
                    <Ligne libelle="Civilité" valeur={libelle(LIBELLES_CIVILITE, candidat.civilite)} />
                    <Ligne libelle="Nom" valeur={candidat.nom} />
                    <Ligne libelle="Nom de naissance" valeur={candidat.nomNaissance} />
                    <Ligne libelle="Prénom" valeur={candidat.prenom} />
                    <Ligne libelle="Date de naissance" valeur={formaterDate(candidat.dateNaissance)} />
                    <Ligne libelle="Lieu de naissance" valeur={candidat.lieuNaissance} />
                    <Ligne libelle="Nationalité" valeur={candidat.nationalite} />
                    <Ligne libelle="Situation familiale" valeur={candidat.situationFamiliale} />
                    <Ligne libelle="Date d'inscription" valeur={formaterDate(candidat.dateInscription)} />
                  </>
                ) : (
                  <>
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
                  </>
                )}
              </div>

              <div className="informations-inscription__groupe informations-inscription__groupe--coordonnees">
                <h3>Coordonnées</h3>
                {!edition ? (
                  <>
                    <Ligne libelle="Adresse" valeur={coordonnees.adresse} />
                    <Ligne libelle="Téléphone" valeur={coordonnees.telephone} />
                    <Ligne libelle="Email" valeur={coordonnees.email ?? candidat.email} />
                    <Ligne libelle="Contact d'urgence" valeur={coordonnees.contactUrgenceNom} />
                    <Ligne libelle="Téléphone du contact d'urgence" valeur={coordonnees.contactUrgenceTelephone} />
                  </>
                ) : (
                  <>
                    <Champ id="edition-adresse" libelle="Adresse">
                      <input id="edition-adresse" required value={brouillon.adresse} onChange={(e) => modifierChamp('adresse')(e.target.value)} />
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
                  </>
                )}
              </div>

              <div className="informations-inscription__groupe informations-inscription__groupe--situation">
                <h3>Situation professionnelle</h3>
                {!edition ? (
                  <>
                    <Ligne
                      libelle="Disponibilité"
                      valeur={
                        disponibilites.disponibiliteImmediate
                          ? 'Immédiate'
                          : `Du ${formaterDate(disponibilites.dateDebut)} au ${formaterDate(disponibilites.dateFin)}`
                      }
                    />
                    <Ligne libelle="Créneaux souhaités" valeur={libelleListe(LIBELLES_CRENEAU, disponibilites.creneaux)} />
                    <Ligne
                      libelle="Jours disponibles"
                      valeur={libelleListe(LIBELLES_JOUR, disponibilites.joursDisponibles)}
                    />
                    <Ligne libelle="Langues parlées" valeur={libelleListe(LIBELLES_LANGUE, disponibilites.languesParlees)} />
                    {disponibilites.autreLanguePrecision && (
                      <Ligne libelle="Précision langue" valeur={disponibilites.autreLanguePrecision} />
                    )}
                    <Ligne
                      libelle="Type de poste recherché"
                      valeur={libelle(LIBELLES_TYPE_POSTE, disponibilites.typePoste)}
                    />
                    <Ligne libelle="Poste(s) recherché(s)" valeur={libelleListe(LIBELLES_POSTE, postesRecherches)} />
                    <Ligne
                      libelle="Comment nous a connu"
                      valeur={libelle(LIBELLES_COMMENT_CONNU, disponibilites.commentConnu)}
                    />
                    {disponibilites.commentConnuPrecision && (
                      <Ligne libelle="Précision" valeur={disponibilites.commentConnuPrecision} />
                    )}
                  </>
                ) : (
                  <>
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
                  </>
                )}
              </div>

              <div className="informations-inscription__groupe informations-inscription__groupe--mutuelle">
                <h3>Mutuelle d'entreprise</h3>
                {!edition ? (
                  <>
                    <Ligne libelle="CMU-C" valeur={libelle(LIBELLES_OUI_NON, mutuelle.cas1CmuC)} />
                    <Ligne libelle="ACS" valeur={libelle(LIBELLES_OUI_NON, mutuelle.cas2Acs)} />
                    <Ligne
                      libelle="Mutuelle individuelle"
                      valeur={libelle(LIBELLES_OUI_NON, mutuelle.cas3MutuelleIndividuelle)}
                    />
                    <Ligne
                      libelle="Mutuelle collective"
                      valeur={libelle(LIBELLES_OUI_NON, mutuelle.cas4MutuelleCollective)}
                    />
                    <Ligne libelle="Dispense certifiée" valeur={mutuelle.certificationAucuneDispense ? 'Oui' : 'Non'} />
                  </>
                ) : (
                  <>
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
                  </>
                )}
              </div>

              <div className="informations-inscription__groupe informations-inscription__groupe--consentement">
                <h3>Consentement RGPD</h3>
                <Ligne
                  libelle="Autorisation de diffusion des données"
                  valeur={libelle(LIBELLES_CONSENTEMENT_DIFFUSION, consentementRgpd.consentementDiffusion)}
                />
                {consentementRgpd.dateSignature && (
                  <Ligne libelle="Signé le" valeur={formaterDate(consentementRgpd.dateSignature)} />
                )}
              </div>

              <div className="informations-inscription__groupe informations-inscription__groupe--pieces">
                <h3>Pièces jointes</h3>
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
                        <span className="informations-inscription__piece-statut">
                          {piece.statut_verification === 'orpheline' ? LIBELLE_PIECE_ORPHELINE : '✓ Reçue'}
                        </span>
                        <span className="informations-inscription__piece-date">{formaterDate(piece.date_upload)}</span>
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
