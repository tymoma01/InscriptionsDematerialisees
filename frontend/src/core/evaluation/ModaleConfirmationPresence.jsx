import './ModaleConfirmationPresence.css';

// Confirmation simple avant "Présent(e)" (audit 2026-09-10, demande utilisateur : éviter un
// déclenchement immédiat au clic) — pas de commentaire ici, contrairement à
// ModaleConfirmationTestNonRealise.jsx ("NSPP") : marquerPresenceConfirmee n'en prend aucun (voir
// backend evaluationEngine.js), rien à saisir. Composant dédié malgré la ressemblance visuelle
// (même patron que ModaleMonProfil.jsx, fond sous l'en-tête/la nav, carte centrée via margin:
// auto) plutôt que réutiliser l'autre modale en masquant son champ — voir CLAUDE.md, conventions
// du projet : un patron aussi petit se duplique, il ne se paramètre pas.
export default function ModaleConfirmationPresence({ rdv, onConfirmer, onAnnuler }) {
  return (
    <div className="modale-confirmation-presence__fond">
      <div className="modale-confirmation-presence" role="dialog" aria-label="Confirmer la présence">
        <p>
          Confirmer la présence de{' '}
          <span className="modale-confirmation-presence__accent">
            {rdv.candidat_prenom} {rdv.candidat_nom}
          </span>{' '}
          ?
        </p>
        <div className="modale-confirmation-presence__actions">
          <button type="button" className="modale-confirmation-presence__annuler" onClick={onAnnuler}>
            Annuler
          </button>
          <button type="button" className="modale-confirmation-presence__ok" onClick={onConfirmer}>
            Confirmer
          </button>
        </div>
      </div>
    </div>
  );
}
