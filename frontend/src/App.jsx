import { BrowserRouter, Routes, Route } from 'react-router-dom';
import InscriptionTablette from './pages/accueil/InscriptionTablette';
import VerificationPieces from './pages/accueil/VerificationPieces';

// Table de routes minimale : inscription (accueil) et vérification des pièces justificatives
// (accueil, étape suivante du parcours) — coordination/recruteur/formateur/admin viendront au
// fur et à mesure des chantiers suivants, pas encore de table de routes complète.
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<InscriptionTablette />} />
        <Route path="/accueil/dossiers/:dossierId/pieces" element={<VerificationPieces />} />
      </Routes>
    </BrowserRouter>
  );
}
