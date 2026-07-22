import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { recupererSessionCourante } from '../../services/authService';
import './ConfirmationInscription.css';

const routePieces = (dossierId) => `/accueil/dossiers/${dossierId}/pieces`;

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
        Votre inscription est enregistrée avec succès, merci de rendre la tablette à l'agent.
      </p>
      <button type="button" onClick={chargerPiecesJustificatives} disabled={verificationEnCours}>
        CHARGER LES PIÈCES JUSTIFICATIVES
      </button>
    </div>
  );
}
