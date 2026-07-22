import { useParams } from 'react-router-dom';
import CaptureTablette from '../../core/pieceJustificative/CaptureTablette';
import { typesPiecesConfigAccecitTest } from '../../core/pieceJustificative/donneesTest/typesPiecesConfig.accecit';
import PageBackOffice from '../../core/backOffice/PageBackOffice';

// Page accueil : prise des pièces justificatives (CLAUDE.md, étape 3 du parcours), une fois le
// candidat inscrit. Lit dossierId depuis le paramètre de route et transmet la config des types
// de pièces de l'entité — donnée de test locale tant que le backend n'expose pas cette
// configuration (voir typesPiecesConfig.accecit.js), même patron que InscriptionTablette.jsx
// pour formulaireConfig.accecit.js. CaptureTablette.jsx lui-même ne connaît pas le routage
// (voir son commentaire d'en-tête) : c'est cette page qui fait le lien. PageBackOffice fournit
// l'habillage commun aux pages back-office (en-tête/pied de page/filigrane, voir son commentaire
// d'en-tête) — première page à l'utiliser, voir aussi pages/admin/Utilisateurs.jsx.
export default function VerificationPieces() {
  const { dossierId } = useParams();

  return (
    <PageBackOffice>
      <CaptureTablette dossierId={dossierId} typesPieces={typesPiecesConfigAccecitTest} />
    </PageBackOffice>
  );
}
