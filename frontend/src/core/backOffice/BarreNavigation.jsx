import { Link, useLocation } from 'react-router-dom';
import { useSession } from '../auth/useSession';
import { peut } from '../auth/permissions';
import './BarreNavigation.css';

// Catalogue des destinations back-office (refonte navigation, 2026-08-17 ; fusion de "Back-
// office recruteur" dans "Dossiers candidats", voir App.jsx ; étendu au parcours Formateur/
// Inspecteur le 2026-08-20) — chaque entrée recopie le sous-
// ensemble de rôles réellement autorisé côté back (voir commentaire de chacune) : cette barre ne
// fait qu'AFFICHER un accès déjà décidé par requirePermission(...), jamais l'inverse — la page cible
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
    // Mêmes rôles que evaluations.routes.js (route /historique), evaluation restreint à
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
    // Mêmes rôles que statistiques.routes.js. RH ajouté (module Demandes DPAE, 2026-09-28, demande
    // utilisateur explicite) — lecture seule, cohérent avec le reste de ses accès.
    permission: 'statistiques',
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
    // Mêmes rôles que dossiers.routes.js, consultationDossiers — RH ajouté (module Demandes
    // DPAE, 2026-09-28, demande utilisateur explicite) : consultation seule (Validation.jsx masque
    // déjà "Forcer le statut"/"Embauche" pour tout rôle hors forcerStatut/Accueil/Coordination et Planning+admin,
    // donc naturellement en lecture seule pour RH, voir son commentaire d'en-tête).
    permission: 'listeDossiers',
  },
  {
    cle: 'suivi-tests',
    libelle: 'Suivi des tests',
    chemin: '/coordination/planification',
    estActif: (chemin) => chemin.startsWith('/coordination/planification'),
    // Formateur/Inspecteur ajoutés ici : voient uniquement leurs propres
    // rendez-vous assignés sur cette page (restriction posée côté serveur, voir
    // dossiers.routes.js — jamais une simple restriction d'affichage). Mêmes rôles que
    // dossiers.routes.js (route /rendezvous) et formateurs.routes.js pour Accueil/Coordination/
    // Admin.
    permission: 'suiviTests',
  },
  {
    cle: 'suivi-formation',
    libelle: 'Suivi des formations',
    chemin: '/coordination/suivi-formation',
    estActif: (chemin) => chemin.startsWith('/coordination/suivi-formation'),
    // Suivi de formation — mêmes rôles que 'suivi-tests' ci-dessus à l'origine
    // (Accueil/Coordination lecture seule, Formateur/Inspecteur/Admin accès complet, différencié
    // DANS la page — voir SuiviFormation.jsx — pas par un second onglet), Inspecteur RETIRÉ depuis
    // (audit 2026-09-26, règle métier confirmée : aucun dossier Tertiaire — le secteur de
    // l'Inspecteur — ne passe en formation). Mêmes rôles que dossiers.routes.js, route
    // /suivi-formation (suiviFormation), et App.jsx (garde de route équivalente).
    permission: 'suiviFormation',
  },
  // Vues Formateur / Inspecteur de l'Admin — ouvrent
  // l'espace EXISTANT du rôle (mêmes routes, mêmes pages, mêmes composants), l'Admin y voyant tout
  // le secteur (voir secteurVueAdmin dans pages/evaluation). `sousOnglets` : clés
  // des entrées de CETTE liste à reprendre comme sous-onglets de l'espace, résolues avec
  // `roleEspace` (même fonction `chemin(roleCode)` que pour un vrai Formateur/Inspecteur) —
  // aucune route ni libellé dupliqué. Onglet actif = toute route de l'espace.
  {
    cle: 'vue-formateur',
    libelle: 'Formateur Hôtellerie',
    chemin: '/formateur/evaluations',
    estActif: (chemin) => chemin.startsWith('/formateur/'),
    permission: 'administration',
    roleEspace: 'formateur',
    sousOnglets: ['historique-evaluations', 'evaluations-a-venir'],
  },
  {
    cle: 'vue-inspecteur',
    libelle: 'Formateur Tertiaire',
    chemin: '/inspecteur/evaluations',
    estActif: (chemin) => chemin.startsWith('/inspecteur/'),
    permission: 'administration',
    roleEspace: 'inspecteur',
    sousOnglets: ['historique-evaluations', 'evaluations-a-venir'],
  },
  {
    // Onglet Admin : Dossiers candidats avec le périmètre de l'Inspecteur Hôtellerie
    // (Hôtellerie, 5 statuts), appliqué côté serveur (paramètre `vue`, Admin uniquement).
    cle: 'vue-inspecteur-hotellerie',
    libelle: 'Inspecteur',
    chemin: '/vue-inspecteur-hotellerie/dossiers',
    estActif: (chemin) => chemin.startsWith('/vue-inspecteur-hotellerie/'),
    permission: 'administration',
  },
  {
    cle: 'rh',
    // Onglet « RH » — remplace l'onglet « Demandes DPAE », à la
    // MÊME position (avant « Comptes utilisateurs » : l'ordre de ce tableau pilote l'ordre des
    // onglets). Espace à sous-onglets, même mécanisme que « Vue Formateur »/« Vue Inspecteur »
    // ci-dessus : « Tableau de bord DPAE » puis « Demandes DPAE » (ordre inversé le 2026-10-02,
    // demande utilisateur). Pas de `roleEspace` : les sous-onglets calculent leur chemin avec le
    // rôle CONNECTÉ (la RH garde sa file comme destination). Un clic sur « RH » ouvre « Tableau de
    // bord DPAE », ou « Demandes DPAE » pour un rôle qui n'y a pas accès (Inspecteur). Actif sur TOUTES les pages DPAE
    // (suivi, nouvelle demande, tableau de bord sous /coordination/dpae/ ; file RH et fiche sous
    // /rh/dpae) — aucune adresse existante modifiée.
    libelle: 'RH',
    chemin: (roleCode, utilisateur) => {
      if (peut(utilisateur, 'dpaeTableauDeBord')) {
        return '/coordination/dpae/tableau-de-bord';
      }
      return roleCode === 'rh' ? '/rh/dpae' : '/coordination/dpae/suivi';
    },
    estActif: (chemin) => chemin.startsWith('/rh/dpae') || chemin.startsWith('/coordination/dpae/'),
    permission: 'dpaeConsultation',
    sousOnglets: ['dpae-tableau-de-bord', 'dpae-demandes'],
  },
  // Sous-onglets de l'espace « RH » — `sousOngletSeulement` : jamais affichés dans la barre
  // principale, seulement dans la barre de sous-onglets de leur espace.
  {
    cle: 'dpae-tableau-de-bord',
    libelle: 'Tableau de bord DPAE',
    chemin: '/coordination/dpae/tableau-de-bord',
    estActif: (chemin) => chemin.startsWith('/coordination/dpae/tableau-de-bord'),
    sousOngletSeulement: true,
    // Sous-onglet réservé : pas pour l'Inspecteur Hôtellerie.
    permissionSousOnglet: 'dpaeTableauDeBord',
  },
  {
    cle: 'dpae-demandes',
    libelle: 'Demandes DPAE',
    // Page de suivi ; file RH conservée comme destination pour le rôle RH (inchangé).
    chemin: (roleCode) => (roleCode === 'rh' ? '/rh/dpae' : '/coordination/dpae/suivi'),
    // Suivi, nouvelle demande, file RH et fiche d'une demande — tout sauf le tableau de bord.
    estActif: (chemin) =>
      chemin.startsWith('/rh/dpae') ||
      (chemin.startsWith('/coordination/dpae/') && !chemin.startsWith('/coordination/dpae/tableau-de-bord')),
    sousOngletSeulement: true,
  },
  {
    cle: 'comptes-utilisateurs',
    libelle: 'Comptes utilisateurs',
    chemin: '/admin/utilisateurs',
    estActif: (chemin) => chemin.startsWith('/admin/'),
    // Mêmes rôles que utilisateurs.routes.js — réservée à Admin.
    permission: 'administration',
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

  // `permission` : droit (core/auth/permissions.js). `roles` : réservé aux onglets qui désignent
  // l'espace PROPRE d'un rôle (Formateur/Inspecteur), pas un droit.
  const estVisible = (element) =>
    !element.sousOngletSeulement &&
    (element.permission ? peut(utilisateur, element.permission) : element.roles.includes(utilisateur.roleCode));
  const elementsVisibles = ELEMENTS_NAVIGATION.filter(estVisible);
  if (elementsVisibles.length === 0) {
    return null;
  }

  // Sous-onglets de l'espace actif (vues Admin, voir `sousOnglets` ci-dessus) — dans une barre
  // SÉPARÉE, non collante, sous la barre principale : celle-ci est sticky et sa hauteur sert de
  // référence (--hauteur-barre-navigation, PageBackOffice.css) aux autres éléments collants, une
  // seconde rangée à l'intérieur la décalerait. Ordre = ordre de ELEMENTS_NAVIGATION, identique à
  // celui que voit un vrai Formateur/Inspecteur.
  const espaceActif = elementsVisibles.find((element) => element.sousOnglets && element.estActif(pathname));
  const sousOnglets = espaceActif
    ? ELEMENTS_NAVIGATION.filter(
        (element) =>
          espaceActif.sousOnglets.includes(element.cle) &&
          (!element.permissionSousOnglet || peut(utilisateur, element.permissionSousOnglet)),
      )
    : [];

  return (
    <>
      {/* --dense : au-delà de 6 onglets (aujourd'hui l'Admin seul, avec "Vue
          Formateur"/"Vue Inspecteur"), liens légèrement resserrés pour que la barre sticky tienne
          sur une ligne en largeur bureau — sa hauteur sur une ligne sert de référence aux autres
          éléments collants (--hauteur-barre-navigation). Aucun changement pour les autres rôles. */}
      <nav
        className={`barre-navigation${elementsVisibles.length > 6 ? ' barre-navigation--dense' : ''}`}
        aria-label="Navigation back-office"
      >
        {elementsVisibles.map((element) => {
          const actif = element.estActif(pathname);
          const chemin = typeof element.chemin === 'function' ? element.chemin(utilisateur.roleCode, utilisateur) : element.chemin;
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
      {sousOnglets.length > 0 && (
        <nav className="barre-navigation-sous-onglets" aria-label={`Navigation ${espaceActif.libelle}`}>
          {sousOnglets.map((element) => {
            // Rôle de l'espace s'il en a un (Vue Formateur/Inspecteur de l'Admin), sinon rôle connecté
            // (espace « RH », 2026-09-30). Actif : règle propre du sous-onglet (plusieurs pages pour
            // « Demandes DPAE »), identique pour les sous-onglets Formateur/Inspecteur.
            const roleChemin = espaceActif.roleEspace ?? utilisateur.roleCode;
            const chemin = typeof element.chemin === 'function' ? element.chemin(roleChemin, utilisateur) : element.chemin;
            const actif = element.estActif(pathname);
            return (
              <Link
                key={element.cle}
                to={chemin}
                className={`barre-navigation-sous-onglets__lien${actif ? ' barre-navigation-sous-onglets__lien--actif' : ''}`}
                aria-current={actif ? 'page' : undefined}
              >
                {element.libelle}
              </Link>
            );
          })}
        </nav>
      )}
    </>
  );
}
