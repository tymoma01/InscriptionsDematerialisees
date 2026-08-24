import { Component } from 'react';
import './ErrorBoundary.css';

// Seul composant classe de ce projet (React n'expose getDerivedStateFromError/componentDidCatch
// qu'aux composants classe, aucun hook équivalent n'existe à ce jour) — mode dégradé du
// back-office (audit 2026-08-24) : sans lui, un plantage de RENDU dans n'importe quelle section
// (InformationsInscription/GestionRendezvous/HistoriqueRelances/NotesDossier/CaptureTablette...)
// remonte jusqu'à la racine React et blanchit toute la page, y compris les sections qui n'ont
// rien à voir avec le bug. Distinct des erreurs d'appel réseau (timeout, 500...), déjà gérées
// section par section par chaque composant lui-même (état `erreur` local, `role="alert"`, voir
// NotesDossier.jsx/GestionRendezvous.jsx/etc.) — cette limite-ci n'intercepte QUE les exceptions
// levées pendant le rendu (donnée inattendue, accès à un champ absent...), jamais les erreurs déjà
// interceptées par un .catch() de fetch, qui ne lèvent jamais d'exception React.
//
// Générique et sans connaissance de ce qu'il enveloppe (voir Modularité, CLAUDE.md) : `titre`
// optionnel personnalise seulement le message, `enfants` reste strictement opaque. Réutilisable
// autour de n'importe quelle section back-office, un seul composant pour toute l'app plutôt qu'une
// limite par page.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { erreur: null };
  }

  static getDerivedStateFromError(erreur) {
    return { erreur };
  }

  componentDidCatch(erreur, infosComposant) {
    // Console uniquement (pas de journalAudit ici : c'est une erreur de rendu CÔTÉ CLIENT, sans
    // rapport avec la traçabilité RGPD "qui a fait quoi côté serveur" du reste du projet) — sert
    // au diagnostic en cours de développement/en prod via les outils du navigateur.
    console.error(`ErrorBoundary a intercepté une erreur de rendu${this.props.titre ? ` (${this.props.titre})` : ''} :`, erreur, infosComposant);
  }

  // Réessayer ne fait que réinitialiser l'état local pour retenter le rendu des enfants — utile si
  // l'erreur était ponctuelle (ex. état incohérent le temps d'un re-rendu). Si la cause reste
  // présente (donnée toujours invalide), le composant replantera immédiatement et retombera sur
  // le même message : pas un bug de ce composant, juste l'absence de mécanisme de "réparation"
  // magique — un rechargement complet de la page reste la solution si "Réessayer" ne suffit pas.
  reinitialiser = () => {
    this.setState({ erreur: null });
  };

  render() {
    if (this.state.erreur) {
      return (
        <div className="limite-erreur" role="alert">
          <p className="limite-erreur__message">
            {this.props.titre ? `La section « ${this.props.titre} » a rencontré un problème.` : 'Cette section a rencontré un problème.'}{' '}
            Réessayez ou contactez le support si le problème persiste.
          </p>
          <button type="button" className="limite-erreur__bouton" onClick={this.reinitialiser}>
            Réessayer
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
