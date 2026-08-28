import { useState } from 'react';
import './ModaleResultatFormation.css';

// Confirmation avec commentaire OBLIGATOIRE pour "Formation validée"/"Formation non validée"
// (audit 2026-08-28, SuiviFormation.jsx) — même patron de modale que
// ModaleConfirmationTestNonRealise.jsx (fond sous l'en-tête/la nav, carte centrée via margin:
// auto), avec un champ de saisie en plus : contrairement à "Test non réalisé", le commentaire
// SAISI PAR L'AGENT remplace ici le commentaire auto-généré, plutôt que de s'y ajouter (voir
// SuiviFormation.jsx, enregistrerResultat) — workflowEngine.appliquerTransition n'exige qu'un
// commentaire non vide, sans distinguer sa provenance (voir GestionTransitions.jsx, qui envoie
// déjà un commentaire tapé par l'agent pour d'autres transitions), donc aucun changement côté
// backend n'est nécessaire pour ce remplacement.
//
// Bouton de confirmation désactivé tant que le champ est vide (espaces seuls compris, .trim())
// plutôt qu'un message d'erreur au clic : rend le blocage visible avant même la tentative, cohérent
// avec GestionTransitions.jsx (bouton "Confirmer" désactivé tant que commentaire.trim() est vide).
export default function ModaleResultatFormation({ dossier, titre, onConfirmer, onAnnuler, enCours, erreur }) {
  const [commentaire, setCommentaire] = useState('');

  const confirmer = (evenement) => {
    evenement.preventDefault();
    if (!commentaire.trim()) return;
    onConfirmer(commentaire.trim());
  };

  return (
    <div className="modale-resultat-formation__fond">
      <div className="modale-resultat-formation" role="dialog" aria-label={titre}>
        <h2>{titre}</h2>
        <p>
          <span className="modale-resultat-formation__accent">
            #{dossier.id} {dossier.candidat_prenom} {dossier.candidat_nom}
          </span>
        </p>

        <form onSubmit={confirmer}>
          <label>
            <span>Commentaire (obligatoire)</span>
            <textarea
              value={commentaire}
              onChange={(evenement) => setCommentaire(evenement.target.value)}
              rows={3}
              autoFocus
            />
          </label>

          {/* Erreur d'ENVOI (réseau/serveur, voir SuiviFormation.jsx) affichée ICI plutôt que sur
              la page en arrière-plan : celle-ci reste couverte par le fond de la modale tant
              qu'elle est ouverte, un message qui y apparaîtrait resterait invisible. La modale
              reste ouverte après une erreur (commentaire déjà tapé conservé) pour permettre de
              retenter sans tout ressaisir. */}
          {erreur && <p role="alert">{erreur}</p>}

          <div className="modale-resultat-formation__actions">
            <button type="button" onClick={onAnnuler} disabled={enCours}>
              Annuler
            </button>
            <button type="submit" disabled={enCours || !commentaire.trim()}>
              {enCours ? 'Enregistrement...' : 'Confirmer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
