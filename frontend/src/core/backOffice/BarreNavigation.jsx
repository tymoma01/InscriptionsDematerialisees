import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useSession } from '../auth/useSession';
import { peut } from '../auth/permissions';
import { ROLES_VUES, SECTEURS_VUES } from '../referentiels/rolesVues';
import './BarreNavigation.css';

// Rôles dont la page « Demandes DPAE » est la file de traitement (la RH pour l'Hôtellerie, le Planning
// Tertiaire pour le Tertiaire) ; les autres arrivent sur le suivi des demandes.
const ouvreLaFileDeTraitementDpae = (roleCode) => roleCode === 'rh' || roleCode === 'planning_tertiaire';

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
  {
    cle: 'rh',
    // Onglet « DPAE » — remplace l'onglet « Demandes DPAE », à la
    // MÊME position (avant « Comptes utilisateurs » : l'ordre de ce tableau pilote l'ordre des
    // onglets). Espace à sous-onglets, même mécanisme que « Vue Formateur »/« Vue Inspecteur »
    // ci-dessus : « Tableau de bord DPAE » puis « Demandes DPAE » (ordre inversé le 2026-10-02,
    // demande utilisateur). Pas de `roleEspace` : les sous-onglets calculent leur chemin avec le
    // rôle CONNECTÉ (la RH garde sa file comme destination). Un clic sur « DPAE » ouvre « Tableau de
    // bord DPAE », ou « Demandes DPAE » pour un rôle qui n'y a pas accès (Inspecteur). Actif sur TOUTES les pages DPAE
    // (suivi, nouvelle demande, tableau de bord sous /coordination/dpae/ ; file RH et fiche sous
    // /rh/dpae) — aucune adresse existante modifiée.
    libelle: 'DPAE',
    chemin: (roleCode, utilisateur) => {
      if (peut(utilisateur, 'dpaeTableauDeBord')) {
        return '/coordination/dpae/tableau-de-bord';
      }
      return ouvreLaFileDeTraitementDpae(roleCode) ? '/rh/dpae' : '/coordination/dpae/suivi';
    },
    estActif: (chemin) => chemin.startsWith('/rh/dpae') || chemin.startsWith('/coordination/dpae/'),
    permission: 'dpaeConsultation',
    sousOnglets: ['dpae-tableau-de-bord', 'dpae-a-valider', 'dpae-demandes'],
  },
  // Sous-onglets de l'espace « DPAE » — `sousOngletSeulement` : jamais affichés dans la barre
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
    // File du Planning : les demandes des inspecteurs à transmettre à la RH ou à renvoyer.
    cle: 'dpae-a-valider',
    libelle: 'Demandes à valider',
    chemin: '/coordination/dpae/a-valider',
    estActif: (chemin) => chemin.startsWith('/coordination/dpae/a-valider'),
    sousOngletSeulement: true,
    permissionSousOnglet: 'dpaeValidationPlanning',
  },
  {
    cle: 'dpae-demandes',
    libelle: 'Demandes DPAE',
    // Page de suivi ; file RH conservée comme destination pour le rôle RH (inchangé).
    chemin: (roleCode) => (ouvreLaFileDeTraitementDpae(roleCode) ? '/rh/dpae' : '/coordination/dpae/suivi'),
    // Suivi, nouvelle demande, file RH et fiche d'une demande — tout sauf le tableau de bord.
    estActif: (chemin) =>
      chemin.startsWith('/rh/dpae') ||
      (chemin.startsWith('/coordination/dpae/') &&
        !chemin.startsWith('/coordination/dpae/tableau-de-bord') &&
        !chemin.startsWith('/coordination/dpae/a-valider')),
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

// Vue d'un rôle (voir core/referentiels/rolesVues.js) -> élément de navigation : réservée à l'Admin, reprend
// les routes et les sous-onglets de l'espace du rôle. Hors de la barre principale : listée dans « Vues ».
function elementDeVue(roleVue) {
  return {
    cle: `vue-${roleVue.code}`,
    libelle: roleVue.libelle,
    secteur: roleVue.secteur,
    chemin: roleVue.vue.chemin,
    estActif: roleVue.vue.estActif,
    permission: 'administration',
    roleEspace: roleVue.vue.roleEspace,
    sousOnglets: roleVue.vue.sousOnglets,
    dansMenuVues: true,
  };
}

// Menu déroulant « Vues » : un bouton, un menu aligné sur son bord droit (il s'ouvre vers la gauche), les vues
// groupées par secteur. Se ferme au clic extérieur, avec Échap, et à Tab ; flèches haut/bas, Début et Fin
// naviguent entre les vues.
function MenuVues({ vues, vueActive }) {
  const [ouvert, setOuvert] = useState(false);
  const conteneur = useRef(null);
  const bouton = useRef(null);
  const options = () => [...(conteneur.current?.querySelectorAll('[role="menuitem"]') ?? [])];

  useEffect(() => {
    if (!ouvert) return undefined;
    const clicExterieur = (evenement) => {
      if (!conteneur.current?.contains(evenement.target)) setOuvert(false);
    };
    document.addEventListener('mousedown', clicExterieur);
    return () => document.removeEventListener('mousedown', clicExterieur);
  }, [ouvert]);

  const fermer = (rendreLeFocus) => {
    setOuvert(false);
    if (rendreLeFocus) bouton.current?.focus();
  };

  const ouvrir = (indexInitial) => {
    setOuvert(true);
    // Le menu est rendu au prochain cycle : le focus est posé ensuite.
    setTimeout(() => {
      const liste = options();
      liste.at(indexInitial === 'dernier' ? -1 : 0)?.focus();
    }, 0);
  };

  const surToucheBouton = (evenement) => {
    if (evenement.key === 'ArrowDown' || evenement.key === 'Enter' || evenement.key === ' ') {
      evenement.preventDefault();
      ouvrir('premier');
    } else if (evenement.key === 'ArrowUp') {
      evenement.preventDefault();
      ouvrir('dernier');
    } else if (evenement.key === 'Escape') {
      fermer(false);
    }
  };

  const surToucheMenu = (evenement) => {
    const liste = options();
    const index = liste.indexOf(document.activeElement);
    const aller = (cible) => {
      evenement.preventDefault();
      liste.at(cible % liste.length)?.focus();
    };
    if (evenement.key === 'ArrowDown') aller(index + 1);
    else if (evenement.key === 'ArrowUp') aller(index <= 0 ? liste.length - 1 : index - 1);
    else if (evenement.key === 'Home') aller(0);
    else if (evenement.key === 'End') aller(liste.length - 1);
    else if (evenement.key === 'Escape') {
      evenement.preventDefault();
      fermer(true);
    } else if (evenement.key === 'Tab') fermer(false);
  };

  const groupes = SECTEURS_VUES.map((secteur) => ({ ...secteur, vues: vues.filter((vue) => vue.secteur === secteur.code) })).filter((groupe) => groupe.vues.length > 0);

  return (
    <div className="barre-navigation__vues" ref={conteneur}>
      <button
        type="button"
        ref={bouton}
        className={`barre-navigation__lien barre-navigation__vues-bouton${vueActive ? ' barre-navigation__lien--actif' : ''}`}
        aria-haspopup="menu"
        aria-expanded={ouvert}
        onClick={() => (ouvert ? fermer(false) : setOuvert(true))}
        onKeyDown={surToucheBouton}
      >
        {vueActive ? `Vues : ${vueActive.libelle}` : 'Vues'} <span aria-hidden="true">▾</span>
      </button>
      {ouvert && (
        <div className="barre-navigation__vues-menu" role="menu" aria-label="Vues par rôle" onKeyDown={surToucheMenu}>
          {groupes.map((groupe) => (
            <div key={groupe.code} role="group" aria-label={groupe.libelle} className="barre-navigation__vues-groupe">
              <p className="barre-navigation__vues-secteur" aria-hidden="true">
                {groupe.libelle}
              </p>
              {groupe.vues.map((vue) => (
                <Link
                  key={vue.cle}
                  to={vue.chemin}
                  role="menuitem"
                  className={`barre-navigation__vues-option${vue.estActifVue ? ' barre-navigation__vues-option--actif' : ''}`}
                  aria-current={vue.estActifVue ? 'page' : undefined}
                  onClick={() => setOuvert(false)}
                >
                  {vue.libelle}
                </Link>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Barre de navigation commune aux écrans back-office (refonte 2026-08-17 ; étendue à Formateur/
// Inspecteur le 2026-08-20 — Historique des évaluations/Évaluations à venir/Suivi des tests,
// jusque-là des boutons de retour ad hoc propres à chaque page, voir Evaluation.jsx/
// HistoriqueEvaluations.jsx) : remplace les boutons de retour/navigation auparavant dispersés page
// par page. Montée une seule fois dans PageBackOffice.jsx plutôt que dupliquée dans chaque page —
// même patron que BoutonNouvelleInscription.jsx (auto-gating par rôle via son propre
// useSession()). Ne rend rien tant que la session n'est pas résolue, si personne n'est connecté
// (masquée sur /connexion, cohérent avec EnTeteBackOffice.jsx) ou si le rôle connecté n'a accès à
// aucune des destinations ci-dessus.
// `rolesVues` : définition des rôles dont la vue est proposée à l'Admin (par défaut core/referentiels/rolesVues.js).
export default function BarreNavigation({ rolesVues = ROLES_VUES }) {
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
  const elements = [...ELEMENTS_NAVIGATION, ...rolesVues.filter((roleVue) => roleVue.vue).map(elementDeVue)];
  const elementsVisibles = elements.filter(estVisible);
  if (elementsVisibles.length === 0) {
    return null;
  }
  // Barre principale : tout sauf les vues par rôle, regroupées dans le menu « Vues » (placé en dernier).
  const elementsPrincipaux = elementsVisibles.filter((element) => !element.dansMenuVues);
  const vues = elementsVisibles.filter((element) => element.dansMenuVues).map((element) => ({ ...element, estActifVue: element.estActif(pathname) }));
  const vueActive = vues.find((vue) => vue.estActifVue) ?? null;

  // Sous-onglets de l'espace actif (vues Admin, voir `sousOnglets` ci-dessus) — dans une barre
  // SÉPARÉE, non collante, sous la barre principale : celle-ci est sticky et sa hauteur sert de
  // référence (--hauteur-barre-navigation, PageBackOffice.css) aux autres éléments collants, une
  // seconde rangée à l'intérieur la décalerait. Ordre = ordre de ELEMENTS_NAVIGATION, identique à
  // celui que voit un vrai Formateur/Inspecteur.
  const espaceActif = elementsVisibles.find((element) => element.sousOnglets && element.estActif(pathname));
  const sousOnglets = espaceActif
    ? elements.filter(
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
        className={`barre-navigation${elementsPrincipaux.length + (vues.length > 0 ? 1 : 0) > 6 ? ' barre-navigation--dense' : ''}`}
        aria-label="Navigation back-office"
      >
        {elementsPrincipaux.map((element) => {
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
        {vues.length > 0 && <MenuVues vues={vues} vueActive={vueActive} />}
      </nav>
      {sousOnglets.length > 0 && (
        <nav className="barre-navigation-sous-onglets" aria-label={`Navigation ${espaceActif.libelle}`}>
          {sousOnglets.map((element) => {
            // Rôle de l'espace s'il en a un (Vue Formateur/Inspecteur de l'Admin), sinon rôle connecté
            // (espace « DPAE », 2026-09-30). Actif : règle propre du sous-onglet (plusieurs pages pour
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
