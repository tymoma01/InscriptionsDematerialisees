import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import InscriptionTablette from './pages/accueil/InscriptionTablette';
import VerificationPieces from './pages/accueil/VerificationPieces';
import TableauDeBordAccueil from './pages/accueil/TableauDeBordAccueil';
import Relances from './pages/coordination/Relances';
import Planification from './pages/coordination/Planification';
import Validation from './pages/recruteur/Validation';
import Evaluation from './pages/formateur/Evaluation';
import HistoriqueEvaluations from './pages/formateur/HistoriqueEvaluations';
import EvaluationInspecteur from './pages/inspecteur/Evaluation';
import HistoriqueEvaluationsInspecteur from './pages/inspecteur/HistoriqueEvaluations';
import Utilisateurs from './pages/admin/Utilisateurs';
import Indicateurs from './pages/tableauDeBord/Indicateurs';
import Connexion from './pages/connexion/Connexion';

// Table de routes minimale : inscription (candidat, sans authentification), connexion (agent) et
// les écrans internes — tableau de bord, vérification des pièces justificatives, relances,
// évaluation formateur, évaluation inspecteur (postes bureau, section distincte du formateur —
// hôtel), gestion des comptes admin et indicateurs KPI — tous protégés côté serveur (requireAuth +
// requireRole, voir backend/src/api/routes) : pas de garde de route ici, une page sans session
// valide affiche déjà son propre message (voir TableauDeBordAccueil.jsx / CaptureTablette.jsx),
// même principe que CaptureTablette avant elle.
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
        <Route path="/accueil/tableau-de-bord" element={<TableauDeBordAccueil />} />
        <Route path="/accueil/dossiers/:dossierId/pieces" element={<VerificationPieces />} />
        <Route path="/coordination/dossiers/:dossierId/relances" element={<Relances />} />
        <Route path="/coordination/planification" element={<Planification />} />
        <Route path="/recruteur/dossiers" element={<Navigate to="/accueil/tableau-de-bord" replace />} />
        <Route path="/recruteur/dossiers/:dossierId/validation" element={<Validation />} />
        <Route path="/formateur/evaluations" element={<Evaluation />} />
        <Route path="/formateur/historique" element={<HistoriqueEvaluations />} />
        <Route path="/inspecteur/evaluations" element={<EvaluationInspecteur />} />
        <Route path="/inspecteur/historique" element={<HistoriqueEvaluationsInspecteur />} />
        <Route path="/admin/utilisateurs" element={<Utilisateurs />} />
        <Route path="/tableau-de-bord/indicateurs" element={<Indicateurs />} />
      </Routes>
    </BrowserRouter>
  );
}
