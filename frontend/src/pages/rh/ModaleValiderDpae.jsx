import { useEffect } from 'react';
import './ModaleRejeterDpae.css';

// Confirmation de la validation d'une demande DPAE — même
// fenêtre et même style que ModaleRejeterDpae.jsx (feuille de style partagée), sans champ de saisie :
// un rappel des informations clés, la mention du caractère définitif, puis « Annuler » /
// « Confirmer la validation ». Jamais window.confirm.
//
// `recapitulatif` : [[libelle, valeur], ...] déjà mis en forme par la fiche (DetailDemandeDpae.jsx,
// mêmes libellés et formats que ses propres sections) ; une valeur vide s'affiche « — ».
// Échap et clic en dehors de la fenêtre = « Annuler », sauf pendant l'envoi (le bouton « Annuler »
// est alors lui aussi désactivé). Une erreur du serveur s'affiche ici, la fenêtre restant ouverte.
export default function ModaleValiderDpae({ recapitulatif, onConfirmer, onAnnuler, enCours, erreur }) {
  useEffect(() => {
    const surTouche = (evenement) => {
      if (evenement.key === 'Escape' && !enCours) onAnnuler();
    };
    document.addEventListener('keydown', surTouche);
    return () => document.removeEventListener('keydown', surTouche);
  }, [enCours, onAnnuler]);

  const confirmer = (evenement) => {
    evenement.preventDefault();
    if (enCours) return;
    onConfirmer();
  };

  return (
    <div
      className="modale-rejeter-dpae__fond"
      // Clic sur le fond seulement (pas sur un élément de la fenêtre, dont les clics remontent ici).
      onClick={(evenement) => {
        if (evenement.target === evenement.currentTarget && !enCours) onAnnuler();
      }}
    >
      <div className="modale-rejeter-dpae modale-rejeter-dpae--validation" role="dialog" aria-modal="true" aria-labelledby="titre-valider-dpae">
        <h2 id="titre-valider-dpae">Valider cette demande DPAE ?</h2>
        <form onSubmit={confirmer}>
          <dl className="modale-rejeter-dpae__recapitulatif">
            {recapitulatif.map(([libelle, valeur]) => (
              <div key={libelle}>
                <dt>{libelle}</dt>
                <dd>{valeur || '—'}</dd>
              </div>
            ))}
          </dl>

          <p className="modale-rejeter-dpae__mention">Cette décision est définitive.</p>

          {erreur && <p role="alert">{erreur}</p>}

          <div className="modale-rejeter-dpae__actions">
            <button type="button" onClick={onAnnuler} disabled={enCours}>
              Annuler
            </button>
            <button type="submit" disabled={enCours} autoFocus>
              {enCours ? 'Validation…' : 'Confirmer la validation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
