import { Link, useLocation } from 'react-router-dom';
import { useSession } from '../auth/useSession';
import './BarreNavigation.css';

// Catalogue des destinations back-office (refonte navigation, 2026-08-17 ; fusion de "Back-
// office recruteur" dans "Dossiers candidats", voir App.jsx ; étendu au parcours Formateur/
// Inspecteur le 2026-08-20) — chaque entrée recopie le sous-
// ensemble de rôles réellement autorisé côté back (voir commentaire de chacune) : cette barre ne
// fait qu'AFFICHER un accès déjà décidé par requireRole(...), jamais l'inverse — la page cible
// refait de toute façon son propre appel réseau protégé (voir App.jsx, en-tête).
// `chemin` est soit une chaîne fixe (même destination quel que soit le rôle qui la voit), soit une
// fonction (roleCode) => chemin — seul cas d'usage actuel : Formateur et Inspecteur ont chacun
// leur propre route pour un même écran logique (Evaluation.jsx/HistoriqueEvaluations.jsx dupliqués
// par rôle, voir App.jsx), contrairement aux autres destinations ci-dessous, partagées telles
// quelles par tous les rôles qui y ont accès.
const ELEMENTS_NAVIGATION = [
  {
    cle: 'historique-evaluations',
    libelle: 'Historique des évaluations',
    chemin: (roleCode) => (roleCode === 'inspecteur' ? '/inspecteur/historique' : '/formateur/historique'),
    estActif: (chemin) => chemin.startsWith('/formateur/historique') || chemin.startsWith('/inspecteur/historique'),
    // Mêmes rôles que evaluations.routes.js (route /historique), ROLES_EVALUATION restreint à
    // Formateur/Inspecteur/Admin — Admin exclu ici volontairement : cette barre ne sert que le
    // parcours Formateur/Inspecteur (voir commentaire d'en-tête plus bas), Admin gère les comptes
    // via "Comptes utilisateurs", pas d'évaluations en son nom propre.
    roles: ['formateur', 'inspecteur'],
  },
  {
    cle: 'evaluations-a-venir',
    // "Évaluations à venir" (audit 2026-08-20, remplace "Évaluations à faire" — même libellé
    // renommé sur le H1 de la page cible, voir Evaluation.jsx/formateur et inspecteur) : route et
    // logique inchangées, seul l'intitulé affiché change.
    libelle: 'Évaluations à venir',
    chemin: (roleCode) => (roleCode === 'inspecteur' ? '/inspecteur/evaluations' : '/formateur/evaluations'),
    estActif: (chemin) => chemin.startsWith('/formateur/evaluations') || chemin.startsWith('/inspecteur/evaluations'),
    roles: ['formateur', 'inspecteur'],
  },
  {
    cle: 'tableau-de-bord',
    libelle: 'Tableau de bord',
    chemin: '/tableau-de-bord/indicateurs',
    estActif: (chemin) => chemin.startsWith('/tableau-de-bord/'),
    // Mêmes rôles que statistiques.routes.js. Rôle Recruteur retiré (audit 2026-08-27) — voir
    // suppression du rôle en base.
    roles: ['accueil_coordination', 'admin'],
  },
  {
    cle: 'dossiers',
    libelle: 'Dossiers candidats',
    chemin: '/accueil/tableau-de-bord',
    // Actif aussi sur les fiches dossier atteintes depuis ce tableau de bord (VerificationPieces.jsx,
    // Relances.jsx, Validation.jsx — /accueil/..., /coordination/dossiers/<id>/relances et
    // /recruteur/dossiers/<id>/validation, cette dernière atteinte via l'action "Étudier le
    // dossier" fusionnée ici).
    estActif: (chemin) =>
      chemin.startsWith('/accueil/') ||
      chemin.startsWith('/coordination/dossiers/') ||
      chemin.startsWith('/recruteur/'),
    // Mêmes rôles que dossiers.routes.js, ROLES_CONSULTATION_DOSSIERS. Rôle Recruteur retiré
    // (audit 2026-08-27) — voir suppression du rôle en base.
    roles: ['accueil_coordination', 'admin'],
  },
  {
    cle: 'suivi-tests',
    libelle: 'Suivi des tests',
    chemin: '/coordination/planification',
    estActif: (chemin) => chemin.startsWith('/coordination/planification'),
    // Formateur/Inspecteur ajoutés ici (audit 2026-08-20) : voient uniquement leurs propres
    // rendez-vous assignés sur cette page (restriction posée côté serveur, voir
    // dossiers.routes.js — jamais une simple restriction d'affichage). Mêmes rôles que
    // dossiers.routes.js (route /rendezvous) et formateurs.routes.js pour Accueil/Coordination/
    // Admin. Rôle Recruteur retiré (audit 2026-08-27) — voir suppression du rôle en base.
    roles: ['accueil_coordination', 'admin', 'formateur', 'inspecteur'],
  },
  {
    cle: 'suivi-formation',
    libelle: 'Suivi des formations',
    chemin: '/coordination/suivi-formation',
    estActif: (chemin) => chemin.startsWith('/coordination/suivi-formation'),
    // Suivi de formation (audit 2026-08-28) — mêmes rôles que 'suivi-tests' ci-dessus (même
    // patron : Accueil/Coordination lecture seule, Formateur/Inspecteur/Admin accès complet,
    // différencié DANS la page — voir SuiviFormation.jsx — pas par un second onglet). Mêmes rôles
    // que dossiers.routes.js, route /suivi-formation (ROLES_SUIVI_FORMATION).
    roles: ['accueil_coordination', 'admin', 'formateur', 'inspecteur'],
  },
  {
    cle: 'comptes-utilisateurs',
    libelle: 'Comptes utilisateurs',
    chemin: '/admin/utilisateurs',
    estActif: (chemin) => chemin.startsWith('/admin/'),
    // Mêmes rôles que utilisateurs.routes.js — réservée à Admin.
    roles: ['admin'],
  },
];

