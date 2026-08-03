import { BrowserRouter, Routes, Route } from 'react-router-dom';
import InscriptionTablette from './pages/accueil/InscriptionTablette';
import VerificationPieces from './pages/accueil/VerificationPieces';
import TableauDeBordAccueil from './pages/accueil/TableauDeBordAccueil';
import Relances from './pages/coordination/Relances';
import Planification from './pages/coordination/Planification';
import Backoffice from './pages/recruteur/Backoffice';
import Validation from './pages/recruteur/Validation';
import Evaluation from './pages/formateur/Evaluation';
import HistoriqueEvaluations from './pages/formateur/HistoriqueEvaluations';
import Utilisateurs from './pages/admin/Utilisateurs';
import Indicateurs from './pages/tableauDeBord/Indicateurs';
import Connexion from './pages/connexion/Connexion';

// Table de routes minimale : inscription (candidat, sans authentification), connexion (agent) et
// les écrans internes — tableau de bord, vérification des pièces justificatives, relances, back-
// office recruteur, évaluation formateur, gestion des comptes admin et indicateurs KPI — tous
// protégés côté serveur (requireAuth + requireRole, voir backend/src/api/routes) : pas de garde
// de route ici, une page sans session valide affiche déjà son propre message (voir
// TableauDeBordAccueil.jsx / CaptureTablette.jsx), même principe que CaptureTablette avant elle.
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
        <Route path="/recruteur/dossiers" element={<Backoffice />} />
        <Route path="/recruteur/dossiers/:dossierId/validation" element={<Validation />} />
        <Route path="/formateur/evaluations" element={<Evaluation />} />
        <Route path="/formateur/historique" element={<HistoriqueEvaluations />} />
        <Route path="/admin/utilisateurs" element={<Utilisateurs />} />
        <Route path="/tableau-de-bord/indicateurs" element={<Indicateurs />} />
      </Routes>
    </BrowserRouter>
  );
}
