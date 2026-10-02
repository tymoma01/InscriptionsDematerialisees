// Libellés et petits composants d'affichage de la fiche « Informations d'inscription »
// (InformationsInscription.jsx).
import StatutBadge from '../workflow/StatutBadge';

// Code de type de pièce (voir table types_pieces, backend/scripts/seedTypesPieces.js)
// — pièce obligatoire, capturée uniquement à la caméra (jamais un fichier existant, voir
// CaptureTablette.jsx). Dupliqué ici tel quel plutôt que partagé (deux fichiers, même convention
// que le reste du projet).
export const CODE_PHOTO_IDENTITE = 'photo_identite';

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

// Rôles autorisés à corriger une erreur de saisie via le bouton "Modifier" (CLAUDE.md, demande
// explicite du 2026-08-18 : Admin + Accueil/Coordination uniquement, ni Recruteur ni Formateur/
// Inspecteur) — restriction d'AFFICHAGE seulement, la vraie garde est côté back
// (dossiers.routes.js, modificationInscription) : un appel API direct depuis un autre rôle
// serait refusé indépendamment de ce masquage.

// Mêmes libellés que les blocs du formulaire d'inscription (BlocInfosPerso.jsx,
// BlocDisponibilites.jsx, BlocMutuelle.jsx, BlocConsentementRGPD.jsx) — dupliqués plutôt que
// partagés, même convention que le reste du projet (voir CLAUDE.md, conventions du projet, et
// libellePoste répété tel quel dans chaque page back-office).
export const LIBELLES_CIVILITE = { monsieur: 'Monsieur', madame: 'Madame' };
// '6h-9h'/'9h-18h'/'18h-21h' (créneaux bureau) ajoutés ici en plus de matin/midi/soir (créneaux
// hôtel, seuls déjà présents) : mêmes codes que leur libellé (déjà lisibles tels quels, voir
// commit "Ajoute les créneaux bureau") — sans cet ajout, un dossier bureau retombait sur le code
// brut en lecture seule (libelle() ci-dessous, fallback déjà en place) et le formulaire d'édition
// ci-dessous n'aurait eu aucun libellé à afficher pour ses cases à cocher.
export const LIBELLES_CRENEAU = {
  matin: 'Matin',
  midi: 'Midi',
  soir: 'Soir',
  '6h-9h': '6h-9h',
  '9h-18h': '9h-18h',
  '18h-21h': '18h-21h',
};
export const CRENEAUX_HOTEL = ['matin', 'midi', 'soir'];
export const CRENEAUX_BUREAU = ['6h-9h', '9h-18h', '18h-21h'];
export const LIBELLES_JOUR = {
  lundi: 'Lundi',
  mardi: 'Mardi',
  mercredi: 'Mercredi',
  jeudi: 'Jeudi',
  vendredi: 'Vendredi',
  samedi: 'Samedi',
  dimanche: 'Dimanche',
};
export const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
export const LIBELLES_LANGUE = { francais: 'Français', anglais: 'Anglais', autre: 'Autre' };
export const LANGUES = ['francais', 'anglais', 'autre'];
export const LIBELLES_TYPE_POSTE = { bureau: 'Bureau', hotel: 'Hôtel' };
export const LIBELLES_COMMENT_CONNU = {
  bouche_a_oreille: 'Bouche à oreille',
  internet: 'Internet',
  cooptation: 'Cooptation',
  autre: 'Autre',
};
export const LIBELLES_EXPERIENCE = {
  aucune: "Pas d'expérience",
  plus_6_mois: 'Plus de 6 mois',
  plus_2_ans: 'Plus de 2 ans',
  plus_5_ans: 'Plus de 5 ans',
};
export const EXPERIENCE = ['aucune', 'plus_6_mois', 'plus_2_ans', 'plus_5_ans'];
export const SITUATIONS_FAMILIALES = [
  { code: 'celibataire', libelle: 'Célibataire' },
  { code: 'marie', libelle: 'Marié(e)' },
  { code: 'pacse', libelle: 'Pacsé(e)' },
  { code: 'divorce', libelle: 'Divorcé(e)' },
  { code: 'veuf', libelle: 'Veuf/Veuve' },
];
// Dérivé de SITUATIONS_FAMILIALES ci-dessus (liste utilisée par le <select> d'édition) — même
// forme {code: libelle} que les autres dictionnaires de ce fichier, pour rester utilisable par
// libelle()/libelleListe() en lecture seule sans dupliquer les libellés une seconde fois à la main.
export const LIBELLES_SITUATION_FAMILIALE = Object.fromEntries(
  SITUATIONS_FAMILIALES.map((situation) => [situation.code, situation.libelle]),
);
export const LIBELLES_CONSENTEMENT_DIFFUSION = { autorise: 'Autorisée', refuse: 'Refusée' };
// "En attente"/"Validée"/"Rejetée" retirés (audit 2026-08-19, même correctif que Validation.jsx) :
// pieces_justificatives.statut_verification n'est modifiable par aucun écran de l'app (le PATCH
// correspondant existe côté back mais n'est appelé nulle part côté front) — ce badge restait donc
// figé sur "En attente" pour toute pièce, quel que soit son contenu réel. 'orpheline' (fichier
// disparu du stockage, détecté par le système) reste affiché : signal fiable, pas un jugement
// humain jamais fait. Toute autre pièce listée ici est simplement "Reçue" (chaque ligne vient de
// listerPiecesJustificatives, donc déjà présente — même donnée que dejaCapturee sur
// CaptureTablette.jsx).
export const LIBELLE_PIECE_ORPHELINE = 'À recapturer (fichier perdu)';

export function libelle(dictionnaire, code) {
  if (!code) return '-';
  return dictionnaire[code] ?? code;
}

