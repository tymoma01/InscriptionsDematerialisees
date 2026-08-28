import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from './useSession';
import { seDeconnecter } from '../../services/authService';
import './EnTeteBackOffice.css';

// En-tête commun aux écrans internes authentifiés (accueil, coordination, recruteur, formateur,
// admin) : affiche l'agent connecté et propose la déconnexion. Appelle son propre useSession()
// plutôt que de recevoir l'utilisateur en prop — même patron que GestionRendezvous.jsx /
// HistoriqueRelances.jsx / GestionTransitions.jsx (chaque composant reste autonome) — pour que
// n'importe quelle page back-office puisse simplement ajouter <EnTeteBackOffice /> sans câblage
// supplémentaire. Ne rend rien tant que la session n'est pas résolue ou si personne n'est
// connecté : la page appelante affiche déjà son propre message "vous devez être connecté" dans
// ce cas (voir TableauDeBordAccueil.jsx et les autres pages back-office).
//
// `children` optionnel (audit 2026-08-28, bouton "Mon profil" côté Formateur/Inspecteur, voir
// pages/formateur/Evaluation.jsx) : rendu avant le nom de l'agent, DANS la même ligne flex que
// lui/Déconnexion — nécessaire pour un alignement vertical pixel-perfect des trois éléments (un
// enfant placé dans un conteneur flex frère, plutôt que dans cette ligne elle-même, ne partage pas
// exactement la même boîte englobante). Vide par défaut : aucune autre page back-office n'a
// aujourd'hui besoin de ce slot, celles qui ne le renseignent pas gardent un rendu strictement
// identique à avant son ajout.
export default function EnTeteBackOffice({ children }) {
  const { utilisateur, chargement } = useSession();
  const navigate = useNavigate();
  const [deconnexionEnCours, setDeconnexionEnCours] = useState(false);

  if (chargement || !utilisateur) {
    return null;
  }

  const gererDeconnexion = async () => {
    setDeconnexionEnCours(true);
    try {
      await seDeconnecter();
    } catch {
      // Non bloquant : même si l'appel réseau échoue, la redirection vers /connexion reste la
      // meilleure action possible — la session côté client est de toute façon abandonnée, aucune
      // donnée sensible ne reste affichée après la navigation.
    } finally {
      navigate('/connexion');
    }
  };

  return (
    <div className="en-tete-back-office">
      {children}
      {/* Préfixe "Agent connecté : " retiré (audit 2026-08-20, décision utilisateur) : le nom seul
          suffit, cet en-tête n'apparaissant que sur les écrans internes déjà authentifiés. */}
      <p className="en-tete-back-office__agent">
        {utilisateur.prenom} {utilisateur.nom}
      </p>
      <button
        type="button"
        className="en-tete-back-office__deconnexion"
        onClick={gererDeconnexion}
        disabled={deconnexionEnCours}
      >
        {deconnexionEnCours ? 'Déconnexion...' : 'Déconnexion'}
      </button>
    </div>
  );
}
