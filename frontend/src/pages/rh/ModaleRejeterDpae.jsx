import { useState } from 'react';
import './ModaleRejeterDpae.css';

// Confirmation du rejet d'une demande DPAE — motif obligatoire (voir demandeDpaeService.rejeter,
// même exigence côté serveur), même patron que ModaleForcerStatut.jsx (core/dossier/) en plus
// simple : pas de liste de statuts à choisir, un seul champ.
//
// Réutilisée pour la mise en attente (2026-09-30, motif également obligatoire côté serveur) : les
// textes sont des props dont la valeur par défaut reste celle du rejet.
export default function ModaleRejeterDpae({
  onConfirmer,
  onAnnuler,
  enCours,
  erreur,
  titre = 'Rejeter la demande',
  libelleMotif = 'Motif du rejet (obligatoire)',
  libelleConfirmer = 'Rejeter la demande',
  libelleEnCours = 'Rejet…',
  // 'rejet' (rouge) | 'attente' (bleu-gris) — couleur du bouton de confirmation.
  variante = 'rejet',
}) {
  const [motif, setMotif] = useState('');

  const confirmer = (evenement) => {
    evenement.preventDefault();
    if (!motif.trim()) return;
    onConfirmer(motif.trim());
  };

  return (
    <div className="modale-rejeter-dpae__fond">
      <div className={`modale-rejeter-dpae modale-rejeter-dpae--${variante}`} role="dialog" aria-label={`${titre} DPAE`}>
        <h2>{titre}</h2>
        <form onSubmit={confirmer}>
          <label>
            <span>{libelleMotif}</span>
            <textarea value={motif} onChange={(e) => setMotif(e.target.value)} rows={3} autoFocus />
          </label>

          {erreur && <p role="alert">{erreur}</p>}

          <div className="modale-rejeter-dpae__actions">
            <button type="button" onClick={onAnnuler} disabled={enCours}>
              Annuler
            </button>
            <button type="submit" disabled={enCours || !motif.trim()}>
              {enCours ? libelleEnCours : libelleConfirmer}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
