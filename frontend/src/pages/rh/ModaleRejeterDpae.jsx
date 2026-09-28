import { useState } from 'react';
import './ModaleRejeterDpae.css';

// Confirmation du rejet d'une demande DPAE — motif obligatoire (voir demandeDpaeService.rejeter,
// même exigence côté serveur), même patron que ModaleForcerStatut.jsx (core/dossier/) en plus
// simple : pas de liste de statuts à choisir, un seul champ.
export default function ModaleRejeterDpae({ onConfirmer, onAnnuler, enCours, erreur }) {
  const [motif, setMotif] = useState('');

  const confirmer = (evenement) => {
    evenement.preventDefault();
    if (!motif.trim()) return;
    onConfirmer(motif.trim());
  };

  return (
    <div className="modale-rejeter-dpae__fond">
      <div className="modale-rejeter-dpae" role="dialog" aria-label="Rejeter la demande DPAE">
        <h2>Rejeter la demande</h2>
        <form onSubmit={confirmer}>
          <label>
            <span>Motif du rejet (obligatoire)</span>
            <textarea value={motif} onChange={(e) => setMotif(e.target.value)} rows={3} autoFocus />
          </label>

          {erreur && <p role="alert">{erreur}</p>}

          <div className="modale-rejeter-dpae__actions">
            <button type="button" onClick={onAnnuler} disabled={enCours}>
              Annuler
            </button>
            <button type="submit" disabled={enCours || !motif.trim()}>
              {enCours ? 'Rejet…' : 'Rejeter la demande'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
