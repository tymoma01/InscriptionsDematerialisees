import { useNavigate, useSearchParams } from 'react-router-dom';
import LoginForm from '../../core/auth/LoginForm';

// Redirection après connexion, propre à chaque rôle — le recruteur atterrit sur son back-office,
// le formateur sur ses évaluations à faire, l'admin sur la gestion des comptes, le reste
// (accueil/coordination) sur le tableau de bord Accueil.
const DESTINATION_PAR_ROLE = {
  recruteur: '/recruteur/dossiers',
  formateur: '/formateur/evaluations',
  admin: '/admin/utilisateurs',
};
const DESTINATION_PAR_DEFAUT = '/accueil/tableau-de-bord';

// Page de connexion : fait le lien entre le formulaire générique (LoginForm.jsx, qui ne connaît
// pas le routage — même patron que CaptureTablette.jsx) et la destination après connexion.
//
// ?redirection=... : prioritaire sur la destination par rôle ci-dessus — utilisé par exemple
// depuis ConfirmationInscription.jsx quand l'agent n'a pas encore de session active et doit être
// renvoyé vers la prise des pièces justificatives du dossier qui vient d'être créé plutôt que
// vers l'écran par défaut de son rôle. Restreint aux chemins internes (commençant par "/") :
// useNavigate() ne suivrait de toute façon jamais une URL externe telle quelle, mais autant ne
// pas transmettre de valeur inattendue à la navigation.
export default function Connexion() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirection = searchParams.get('redirection');
  const cibleRedirection = redirection?.startsWith('/') ? redirection : null;

  return (
    <LoginForm
      onConnexionReussie={(utilisateur) =>
        navigate(cibleRedirection || (DESTINATION_PAR_ROLE[utilisateur.roleCode] ?? DESTINATION_PAR_DEFAUT))
      }
    />
  );
}
