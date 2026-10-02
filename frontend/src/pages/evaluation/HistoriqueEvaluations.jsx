import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useSession } from '../../core/auth/useSession';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import HistoriqueEvaluations from '../../core/evaluation/HistoriqueEvaluations';
import DetailEvaluation from '../../core/evaluation/DetailEvaluation';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import './HistoriqueEvaluations.css';

// « Historique des évaluations » d'un secteur — même page pour le Formateur ('hotellerie') et
// l'Inspecteur ('tertiaire'), voir Evaluation.jsx. Tertiaire : historique partagé entre
// Inspecteurs, d'où la colonne « Inspecteur ».
export default function PageHistoriqueEvaluations({ secteur }) {
  const { utilisateur, chargement: chargementSession } = useSession();
  const [evaluationSelectionnee, setEvaluationSelectionnee] = useState(null);
  const { key: cleNavigation } = useLocation();

  useEffect(() => {
    setEvaluationSelectionnee(null);
  }, [cleNavigation]);

  if (chargementSession || !utilisateur) {
    return (
      <PageBackOffice>
        <p>Chargement de la session…</p>
      </PageBackOffice>
    );
  }

  const secteurVueAdmin = utilisateur.roleCode === 'admin' ? secteur : undefined;

  return (
    <PageBackOffice>
      <div className="page-historique-evaluations">
        <header className="page-historique-evaluations__entete">
          <div className="page-historique-evaluations__titre-bloc">
            <h1>Historique des évaluations</h1>
          </div>
          <EnTeteBackOffice />
        </header>

        {!evaluationSelectionnee && (
          <HistoriqueEvaluations
            onSelectionner={setEvaluationSelectionnee}
            secteurVueAdmin={secteurVueAdmin}
            afficherInspecteur={secteur === 'tertiaire'}
          />
        )}

        {evaluationSelectionnee && (
          <DetailEvaluation evaluationId={evaluationSelectionnee.id} onFermer={() => setEvaluationSelectionnee(null)} />
        )}
      </div>
    </PageBackOffice>
  );
}
