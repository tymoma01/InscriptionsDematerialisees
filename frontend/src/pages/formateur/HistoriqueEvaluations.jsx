import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../../core/auth/useSession';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import HistoriqueEvaluations from '../../core/evaluation/HistoriqueEvaluations';
import DetailEvaluation from '../../core/evaluation/DetailEvaluation';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import './HistoriqueEvaluations.css';

// Écran formateur : historique des évaluations déjà soumises par CE formateur (jamais tous
// formateurs confondus, voir backend evaluationEngine.listerHistorique) — même patron "un seul
// écran à deux états" qu'Evaluation.jsx (liste puis détail), route séparée plutôt qu'un onglet
// dans Evaluation.jsx : ce projet n'utilise nulle part d'onglets, chaque vue a sa propre URL.
export default function PageHistoriqueEvaluations() {
  const { utilisateur, chargement: chargementSession } = useSession();
  const [evaluationSelectionnee, setEvaluationSelectionnee] = useState(null);

  if (chargementSession) {
    return (
      <PageBackOffice>
        <p>Chargement de la session…</p>
      </PageBackOffice>
    );
  }

  if (!utilisateur) {
    return (
      <PageBackOffice>
        <p role="alert">
          Vous devez être connecté pour consulter l’historique des évaluations. <Link to="/connexion">Se connecter</Link>
        </p>
      </PageBackOffice>
    );
  }

  return (
    <PageBackOffice>
      <div className="page-historique-evaluations">
        <header className="page-historique-evaluations__entete">
          <div className="page-historique-evaluations__titre-bloc">
            <h1>Historique des évaluations</h1>
            <Link to="/formateur/evaluations" className="page-historique-evaluations__lien-retour">
              Évaluations à faire
            </Link>
          </div>
          <EnTeteBackOffice />
        </header>

        {!evaluationSelectionnee && <HistoriqueEvaluations onSelectionner={setEvaluationSelectionnee} />}

        {evaluationSelectionnee && (
          <DetailEvaluation evaluationId={evaluationSelectionnee.id} onFermer={() => setEvaluationSelectionnee(null)} />
        )}
      </div>
    </PageBackOffice>
  );
}
