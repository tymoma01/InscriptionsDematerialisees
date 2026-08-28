import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
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
  const { key: cleNavigation } = useLocation();

  // Reclic sur le lien de nav "Historique des évaluations" alors qu'on est déjà sur cette route :
  // React Router ne démonte pas la page (même élément de route), donc `evaluationSelectionnee`
  // ne se réinitialise pas tout seul. `location.key` change à chaque navigation, y compris vers
  // l'URL déjà active — on s'en sert pour revenir à la liste.
  useEffect(() => {
    setEvaluationSelectionnee(null);
  }, [cleNavigation]);

  // Session sans objet à vérifier ici (RouteProtegee, App.jsx, redirige déjà vers /connexion avant
  // même de monter cette page en l'absence de session) — `!utilisateur` ne couvre plus qu'un très
  // bref instant où le useSession() PROPRE à cette page (ci-dessus) n'a pas encore résolu le sien.
  if (chargementSession || !utilisateur) {
    return (
      <PageBackOffice>
        <p>Chargement de la session…</p>
      </PageBackOffice>
    );
  }

  return (
    <PageBackOffice>
      <div className="page-historique-evaluations">
        <header className="page-historique-evaluations__entete">
          <div className="page-historique-evaluations__titre-bloc">
            <h1>Historique des évaluations</h1>
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
