import { useParams } from 'react-router-dom';
import CaptureTablette from '../../core/pieceJustificative/CaptureTablette';
import { typesPiecesConfigAccecitTest } from '../../core/pieceJustificative/donneesTest/typesPiecesConfig.accecit';

// Page accueil : prise des pièces justificatives (CLAUDE.md, étape 3 du parcours), une fois le
// candidat inscrit. Lit dossierId depuis le paramètre de route et transmet la config des types
// de pièces de l'entité — donnée de test locale tant que le backend n'expose pas cette
// configuration (voir typesPiecesConfig.accecit.js), même patron que InscriptionTablette.jsx
// pour formulaireConfig.accecit.js. CaptureTablette.jsx lui-même ne connaît pas le routage
// (voir son commentaire d'en-tête) : c'est cette page qui fait le lien.
export default function VerificationPieces() {
  const { dossierId } = useParams();

  return (
    <main className="page-verification-pieces">
      <CaptureTablette dossierId={dossierId} typesPieces={typesPiecesConfigAccecitTest} />
    </main>
  );
}
