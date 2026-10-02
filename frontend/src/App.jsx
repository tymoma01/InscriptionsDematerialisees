import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import InscriptionTablette from './pages/accueil/InscriptionTablette';
import VerificationPieces from './pages/accueil/VerificationPieces';
import TableauDeBordAccueil from './pages/accueil/TableauDeBordAccueil';
import Relances from './pages/coordination/Relances';
import Formation from './pages/coordination/Formation';
import Tests from './pages/coordination/Tests';
import Planification from './pages/coordination/Planification';
import SuiviFormation from './pages/coordination/SuiviFormation';
import Validation from './pages/recruteur/Validation';
import Evaluation from './pages/evaluation/Evaluation';
import HistoriqueEvaluations from './pages/evaluation/HistoriqueEvaluations';
import Utilisateurs from './pages/admin/Utilisateurs';
import Indicateurs from './pages/tableauDeBord/Indicateurs';
import Connexion from './pages/connexion/Connexion';
import DemandeDpae from './pages/coordination/DemandeDpae';
import SuiviDemandesDpae from './pages/coordination/SuiviDemandesDpae';
import TableauDeBordDpae from './pages/coordination/TableauDeBordDpae';
import TraitementDpae from './pages/rh/TraitementDpae';
import DetailDemandeDpae from './pages/rh/DetailDemandeDpae';
import RouteProtegee from './core/auth/RouteProtegee';
import { ROLE_INSPECTEUR_HOTELLERIE } from './core/auth/permissions';

