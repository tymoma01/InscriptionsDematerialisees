import { useNavigate } from 'react-router-dom';
import LoginForm from '../../core/auth/LoginForm';

// Page de connexion : fait le lien entre le formulaire générique (LoginForm.jsx, qui ne connaît
// pas le routage — même patron que CaptureTablette.jsx) et la destination après connexion.
// Redirige vers le tableau de bord Accueil : seul écran interne câblé pour l'instant (voir
// App.jsx) ; à revoir quand d'autres écrans par rôle (recruteur, formateur, admin) existeront.
export default function Connexion() {
  const navigate = useNavigate();

  return <LoginForm onConnexionReussie={() => navigate('/accueil/tableau-de-bord')} />;
}
