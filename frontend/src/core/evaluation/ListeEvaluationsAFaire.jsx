import { useEffect, useState } from 'react';
import { listerRendezvousAEvaluer } from '../../services/evaluationService';
import './ListeEvaluationsAFaire.css';

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

// Liste des rendez-vous de test assignés au formateur connecté et pas encore évalués (voir
// backend GET /api/evaluations/a-faire — déjà filtrée par formateur et par "pas déjà évalué",
// rien à filtrer ici). `rafraichir` : changer sa valeur force un rechargement (utilisé par
// Evaluation.jsx après une évaluation soumise). `onSelectionner` laisse à l'appelant la décision
// d'ouvrir la grille — ce composant ne connaît pas GrilleEvaluation.jsx.
export default function ListeEvaluationsAFaire({ onSelectionner, rafraichir }) {
  const [rendezvous, setRendezvous] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);

  useEffect(() => {
    let annule = false;
    setChargement(true);
    setErreur(null);
    listerRendezvousAEvaluer()
      .then((valeur) => {
        if (!annule) setRendezvous(valeur);
      })
      .catch(() => {
        if (!annule) setErreur('Impossible de récupérer les évaluations à faire.');
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, [rafraichir]);

  if (chargement) {
    return <p>Chargement…</p>;
  }
  if (erreur) {
    return <p role="alert">{erreur}</p>;
  }
  if (rendezvous.length === 0) {
    return <p className="liste-evaluations__vide">Aucune évaluation à faire pour l’instant.</p>;
  }

  return (
    <ul className="liste-evaluations">
      {rendezvous.map((rdv) => (
        <li key={rdv.id} className="liste-evaluations__item">
          <span className="liste-evaluations__candidat">
            {rdv.candidat_prenom} {rdv.candidat_nom}
          </span>
          <span className="liste-evaluations__date">{FORMAT_DATE.format(new Date(rdv.date_heure))}</span>
          <button type="button" onClick={() => onSelectionner(rdv)}>
            Évaluer
          </button>
        </li>
      ))}
    </ul>
  );
}
