import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { recupererSessionCourante } from '../../services/authService';
import './ConfirmationInscription.css';

const routePieces = (dossierId) => `/accueil/dossiers/${dossierId}/pieces`;

// Icônes illustratives des deux phrases du message — décoratives uniquement (aria-hidden), le
// texte porte déjà tout le sens et role="status" sur le conteneur suffit à l'annoncer. En SVG
// inline plutôt qu'une lib d'icônes (aucune déjà présente dans le projet) ou des emoji (rendu
// trop dépendant de l'appareil/du navigateur) : `currentColor` + `1em` les font suivre
// automatiquement la couleur et la taille de police du texte à côté.
function IconeSucces() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12.5l2.5 2.5L16 9" />
    </svg>
  );
}

function IconeTablette() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <line x1="10" y1="19" x2="14" y2="19" />
    </svg>
  );
}

// Écran affiché juste après une inscription réussie (voir InscriptionTablette.jsx) : le candidat
// rend la tablette à l'agent, qui enchaîne directement sur la prise des pièces justificatives
// (CLAUDE.md, étape 3 du parcours) sans repasser par le tableau de bord de recherche de dossier.
export default function ConfirmationInscription({ dossierId }) {
  const navigate = useNavigate();
  const [verificationEnCours, setVerificationEnCours] = useState(false);

  const chargerPiecesJustificatives = async () => {
    setVerificationEnCours(true);
    try {
      // Vérifié à la volée au clic (pas seulement une fois pour toutes au montage) : le temps
      // que le candidat rende la tablette peut suffire à faire tomber une session déjà proche
      // de son inactivité maximale (2h, voir CLAUDE.md) — CaptureTablette.jsx revérifiera de
      // toute façon la session à son propre montage, ceci ne fait qu'éviter d'y naviguer pour
      // rien si elle n'est déjà plus valide.
      const utilisateur = await recupererSessionCourante();
      const destination = routePieces(dossierId);
      navigate(utilisateur ? destination : `/connexion?redirection=${encodeURIComponent(destination)}`);
    } finally {
      setVerificationEnCours(false);
    }
  };

  return (
    <div className="confirmation-inscription" role="status">
      <p className="confirmation-inscription__message">
        <span className="confirmation-inscription__ligne confirmation-inscription__ligne--succes">
          <IconeSucces />
          Votre inscription est enregistrée avec succès.
        </span>
        <span className="confirmation-inscription__ligne">
          <IconeTablette />
          Merci de rendre la tablette à l'agent.
        </span>
      </p>
      <button type="button" onClick={chargerPiecesJustificatives} disabled={verificationEnCours}>
        CHARGER LES PIÈCES JUSTIFICATIVES
      </button>
    </div>
  );
}
