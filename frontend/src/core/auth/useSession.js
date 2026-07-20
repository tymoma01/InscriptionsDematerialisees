import { useEffect, useState } from 'react';
import { recupererSessionCourante } from '../../services/authService';

// Récupère l'identité de l'agent connecté (session serveur, voir CLAUDE.md section
// Authentification et rôles) au montage — ne stocke rien en localStorage/sessionStorage, la
// source de vérité reste le cookie de session httpOnly côté serveur (voir
// backend/src/core/auth/session.js). Utilisé par les écrans réservés aux agents internes
// (ex. CaptureTablette.jsx) pour lire l'identité courante sans champ de saisie manuel.
export function useSession() {
  const [utilisateur, setUtilisateur] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);

  useEffect(() => {
    let annule = false;
    recupererSessionCourante()
      .then((valeur) => {
        if (!annule) setUtilisateur(valeur);
      })
      .catch((erreurRequete) => {
        if (!annule) setErreur(erreurRequete);
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, []);

  return { utilisateur, chargement, erreur };
}