// Table de routes minimale : inscription (candidat, sans authentification), connexion (agent) et
// les écrans internes — tableau de bord, vérification des pièces justificatives, relances,
// évaluation formateur, évaluation inspecteur (postes bureau, section distincte du formateur —
// hôtel), gestion des comptes admin et indicateurs KPI — tous protégés côté serveur (requireAuth +
// requirePermission, voir backend/src/api/routes). RouteProtegee (`permission`, clé de
// backend/src/core/auth/permissions.js) ne fait qu'éviter d'afficher une page que le serveur
// refuserait : redirection vers /connexion sans session, vers l'écran du rôle sans la permission.
//
// Ancienne page "Back-office recruteur" (/recruteur/dossiers, Backoffice.jsx) supprimée : son
// unique action propre à la liste ("Étudier le dossier") a été fusionnée dans "Dossiers candidats"
// (TableauDeBordAccueil.jsx) — même colonnes, mêmes filtres, même route API, mêmes rôles côté
// back, l'audit n'a relevé aucune autre différence. La route détail /recruteur/dossiers/:id/
// validation (Validation.jsx) reste inchangée, atteinte depuis les deux pages ainsi que depuis
// TableauDossiersSelectionnes.jsx. Redirection ci-dessous pour tout lien externe encore posé vers
// l'ancienne URL de liste.
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<InscriptionTablette />} />
        <Route path="/connexion" element={<Connexion />} />
        <Route
          path="/accueil/tableau-de-bord"
          element={
            <RouteProtegee permission="listeDossiers">
              <TableauDeBordAccueil />
            </RouteProtegee>
          }
        />
        <Route
          path="/accueil/dossiers/:dossierId/pieces"
          element={
            // Écran de GESTION des pièces : réservé aux rôles qui peuvent écrire
            // (permission gestionPieces) — les autres consultent les pièces
            // depuis la fiche dossier, jamais cet écran dont toutes les actions leur sont refusées.
            <RouteProtegee permission="gestionPieces">
              <VerificationPieces />
            </RouteProtegee>
          }
        />
        <Route
          path="/coordination/dossiers/:dossierId/relances"
          element={
            // Réservé aux rôles qui peuvent lire ces données côté serveur : la RH
            // qui tape l'adresse est renvoyée vers sa page d'accueil.
            <RouteProtegee permission="lectureRelances">
              <Relances />
            </RouteProtegee>
          }
        />
        <Route
          path="/coordination/dossiers/:dossierId/formation"
          element={
            // Réservé aux rôles qui peuvent lire ces données côté serveur : la RH
            // qui tape l'adresse est renvoyée vers sa page d'accueil.
            <RouteProtegee permission="lectureFormation">
              <Formation />
            </RouteProtegee>
          }
        />
        <Route
          path="/coordination/dossiers/:dossierId/tests"
          element={
            // Réservé aux rôles qui peuvent lire ces données côté serveur : la RH
            // qui tape l'adresse est renvoyée vers sa page d'accueil.
            <RouteProtegee permission="lectureRendezvous">
              <Tests />
            </RouteProtegee>
          }
        />
        <Route
          path="/coordination/planification"
          element={
            <RouteProtegee permission="suiviTests">
              <Planification />
            </RouteProtegee>
          }
        />
        <Route
          path="/coordination/suivi-formation"
          element={
            <RouteProtegee permission="suiviFormation">
              <SuiviFormation />
            </RouteProtegee>
          }
        />
        {/* Onglet Admin « Vue Inspecteur Hôtellerie » : même écran que Dossiers candidats,
            avec le périmètre de ce rôle appliqué côté serveur (paramètre `vue`, Admin uniquement).
            Chemin dédié : l'onglet reste actif tant que l'Admin navigue dans cette vue ; `key`
            remonte l'écran à neuf en passant de « Dossiers candidats » à cette vue. */}
        <Route
          path="/vue-inspecteur-hotellerie/dossiers"
          element={
            <RouteProtegee permission="administration">
              <TableauDeBordAccueil key="vue-inspecteur-hotellerie" vue={ROLE_INSPECTEUR_HOTELLERIE} />
            </RouteProtegee>
          }
        />
        <Route path="/recruteur/dossiers" element={<Navigate to="/accueil/tableau-de-bord" replace />} />
        <Route
          path="/recruteur/dossiers/:dossierId/validation"
          element={
            <RouteProtegee>
              <Validation />
            </RouteProtegee>
          }
        />
        <Route
          path="/formateur/evaluations"
          element={
            <RouteProtegee permission="evaluation">
              <Evaluation key="hotellerie" secteur="hotellerie" />
            </RouteProtegee>
          }
        />
        <Route
          path="/formateur/historique"
          element={
            <RouteProtegee permission="evaluation">
              <HistoriqueEvaluations key="hotellerie" secteur="hotellerie" />
            </RouteProtegee>
          }
        />
        <Route
          path="/inspecteur/evaluations"
          element={
            <RouteProtegee permission="evaluation">
              <Evaluation key="tertiaire" secteur="tertiaire" />
            </RouteProtegee>
          }
        />
        <Route
          path="/inspecteur/historique"
          element={
            <RouteProtegee permission="evaluation">
              <HistoriqueEvaluations key="tertiaire" secteur="tertiaire" />
            </RouteProtegee>
          }
        />
        <Route
          path="/admin/utilisateurs"
          element={
            <RouteProtegee permission="administration">
              <Utilisateurs />
            </RouteProtegee>
          }
        />
        <Route
          path="/tableau-de-bord/indicateurs"
          element={
            <RouteProtegee permission="statistiques">
              <Indicateurs />
            </RouteProtegee>
          }
        />
        {/* Module Demandes DPAE (2026-09-28, spécifique à ACCECIT — voir Modularité, CLAUDE.md).
            Périmètre révisé le 2026-09-30 : créer une demande : Planning/Admin
            (dpaeCreation) ; suivre les demandes et ouvrir une fiche : Admin/RH/Planning
            (dpaeConsultation) ; file de traitement RH : RH/Admin (dpaeTraitementRh).
            Accueil/Coordination : aucun accès. Voir core/auth/permissions.js, miroir de
            backend/src/core/auth/rbac.js. */}
        <Route
          path="/coordination/dpae/nouvelle"
          element={
            <RouteProtegee permission="dpaeCreation">
              <DemandeDpae />
            </RouteProtegee>
          }
        />
        <Route
          path="/coordination/dpae/suivi"
          element={
            <RouteProtegee permission="dpaeConsultation">
              <SuiviDemandesDpae />
            </RouteProtegee>
          }
        />
        {/* Tableau de bord DPAE (onglet RH, 2026-09-30) — mêmes rôles que le suivi (Admin, RH,
            Planning), contrôlés aussi côté serveur (dpae.routes.js, GET /tableau-de-bord). */}
        <Route
          path="/coordination/dpae/tableau-de-bord"
          element={
            <RouteProtegee permission="dpaeTableauDeBord">
              <TableauDeBordDpae />
            </RouteProtegee>
          }
        />
        <Route
          path="/rh/dpae"
          element={
            <RouteProtegee permission="dpaeTraitementRh">
              <TraitementDpae />
            </RouteProtegee>
          }
        />
        <Route
          path="/rh/dpae/:demandeId"
          element={
            <RouteProtegee permission="dpaeConsultation">
              <DetailDemandeDpae />
            </RouteProtegee>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
