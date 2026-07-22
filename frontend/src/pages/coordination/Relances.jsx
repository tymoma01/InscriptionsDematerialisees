import { useParams } from 'react-router-dom';
import HistoriqueRelances from '../../core/dossier/HistoriqueRelances';
import GestionRendezvous from '../../core/dossier/GestionRendezvous';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import './Relances.css';

// Page coordination : relances et rendez-vous d'un dossier (CLAUDE.md, étape "relances et
// reprogrammations"), les deux concernant le même besoin de suivi terrain — regroupées sur un
// même écran plutôt qu'éclatées, pour que la coordination voie en un coup d'œil l'historique des
// contacts ET les rendez-vous en cours. Lit dossierId depuis le paramètre de route et le
// transmet — ni HistoriqueRelances.jsx ni GestionRendezvous.jsx ne connaissent le routage, même
// patron que VerificationPieces.jsx pour CaptureTablette.jsx.
export default function Relances() {
  const { dossierId } = useParams();

  return (
    <PageBackOffice>
      <div className="page-relances">
        <EnTeteBackOffice />
        <GestionRendezvous dossierId={dossierId} />
        <HistoriqueRelances dossierId={dossierId} />
      </div>
    </PageBackOffice>
  );
}
