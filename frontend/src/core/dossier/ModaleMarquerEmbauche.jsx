import { useState } from 'react';
import './ModaleMarquerEmbauche.css';

// Confirmation "Marquer comme embauché" (audit 2026-08-31, nouveau statut terminal "Embauché",
// après "Validé - prêt à l'embauche") — même patron que ModaleForcerStatut.jsx : les DEUX champs
// (commentaire, date d'embauche) sont obligatoires, bouton de confirmation désactivé tant que le
// formulaire n'est pas valide. Générique (core/dossier/), pas propre à ACCECIT : ne connaît aucun
// code de statut en dur, seulement le dossier concerné (Modularité, CLAUDE.md).
//
// max={aujourd'hui} sur le champ date : une date d'embauche future n'a pas de sens pour une action
// qui, par construction, acte un événement déjà survenu (le candidat est venu signer son contrat).
function dateDuJourISO() {
  const maintenant = new Date();
  const annee = maintenant.getFullYear();
  const mois = String(maintenant.getMonth() + 1).padStart(2, '0');
  const jour = String(maintenant.getDate()).padStart(2, '0');
  return `${annee}-${mois}-${jour}`;
}

export default function ModaleMarquerEmbauche({ dossier, onConfirmer, onAnnuler, enCours, erreur }) {
  const [dateEmbauche, setDateEmbauche] = useState('');
  const [commentaire, setCommentaire] = useState('');

  const confirmer = (evenement) => {
    evenement.preventDefault();
    if (!dateEmbauche || !commentaire.trim()) return;
    onConfirmer(dateEmbauche, commentaire.trim());
  };

  return (
    <div className="modale-marquer-embauche__fond">
      <div className="modale-marquer-embauche" role="dialog" aria-label="Marquer le dossier comme embauché">
        <h2>Marquer comme embauché</h2>
        <p>
          <span className="modale-marquer-embauche__accent">
            #{dossier.id} {dossier.candidat_prenom} {dossier.candidat_nom}
          </span>
        </p>

        <form onSubmit={confirmer}>
          <label>
            <span>Date d&rsquo;embauche</span>
            <input
              type="date"
              value={dateEmbauche}
              max={dateDuJourISO()}
              onChange={(evenement) => setDateEmbauche(evenement.target.value)}
              autoFocus
              required
            />
          </label>

          <label>
            <span>Commentaire (obligatoire)</span>
            <textarea value={commentaire} onChange={(evenement) => setCommentaire(evenement.target.value)} rows={3} />
          </label>

          {erreur && <p role="alert">{erreur}</p>}

          <div className="modale-marquer-embauche__actions">
            <button type="button" onClick={onAnnuler} disabled={enCours}>
              Annuler
            </button>
            <button type="submit" disabled={enCours || !dateEmbauche || !commentaire.trim()}>
              {enCours ? 'Enregistrement...' : 'Confirmer l’embauche'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
