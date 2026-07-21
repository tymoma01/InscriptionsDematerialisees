import { useNavigate } from 'react-router-dom';
import LoginForm from '../../core/auth/LoginForm';

// Redirection après connexion, propre à chaque rôle — le recruteur atterrit sur son back-office,
// le formateur sur ses évaluations à faire, les autres rôles internes (accueil/coordination,
// admin) sur le tableau de bord Accueil, seul écran qu'ils ont en commun pour l'instant.
const DESTINATION_PAR_ROLE = {
  recruteur: '/recruteur/dossiers',
  formateur: '/formateur/evaluations',
};
const DESTINATION_PAR_DEFAUT = '/accueil/tableau-de-bord';

// Page de connexion : fait le lien entre le formulaire générique (LoginForm.jsx, qui ne connaît
// pas le routage — même patron que CaptureTablette.jsx) et la destination après connexion.
export default function Connexion() {
  const navigate = useNavigate();

  return (
    <LoginForm
      onConnexionReussie={(utilisateur) =>
        navigate(DESTINATION_PAR_ROLE[utilisateur.roleCode] ?? DESTINATION_PAR_DEFAUT)
      }
    />
  );
}
