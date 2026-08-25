import { useState } from 'react';
import { useSession } from '../../core/auth/useSession';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import HistoriqueEvaluations from '../../core/evaluation/HistoriqueEvaluations';
import DetailEvaluation from '../../core/evaluation/DetailEvaluation';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import './HistoriqueEvaluations.css';

// Écran inspecteur : historique des évaluations déjà soumises par CET inspecteur (jamais tous
// formateurs/inspecteurs confondus, voir backend evaluationEngine.listerHistorique — scopé par
// utilisateur connecté, pas par rôle). Dupliqué depuis pages/formateur/HistoriqueEvaluations.jsx,
// même patron "un seul écran à deux états" (liste puis détail) — core/evaluation/
// HistoriqueEvaluations.jsx et DetailEvaluation.jsx sont entièrement réutilisés tels quels, aucune
// variante propre à l'inspecteur : le libellé "Validé — prêt à l'embauche" (orientation NULL)
// s'y affiche déjà correctement pour un verdict bureau.
export default function PageHistoriqueEvaluationsInspecteur() {
  const { utilisateur, chargement: chargementSession } = useSession();
  const [evaluationSelectionnee, setEvaluationSelectionnee] = useState(null);

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
      <div className="page-historique-evaluations-inspecteur">
        <header className="page-historique-evaluations-inspecteur__entete">
          <div className="page-historique-evaluations-inspecteur__titre-bloc">
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
