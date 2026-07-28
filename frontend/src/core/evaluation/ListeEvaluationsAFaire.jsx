import { useEffect, useState } from 'react';
import { listerRendezvousAEvaluer } from '../../services/evaluationService';
import { appliquerTransition } from '../../services/transitionService';
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
  const [enCoursId, setEnCoursId] = useState(null);
  const [erreurAction, setErreurAction] = useState(null);

  useEffect(() => {
    let annule = false;
    setChargement(true);
    setErreur(null);
    listerRendezvousAEvaluer()
      .then((valeur) => {
        if (!annule) setRendezvous(valeur);
      })
      .catch((erreur) => {
        if (!annule) setErreur(erreur.response?.data?.erreur ?? 'Impossible de récupérer les évaluations à faire.');
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, [rafraichir]);

  // Aucune grille associée (contrairement à "Évaluer" — voir GrilleEvaluation.jsx) : une seule
  // transition (voir workflowEngine.appliquerTransition), commentaire auto-généré comme le fait
  // déjà CaptureTablette.jsx pour "Planifier un test", pas de formulaire à ouvrir pour si peu.
  // Retrait local de la liste au succès : GET /evaluations/a-faire filtre déjà par dossier au
  // statut test_planifie (voir evaluationRepository.listerRendezvousAEvaluer), donc ce rendez-vous
  // ne réapparaîtrait de toute façon plus après un rechargement complet.
  const marquerNonRealise = async (rdv) => {
    setEnCoursId(rdv.id);
    setErreurAction(null);
    try {
      await appliquerTransition(rdv.dossier_id, {
        codeAction: 'test_non_realise',
        commentaire: `Test non réalisé le ${FORMAT_DATE.format(new Date(rdv.date_heure))}.`,
      });
      setRendezvous((precedent) => precedent.filter((r) => r.id !== rdv.id));
    } catch (erreur) {
      setErreurAction(
        erreur.response
          ? (erreur.response.data?.erreur ?? "Impossible d'enregistrer ce test comme non réalisé. Merci de réessayer.")
          : 'Connexion au serveur impossible. Vérifiez le réseau et réessayez.',
      );
    } finally {
      setEnCoursId(null);
    }
  };

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
    <>
      {erreurAction && <p role="alert">{erreurAction}</p>}
      <ul className="liste-evaluations">
        {rendezvous.map((rdv) => (
          <li key={rdv.id} className="liste-evaluations__item">
            <span className="liste-evaluations__candidat">
              {rdv.candidat_prenom} {rdv.candidat_nom}
            </span>
            <span className="liste-evaluations__date">{FORMAT_DATE.format(new Date(rdv.date_heure))}</span>
            <button
              type="button"
              className="liste-evaluations__bouton-secondaire"
              disabled={enCoursId === rdv.id}
              onClick={() => marquerNonRealise(rdv)}
            >
              {enCoursId === rdv.id ? 'Enregistrement...' : 'Test non réalisé'}
            </button>
            <button type="button" disabled={enCoursId === rdv.id} onClick={() => onSelectionner(rdv)}>
              Évaluer
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