// Barre de navigation commune aux écrans back-office (refonte 2026-08-17 ; étendue à Formateur/
// Inspecteur le 2026-08-20 — Historique des évaluations/Évaluations à venir/Suivi des tests,
// jusque-là des boutons de retour ad hoc propres à chaque page, voir Evaluation.jsx/
// HistoriqueEvaluations.jsx) : remplace les boutons de retour/navigation auparavant dispersés page
// par page. Montée une seule fois dans PageBackOffice.jsx plutôt que dupliquée dans chaque page —
// même patron que BoutonNouvelleInscription.jsx (auto-gating par rôle via son propre
// useSession()). Ne rend rien tant que la session n'est pas résolue, si personne n'est connecté
// (masquée sur /connexion, cohérent avec EnTeteBackOffice.jsx) ou si le rôle connecté n'a accès à
// aucune des destinations ci-dessus.
export default function BarreNavigation() {
  const { utilisateur, chargement } = useSession();
  const { pathname } = useLocation();

  if (chargement || !utilisateur) {
    return null;
  }

  const elementsVisibles = ELEMENTS_NAVIGATION.filter((element) => element.roles.includes(utilisateur.roleCode));
  if (elementsVisibles.length === 0) {
    return null;
  }

  return (
    <nav className="barre-navigation" aria-label="Navigation back-office">
      {elementsVisibles.map((element) => {
        const actif = element.estActif(pathname);
        const chemin = typeof element.chemin === 'function' ? element.chemin(utilisateur.roleCode) : element.chemin;
        return (
          <Link
            key={element.cle}
            to={chemin}
            className={`barre-navigation__lien${actif ? ' barre-navigation__lien--actif' : ''}`}
            aria-current={actif ? 'page' : undefined}
          >
            {element.libelle}
          </Link>
        );
      })}
    </nav>
  );
}
