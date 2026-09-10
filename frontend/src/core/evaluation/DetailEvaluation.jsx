import { useEffect, useState } from 'react';
import { obtenirDetailEvaluation } from '../../services/evaluationService';
import ContenuDetailEvaluation from './ContenuDetailEvaluation';
import './DetailEvaluation.css';

// Détail en lecture seule d'une évaluation déjà soumise — jamais modifiable depuis cet écran
// (contrairement à GrilleEvaluation.jsx, qui saisit une évaluation en cours). `evaluationId` reçu
// en prop (voir HistoriqueEvaluations.jsx, bouton "Voir le détail") — ce composant ne connaît pas
// le routage, même patron que GrilleEvaluation.jsx/ListeEvaluationsAFaire.jsx.
//
// Le balisage/les libellés du détail lui-même vivent dans ContenuDetailEvaluation.jsx (extrait le
// 2026-09-10, réutilisé tel quel par Validation.jsx pour la section "Critères de validation du
// test" de la fiche dossier) — ce composant-ci n'ajoute que ce qui lui est propre : le fetch par
// evaluationId, le chargement/l'erreur, et le bouton "Retour à l'historique" (sans objet pour un
// affichage inline comme celui de Validation.jsx).
export default function DetailEvaluation({ evaluationId, onFermer }) {
  const [detail, setDetail] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);

  useEffect(() => {
    let annule = false;
    setChargement(true);
    setErreur(null);
    obtenirDetailEvaluation(evaluationId)
      .then((valeur) => {
        if (!annule) setDetail(valeur);
      })
      .catch((erreur) => {
        if (!annule) setErreur(erreur.response?.data?.erreur ?? "Impossible de récupérer le détail de cette évaluation.");
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, [evaluationId]);

  if (chargement) {
    return <p>Chargement du détail…</p>;
  }
  if (erreur) {
    return (
      <div className="detail-evaluation">
        <p role="alert">{erreur}</p>
        <button type="button" onClick={onFermer}>
          Retour à l’historique
        </button>
      </div>
    );
  }

  return (
    <div className="detail-evaluation">
      <ContenuDetailEvaluation detail={detail} />
      <div className="detail-evaluation__actions">
        <button type="button" onClick={onFermer}>
          Retour à l’historique
        </button>
      </div>
    </div>
  );
}
