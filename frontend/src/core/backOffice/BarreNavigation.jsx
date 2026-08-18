import { Link, useLocation } from 'react-router-dom';
import { useSession } from '../auth/useSession';
import './BarreNavigation.css';

// Catalogue des 4 destinations back-office (refonte navigation, 2026-08-17 ; fusion de "Back-
// office recruteur" dans "Dossiers candidats", voir App.jsx) — chaque entrée recopie le sous-
// ensemble de rôles réellement autorisé côté back (voir commentaire de chacune) : cette barre ne
// fait qu'AFFICHER un accès déjà décidé par requireRole(...), jamais l'inverse — la page cible
// refait de toute façon son propre appel réseau protégé (voir App.jsx, en-tête).
const ELEMENTS_NAVIGATION = [
  {
    cle: 'tableau-de-bord',
    libelle: 'Tableau de bord',
    chemin: '/tableau-de-bord/indicateurs',
    estActif: (chemin) => chemin.startsWith('/tableau-de-bord/'),
    // Mêmes rôles que statistiques.routes.js.
    roles: ['accueil_coordination', 'recruteur', 'admin'],
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
    // Mêmes rôles que dossiers.routes.js, ROLES_CONSULTATION_DOSSIERS.
    roles: ['accueil_coordination', 'recruteur', 'admin'],
  },
  {
    cle: 'suivi-tests',
    libelle: 'Suivi des tests',
    chemin: '/coordination/planification',
    estActif: (chemin) => chemin.startsWith('/coordination/planification'),
    // Mêmes rôles que dossiers.routes.js (route /rendezvous) et formateurs.routes.js.
    roles: ['accueil_coordination', 'recruteur', 'admin'],
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

// Barre de navigation commune aux écrans back-office (refonte 2026-08-17) : remplace les boutons
// de retour/navigation auparavant dispersés page par page ("Retour backoffice recruteur",
// "Retour Dossier Candidat", bouton "Indicateurs", bouton "Planification des tests"...). Montée
// une seule fois dans PageBackOffice.jsx plutôt que dupliquée dans chaque page — même patron que
// BoutonNouvelleInscription.jsx (auto-gating par rôle via son propre useSession()). Ne rend rien
// tant que la session n'est pas résolue, si personne n'est connecté (masquée sur /connexion,
// cohérent avec EnTeteBackOffice.jsx) ou si le rôle connecté n'a accès à aucune des 4
// destinations (Formateur/Inspecteur aujourd'hui : leur parcours propre — Evaluation.jsx/
// HistoriqueEvaluations.jsx — reste hors du périmètre de cette barre).
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
        return (
          <Link
            key={element.cle}
            to={element.chemin}
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
