import { Navigate, useLocation } from 'react-router-dom';
import { useSession } from './useSession';
import PageBackOffice from '../backOffice/PageBackOffice';

// Garde de route commune à toutes les pages back-office protégées (audit 2026-08-25) — enveloppe
// chaque route dans App.jsx plutôt que de dupliquer un bloc `if (!utilisateur) {...}` par page
// (c'était déjà le cas avant ce correctif, avec des variantes incohérentes : certaines pages
// (Indicateurs.jsx, Planification.jsx) n'affichaient qu'un texte sans aucun moyen de se connecter
// depuis l'écran, d'autres un lien "Se connecter" sans ?redirection=..., et quatre pages
// (VerificationPieces.jsx, Relances.jsx, Tests.jsx, Validation.jsx) n'avaient aucune garde du tout
// côté client — laissées à la seule merci des 401 renvoyés par le back).
//
// Redirige immédiatement vers /connexion?redirection=... (repris tel quel par Connexion.jsx après
// authentification, voir son commentaire d'en-tête) plutôt que d'afficher un message intermédiaire
// à cliquer : même mécanisme que celui déjà en place pour pages/formateur/Evaluation.jsx et
// pages/inspecteur/Evaluation.jsx (lien de convocation email formateur/inspecteur), désormais
// généralisé à toutes les routes protégées.
//
// Ne vérifie que la PRÉSENCE d'une session, jamais la légitimité du rôle vis-à-vis de la page
// demandée : la vérification de rôle reste entièrement côté serveur (requireAuth + requireRole,
// voir App.jsx et backend/src/api/routes) — cette garde évite seulement d'afficher un écran
// inutilisable (aller-retour réseau en échec, 401) à un visiteur qui n'a même pas de session.
export default function RouteProtegee({ children }) {
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

  return children;
}