export function libelleListe(dictionnaire, codes) {
  if (!codes || codes.length === 0) return '-';
  return codes.map((code) => libelle(dictionnaire, code)).join(', ');
}

export function formaterDate(valeur) {
  if (!valeur) return '-';
  return FORMAT_DATE.format(new Date(valeur));
}

// 'AAAA-MM-JJ' pour un <input type="date"> — simple troncature de la chaîne ISO déjà renvoyée par
// le back (candidat.dateNaissance en timestamptz, disponibilites.dateDebut/dateFin déjà en
// 'AAAA-MM-JJ' pur, voir BlocDisponibilites.schema.js), jamais un nouveau new Date(...) reformaté
// : éviterait un décalage d'un jour selon le fuseau du navigateur (contrairement à formaterDate
// ci-dessus, purement informatif, l'input doit rester la date EXACTE stockée).
export function versDateInput(valeur) {
  return valeur ? String(valeur).slice(0, 10) : '';
}

function bascule(tableau, valeur) {
  return tableau.includes(valeur) ? tableau.filter((v) => v !== valeur) : [...tableau, valeur];
}

// Une ligne "libellé : valeur" — évite de répéter la même structure pour chacun des champs
// affichés en lecture seule (cartes ci-dessous) et sert aussi de base visuelle à Champ() (mode
// édition), pour que passer en édition ne redessine pas toute la mise en page.
export function Ligne({ libelle: intitule, valeur }) {
  return (
    <div className="informations-inscription__ligne">
      <span className="informations-inscription__libelle">{intitule}</span>
      <span className="informations-inscription__valeur">{valeur || '-'}</span>
    </div>
  );
}

// Champ de saisie du formulaire d'édition (voir brouillon ci-dessous) — même structure visuelle
// que Ligne (libellé à gauche, valeur/contrôle à droite).
export function Champ({ id, libelle: intitule, children }) {
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
export function GroupeCases({ options, libelles, valeurs, onChange }) {
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
export function ErreurChamp({ erreursChamps, cle }) {
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
export const LIBELLES_CHAMPS_ERREUR = {
  civilite: 'Civilité',
  nom: 'Nom',
  nomNaissance: 'Nom de naissance',
  prenom: 'Prénom',
  dateNaissance: 'Date de naissance',
  lieuNaissance: 'Lieu de naissance',
  nationalite: 'Nationalité',
  situationFamiliale: 'Situation familiale',
  adresse: 'Numéro et nom de rue',
  codePostal: 'Code postal',
  ville: 'Ville',
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
  experience: 'Expérience',
  experienceLieu: "Lieu de l'expérience",
  experienceMissions: 'Mission(s) effectuée(s)',
  commentConnu: 'Comment nous a connu',
  commentConnuPrecision: 'Précision',
  certificationAucuneDispense: 'Dispense certifiée',
};

// Icônes de section (audit 2026-08-19, refonte visuelle) — dessinées à la main dans le même
// esprit outline que BoutonNouvelleInscription.jsx (IconePersonnePlus) : le projet n'a aucune
// bibliothèque d'icônes installée (voir package.json), pas de quoi justifier une dépendance pour
// quatre icônes fixes. currentColor + stroke pour hériter la couleur posée par le CSS de chaque
// en-tête de carte (voir .informations-inscription__carte-entete), jamais une couleur fixe ici.
export function IconePersonne({ taille = 20 }) {
  return (
    <svg viewBox="0 0 24 24" width={taille} height={taille} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20v-1a8 8 0 0 1 16 0v1" />
    </svg>
  );
}

export function IconeCarnetAdresses({ taille = 20 }) {
  return (
    <svg viewBox="0 0 24 24" width={taille} height={taille} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="M6.5 16c0-1.7 1.2-3 2.5-3s2.5 1.3 2.5 3" />
      <line x1="14.5" y1="9" x2="18" y2="9" />
      <line x1="14.5" y1="13" x2="18" y2="13" />
    </svg>
  );
}

export function IconeMallette({ taille = 20 }) {
  return (
    <svg viewBox="0 0 24 24" width={taille} height={taille} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="2" y1="13" x2="22" y2="13" />
    </svg>
  );
}

export function IconeTrombone({ taille = 20 }) {
  return (
    <svg viewBox="0 0 24 24" width={taille} height={taille} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.5 11.5L12 20a5 5 0 0 1-7-7l8.1-8.1a3.5 3.5 0 0 1 5 5L9.7 18.3a2 2 0 1 1-2.8-2.8l7.4-7.4" />
    </svg>
  );
}

// En-tête d'une carte (icône + titre) — même structure sur les 4 cartes de la vue lecture seule
// (Identité/Coordonnées/Situation professionnelle/Pièces jointes), voir Icone associée à chacune.
export function EnteteCarte({ icone, titre, children }) {
  return (
    <div className="informations-inscription__carte-entete">
      <div className="informations-inscription__carte-titre">
        {icone}
        <h3>{titre}</h3>
      </div>
      {children}
    </div>
  );
}

// Badge coloré vert/gris pour une valeur binaire (Oui/Non, Autorisée/Refusée...) — jamais rouge
// pour la valeur négative (demande explicite : "Non"/"Refusée" restent des réponses normales du
// candidat, pas une alerte à traiter). Réutilise StatutBadge (core/workflow/), déjà utilisé
// ailleurs dans l'app (DossierList.jsx, GestionRendezvous.jsx) — pas de nouveau composant de
// badge à maintenir en parallèle.
export function BadgePositifNeutre({ positif, libellePositif, libelleNeutre }) {
  return <StatutBadge libelle={positif ? libellePositif : libelleNeutre} variante={positif ? 'succes' : 'neutre'} />;
}
