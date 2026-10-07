import { useEffect } from 'react';
import './ModaleConfirmationDpae.css';

// Fenêtre de confirmation commune aux actions sur une demande DPAE (valider, rejeter, mettre en
// attente, renvoyer à l'inspecteur, transmettre à la RH, classer sans suite) : un titre, « Annuler » /
// « Confirmer ». Aucun champ de saisie : la traçabilité passe par les notes. Jamais window.confirm.
//
// Échap et clic en dehors de la fenêtre = « Annuler », sauf pendant l'envoi. Une erreur du serveur
// s'affiche ici, la fenêtre restant ouverte.
// `variante` : 'rejet' (rouge) | 'attente' (bleu-gris) | 'validation' (vert) | 'classement' (ambre) — couleur du bouton.
export default function ModaleConfirmationDpae({ titre, onConfirmer, onAnnuler, enCours, erreur, variante = 'validation' }) {
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
      className="modale-confirmation-dpae__fond"
      // Clic sur le fond seulement (pas sur un élément de la fenêtre, dont les clics remontent ici).
      onClick={(evenement) => {
        if (evenement.target === evenement.currentTarget && !enCours) onAnnuler();
      }}
    >
      <div className={`modale-confirmation-dpae modale-confirmation-dpae--${variante}`} role="dialog" aria-modal="true" aria-labelledby="titre-confirmation-dpae">
        <h2 id="titre-confirmation-dpae">{titre}</h2>
        <form onSubmit={confirmer}>
          {erreur && <p role="alert">{erreur}</p>}

          <div className="modale-confirmation-dpae__actions">
            <button type="button" onClick={onAnnuler} disabled={enCours}>
              Annuler
            </button>
            <button type="submit" disabled={enCours} autoFocus>
              {enCours ? 'Confirmation…' : 'Confirmer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
