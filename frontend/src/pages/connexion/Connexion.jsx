import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import LoginForm from '../../core/auth/LoginForm';
import { useSession } from '../../core/auth/useSession';
import { seDeconnecter } from '../../services/authService';
import './Connexion.css';

// Redirection après connexion, propre à chaque rôle — le formateur atterrit sur ses évaluations à
// faire (hôtel), l'inspecteur sur les siennes (bureau, section distincte du formateur — voir
// GrilleEvaluation.jsx, roleCode), l'admin sur la gestion des comptes, le reste (accueil/
// coordination ET recruteur, depuis la fusion de "Back-office recruteur" dans "Dossiers
// candidats", voir App.jsx) sur le tableau de bord Accueil, via la destination par défaut
// ci-dessous.
const DESTINATION_PAR_ROLE = {
  formateur: '/formateur/evaluations',
  inspecteur: '/inspecteur/evaluations',
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

  // Session déjà active à l'arrivée (ex. lien de l'email formateur/inspecteur, voir
  // formatageEmail.construireLienEvaluation, qui pointe désormais vers /connexion?redirection=...
  // plutôt que directement sur la page cible — audit 2026-08-21, corrige un mauvais compte/rôle
  // déjà connecté qui atterrissait sur "Rôle insuffisant" sans pouvoir se reconnecter).
  const { utilisateur: utilisateurActuel, chargement: chargementSession } = useSession();
  const [deconnexionEnCours, setDeconnexionEnCours] = useState(false);

  // Reprend la teinte de fond back-office (styles/blocFormulaire.css, .corps-back-office),
  // normalement posée par PageBackOffice.jsx — volontairement NON utilisé ici : avant connexion,
  // rien ne doit être visible à part le formulaire (ni bandeau/logos, ni pied de page, ni barre de
  // navigation), voir demande utilisateur du 2026-08-21.
  useEffect(() => {
    document.body.classList.add('corps-back-office');
    return () => document.body.classList.remove('corps-back-office');
  }, []);

  // true seulement si la session active a le rôle attendu par cibleRedirection (comparaison sur
  // le chemin seul, avant le '?' — le rendezvousId ciblé n'a pas d'incidence sur la légitimité du
  // rôle) : sert à la fois à la redirection immédiate ci-dessous et au message affiché plus bas
  // (jamais "n'a pas accès" pour un rôle qui, lui, correspond bel et bien).
  const roleCorrespondACible =
    utilisateurActuel &&
    cibleRedirection &&
    Boolean(DESTINATION_PAR_ROLE[utilisateurActuel.roleCode]) &&
    cibleRedirection.split('?')[0].startsWith(DESTINATION_PAR_ROLE[utilisateurActuel.roleCode]);

  // Redirection immédiate SEULEMENT si le rôle de la session active correspond bien à la
  // destination ciblée : si c'est déjà le bon compte, passer par cet écran ne doit ni bloquer ni
  // gêner. Si le rôle ne correspond pas (mauvais compte), on NE redirige PAS silencieusement avec
  // cette session-là — le formulaire reste affiché ci-dessous, avec un rappel du compte
  // actuellement connecté pour permettre de s'en déconnecter/reconnecter avec le bon compte.
  useEffect(() => {
    if (chargementSession || !roleCorrespondACible) return;
    navigate(cibleRedirection, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chargementSession, roleCorrespondACible]);

  // Rechargement complet plutôt qu'un simple état local effacé : useSession() (voir son
  // commentaire d'en-tête) ne se réabonne qu'au montage — sans reload, le useSession() de CE
  // composant continuerait lui-même d'afficher l'ancien utilisateurActuel après la déconnexion.
  // Reste sur la MÊME URL (window.location.reload() réutilise l'URL courante) : contrairement à
  // EnTeteBackOffice.jsx (qui renvoie vers /connexion SANS paramètre depuis une page interne), on
  // est déjà sur /connexion?redirection=... — un navigate('/connexion') perdrait cibleRedirection
  // en cours de route.
  const gererDeconnexion = async () => {
    setDeconnexionEnCours(true);
    try {
      await seDeconnecter();
    } finally {
      window.location.reload();
    }
  };

  return (
    <main className="page-connexion">
      {/* Rappel du compte déjà connecté — seulement une fois la session résolue et non vide,
          jamais pendant le chargement (évite un flash "Connecté en tant que..." qui disparaîtrait
          aussitôt sur une simple visite non connectée de /connexion, cas le plus fréquent). */}
      {!chargementSession && utilisateurActuel && (
        <p className="connexion__session-active" role="status">
          Connecté(e) en tant que {utilisateurActuel.prenom} {utilisateurActuel.nom}
          {cibleRedirection && !roleCorrespondACible && ' — ce compte ne semble pas avoir accès à la page demandée.'}{' '}
          Pour changer de compte, connectez-vous ci-dessous, ou{' '}
          <button type="button" onClick={gererDeconnexion} disabled={deconnexionEnCours}>
            {deconnexionEnCours ? 'Déconnexion...' : 'déconnectez-vous'}
          </button>
          .
        </p>
      )}

      <LoginForm
        onConnexionReussie={(utilisateur) =>
          navigate(cibleRedirection || (DESTINATION_PAR_ROLE[utilisateur.roleCode] ?? DESTINATION_PAR_DEFAUT))
        }
      />
    </main>
  );
}
