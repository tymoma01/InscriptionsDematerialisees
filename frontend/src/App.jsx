import { BrowserRouter, Routes, Route } from 'react-router-dom';
import InscriptionTablette from './pages/accueil/InscriptionTablette';
import VerificationPieces from './pages/accueil/VerificationPieces';
import TableauDeBordAccueil from './pages/accueil/TableauDeBordAccueil';
import Relances from './pages/coordination/Relances';
import Backoffice from './pages/recruteur/Backoffice';
import Validation from './pages/recruteur/Validation';
import Connexion from './pages/connexion/Connexion';

// Table de routes minimale : inscription (candidat, sans authentification), connexion (agent) et
// les écrans internes — tableau de bord, vérification des pièces justificatives, relances et
// back-office recruteur — tous protégés côté serveur (requireAuth + requireRole, voir
// backend/src/api/routes) : pas de garde de route ici, une page sans session valide affiche déjà
// son propre message (voir TableauDeBordAccueil.jsx / CaptureTablette.jsx), même principe que
// CaptureTablette avant elle. Formateur/admin viendront au fur et à mesure des chantiers suivants.
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<InscriptionTablette />} />
        <Route path="/connexion" element={<Connexion />} />
        <Route path="/accueil/tableau-de-bord" element={<TableauDeBordAccueil />} />
        <Route path="/accueil/dossiers/:dossierId/pieces" element={<VerificationPieces />} />
        <Route path="/coordination/dossiers/:dossierId/relances" element={<Relances />} />
        <Route path="/recruteur/dossiers" element={<Backoffice />} />
        <Route path="/recruteur/dossiers/:dossierId/validation" element={<Validation />} />
      </Routes>
    </BrowserRouter>
  );
}
