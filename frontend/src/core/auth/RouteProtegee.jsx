import { Navigate, useLocation } from 'react-router-dom';
import { useSession } from './useSession';
import { peut, destinationDuRole } from './permissions';
import PageBackOffice from '../backOffice/PageBackOffice';

// Garde de route commune à toutes les pages back-office protégées — enveloppe
// chaque route dans App.jsx plutôt que de dupliquer un bloc `if (!utilisateur) {...}` par page
// (c'était déjà le cas avant ce correctif, avec des variantes incohérentes : certaines pages
// (Indicateurs.jsx, Planification.jsx) n'affichaient qu'un texte sans aucun moyen de se connecter
// depuis l'écran, d'autres un lien "Se connecter" sans ?redirection=..., et quatre pages
// (VerificationPieces.jsx, Relances.jsx, Tests.jsx, Validation.jsx) n'avaient aucune garde du tout
// côté client — laissées à la seule merci des 401 renvoyés par le back).
//
// Redirige immédiatement vers /connexion?redirection=... (repris tel quel par Connexion.jsx après
// authentification, voir son commentaire d'en-tête) plutôt que d'afficher un message intermédiaire
// à cliquer : même mécanisme que celui déjà en place pour pages/evaluation/Evaluation.jsx et
// pages/evaluation/Evaluation.jsx (lien de convocation email formateur/inspecteur), désormais
// généralisé à toutes les routes protégées.
//
// `permission` optionnel (clé de backend/src/core/auth/permissions.js, reçue avec la session) :
// sans elle, l'utilisateur est renvoyé vers l'écran de son rôle plutôt que vers une page qui lui
// répondrait 403. Confort d'affichage uniquement : la sécurité reste posée côté serveur.
export default function RouteProtegee({ children, permission }) {
  const { utilisateur, chargement } = useSession();
  const location = useLocation();

  if (chargement) {
    return (
      <PageBackOffice>
        <p>Chargement de la session…</p>
      </PageBackOffice>
    );
  }

  if (!utilisateur) {
    const cible = `${location.pathname}${location.search}`;
    return <Navigate to={`/connexion?redirection=${encodeURIComponent(cible)}`} replace />;
  }

  if (permission && !peut(utilisateur, permission)) {
    return <Navigate to={destinationDuRole(utilisateur.roleCode)} replace />;
  }

  return children;
}
