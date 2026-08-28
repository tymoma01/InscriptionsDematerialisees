import './ModaleConfirmationTestNonRealise.css';

// Remplace le window.confirm() natif utilisé jusqu'ici pour "Test non réalisé" (audit 2026-08-28)
// — nécessaire pour mettre en couleur "#{dossierId} {candidat}" dans le message, ce qu'un
// confirm() natif ne permet pas. Composant dédié (pas un confirm générique réutilisable ailleurs,
// voir CLAUDE.md conventions du projet) : seul ListeEvaluationsAFaire.jsx en a besoin aujourd'hui.
// Même patron de modale que ModaleMonProfil.jsx (fond sous l'en-tête/la nav, carte centrée via
// margin: auto) — voir ModaleConfirmationTestNonRealise.css pour le détail du positionnement.
export default function ModaleConfirmationTestNonRealise({ rdv, onConfirmer, onAnnuler }) {
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
        <div className="modale-confirmation-non-realise__actions">
          <button type="button" className="modale-confirmation-non-realise__annuler" onClick={onAnnuler}>
            Annuler
          </button>
          <button type="button" className="modale-confirmation-non-realise__ok" onClick={onConfirmer}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
