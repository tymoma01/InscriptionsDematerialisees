import { useState } from 'react';
import './ModaleConfirmationTestNonRealise.css';

// Remplace le window.confirm() natif utilisé jusqu'ici pour "Test non réalisé" (audit 2026-08-28)
// — nécessaire pour mettre en couleur "#{dossierId} {candidat}" dans le message, ce qu'un
// confirm() natif ne permet pas. Composant dédié (pas un confirm générique réutilisable ailleurs,
// voir CLAUDE.md conventions du projet) : seul ListeEvaluationsAFaire.jsx en a besoin aujourd'hui.
// Même patron de modale que ModaleMonProfil.jsx (fond sous l'en-tête/la nav, carte centrée via
// margin: auto) — voir ModaleConfirmationTestNonRealise.css pour le détail du positionnement.
//
// Commentaire obligatoire (audit 2026-09-10, renommage du bouton en "NSPP" côté
// ListeEvaluationsAFaire.jsx) — même patron que ModaleResultatFormation.jsx (qui suivait déjà CE
// composant-ci en modèle) : le texte tapé par l'agent remplace ici le commentaire auto-généré
// (`Test non réalisé le {date}.`) que ListeEvaluationsAFaire.jsx envoyait jusqu'ici, plutôt que de
// s'y ajouter — aucun changement backend, workflowEngine.appliquerTransition n'exige qu'un
// commentaire non vide, sans distinguer sa provenance. Statut/transition métier
// ('test_non_realise') strictement inchangés, seuls le libellé du bouton et l'origine du
// commentaire changent.
export default function ModaleConfirmationTestNonRealise({ rdv, onConfirmer, onAnnuler }) {
  const [commentaire, setCommentaire] = useState('');

  const confirmer = (evenement) => {
    evenement.preventDefault();
    if (!commentaire.trim()) return;
    onConfirmer(commentaire.trim());
  };

  return (
    <div className="modale-confirmation-non-realise__fond">
      <div className="modale-confirmation-non-realise" role="dialog" aria-label="Confirmer le test non réalisé">
        <p>
          Êtes-vous sûr de vouloir marquer le test du candidat{' '}
          {/* Même bleu ACCECIT que la ligne de contact d'urgence de l'email de convocation
              (invitationTestService.js) et .informations-inscription__valeur--accent
              (InformationsInscription.css) — accent déjà établi ailleurs dans l'app, pas une
              nouvelle couleur introduite ici. */}
          <span className="modale-confirmation-non-realise__accent">
            #{rdv.dossier_id} {rdv.candidat_prenom} {rdv.candidat_nom}
          </span>{' '}
          comme non réalisé ?
        </p>

        <form onSubmit={confirmer}>
          <label className="modale-confirmation-non-realise__commentaire">
            <span>Commentaire (obligatoire)</span>
            <textarea value={commentaire} onChange={(evenement) => setCommentaire(evenement.target.value)} rows={3} autoFocus />
          </label>

          <div className="modale-confirmation-non-realise__actions">
            <button type="button" className="modale-confirmation-non-realise__annuler" onClick={onAnnuler}>
              Annuler
            </button>
            <button type="submit" className="modale-confirmation-non-realise__ok" disabled={!commentaire.trim()}>
              OK
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
