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
// Ne vérifie que la PRÉSENCE d'une session par défaut, jamais la légitimité du rôle vis-à-vis de
// la page demandée : la vérification de rôle reste entièrement côté serveur (requireAuth +
// requireRole, voir App.jsx et backend/src/api/routes) — cette garde évite seulement d'afficher un
// écran inutilisable (aller-retour réseau en échec, 401/403) à un visiteur qui n'a même pas de
// session, ou dont le rôle n'a de toute façon pas accès à cette page.
//
// `roles` optionnel (audit 2026-09-26, retrait de l'accès Inspecteur à "Suivi des formations") :
// quand fourni, redirige tout rôle NON listé vers SON écran d'accueil plutôt que de le laisser
// atteindre une page qui lui répondra 403 au premier appel réseau — reste un confort d'affichage
// (même principe que le commentaire ci-dessus), jamais la sécurité elle-même, qui reste posée côté
// serveur (voir App.jsx, route correspondante). Sans ce prop (comportement historique, la majorité
// des routes), aucune vérification de rôle n'est faite ici.
//
// DESTINATION_PAR_ROLE/DESTINATION_PAR_DEFAUT dupliqués depuis Connexion.jsx (voir CLAUDE.md,
// conventions du projet) plutôt qu'importés : mêmes valeurs EXACTES à maintenir en cohérence
// manuellement si l'une des deux change — l'écran d'accueil d'un rôle doit rester identique après
// connexion et après un refus de route protégée par rôle, sous peine de rebonds différents pour un
// même utilisateur selon le chemin emprunté.
const DESTINATION_PAR_ROLE = {
  formateur: '/formateur/evaluations',
  inspecteur: '/inspecteur/evaluations',
  admin: '/accueil/tableau-de-bord',
};
const DESTINATION_PAR_DEFAUT = '/accueil/tableau-de-bord';

export default function RouteProtegee({ children, roles }) {
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

  if (roles && !roles.includes(utilisateur.roleCode)) {
    return <Navigate to={DESTINATION_PAR_ROLE[utilisateur.roleCode] ?? DESTINATION_PAR_DEFAUT} replace />;
  }

  return children;
}
