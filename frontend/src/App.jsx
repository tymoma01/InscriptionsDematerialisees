import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import InscriptionTablette from './pages/accueil/InscriptionTablette';
import VerificationPieces from './pages/accueil/VerificationPieces';
import TableauDeBordAccueil from './pages/accueil/TableauDeBordAccueil';
import Relances from './pages/coordination/Relances';
import Tests from './pages/coordination/Tests';
import Planification from './pages/coordination/Planification';
import SuiviFormation from './pages/coordination/SuiviFormation';
import Validation from './pages/recruteur/Validation';
import Evaluation from './pages/formateur/Evaluation';
import HistoriqueEvaluations from './pages/formateur/HistoriqueEvaluations';
import EvaluationInspecteur from './pages/inspecteur/Evaluation';
import HistoriqueEvaluationsInspecteur from './pages/inspecteur/HistoriqueEvaluations';
import Utilisateurs from './pages/admin/Utilisateurs';
import Indicateurs from './pages/tableauDeBord/Indicateurs';
import Connexion from './pages/connexion/Connexion';
import RouteProtegee from './core/auth/RouteProtegee';

// Table de routes minimale : inscription (candidat, sans authentification), connexion (agent) et
// les écrans internes — tableau de bord, vérification des pièces justificatives, relances,
// évaluation formateur, évaluation inspecteur (postes bureau, section distincte du formateur —
// hôtel), gestion des comptes admin et indicateurs KPI — tous protégés côté serveur (requireAuth +
// requireRole, voir backend/src/api/routes) ET côté client par RouteProtegee (audit 2026-08-25,
// voir son commentaire d'en-tête) : la garde côté serveur reste la seule autorité sur le RÔLE
// autorisé, RouteProtegee ne fait que renvoyer vers /connexion?redirection=... un visiteur sans
// session du tout, avant même de monter la page et son premier aller-retour réseau voué à échouer.
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
            <RouteProtegee>
              <TableauDeBordAccueil />
            </RouteProtegee>
          }
        />
        <Route
          path="/accueil/dossiers/:dossierId/pieces"
          element={
            <RouteProtegee>
              <VerificationPieces />
            </RouteProtegee>
          }
        />
        <Route
          path="/coordination/dossiers/:dossierId/relances"
          element={
            <RouteProtegee>
              <Relances />
            </RouteProtegee>
          }
        />
        <Route
          path="/coordination/dossiers/:dossierId/tests"
          element={
            <RouteProtegee>
              <Tests />
            </RouteProtegee>
          }
        />
        <Route
          path="/coordination/planification"
          element={
            <RouteProtegee>
              <Planification />
            </RouteProtegee>
          }
        />
        <Route
          path="/coordination/suivi-formation"
          element={
            <RouteProtegee>
              <SuiviFormation />
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
            <RouteProtegee>
              <Evaluation />
            </RouteProtegee>
          }
        />
        <Route
          path="/formateur/historique"
          element={
            <RouteProtegee>
              <HistoriqueEvaluations />
            </RouteProtegee>
          }
        />
        <Route
          path="/inspecteur/evaluations"
          element={
            <RouteProtegee>
              <EvaluationInspecteur />
            </RouteProtegee>
          }
        />
        <Route
          path="/inspecteur/historique"
          element={
            <RouteProtegee>
              <HistoriqueEvaluationsInspecteur />
            </RouteProtegee>
          }
        />
        <Route
          path="/admin/utilisateurs"
          element={
            <RouteProtegee>
              <Utilisateurs />
            </RouteProtegee>
          }
        />
        <Route
          path="/tableau-de-bord/indicateurs"
          element={
            <RouteProtegee>
              <Indicateurs />
            </RouteProtegee>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
