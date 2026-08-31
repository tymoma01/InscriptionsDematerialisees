import { useState } from 'react';
import './ModaleForcerStatut.css';

// Confirmation du changement de statut manuel/forcé (audit RBAC 2026-08-31, décision utilisateur)
// — même patron que ModaleResultatFormation.jsx (pages/coordination/) : commentaire OBLIGATOIRE,
// bouton de confirmation désactivé tant que le formulaire n'est pas valide. Générique (core/
// dossier/), pas propre à ACCECIT : `statuts` vient de GET /api/dossiers/statuts (voir
// dossierService.listerStatuts), ce composant ne connaît aucun code de statut en dur (Modularité,
// CLAUDE.md) — reste valable pour n'importe quelle entité/configuration de workflow.
//
// Statut courant du dossier exclu de la liste déroulante (choisir le même statut n'a pas de sens
// et est de toute façon refusé côté serveur, voir workflowEngine.forcerStatut) plutôt que
// simplement désactivé : évite un aller-retour serveur pour une erreur détectable ici.
export default function ModaleForcerStatut({ dossier, statuts, onConfirmer, onAnnuler, enCours, erreur }) {
  const [statutCode, setStatutCode] = useState('');
  const [commentaire, setCommentaire] = useState('');

  const statutsChoisissables = statuts.filter((statut) => statut.code !== dossier.statut_code);

  const confirmer = (evenement) => {
    evenement.preventDefault();
    if (!statutCode || !commentaire.trim()) return;
    onConfirmer(statutCode, commentaire.trim());
  };

  return (
    <div className="modale-forcer-statut__fond">
      <div className="modale-forcer-statut" role="dialog" aria-label="Forcer le statut du dossier">
        <h2>Forcer le statut du dossier</h2>
        <p>
          <span className="modale-forcer-statut__accent">
            #{dossier.id} {dossier.candidat_prenom} {dossier.candidat_nom}
          </span>
        </p>
        <p className="modale-forcer-statut__avertissement" role="alert">
          Cette action contourne le parcours normal du dossier (aucune vérification d&rsquo;étape,
          aucun effet de bord autre que la neutralisation d&rsquo;un éventuel rendez-vous actif si le
          statut choisi le prévoit). Réservez-la aux cas exceptionnels et expliquez la raison
          ci-dessous — elle est tracée dans le journal d&rsquo;audit.
        </p>

        <form onSubmit={confirmer}>
          <label>
            <span>Nouveau statut</span>
            <select value={statutCode} onChange={(evenement) => setStatutCode(evenement.target.value)} autoFocus required>
              <option value="">— Choisir un statut —</option>
              {statutsChoisissables.map((statut) => (
                <option key={statut.code} value={statut.code}>
                  {statut.libelle}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Motif du changement forcé (obligatoire)</span>
            <textarea value={commentaire} onChange={(evenement) => setCommentaire(evenement.target.value)} rows={3} />
          </label>

          {erreur && <p role="alert">{erreur}</p>}

          <div className="modale-forcer-statut__actions">
            <button type="button" onClick={onAnnuler} disabled={enCours}>
              Annuler
            </button>
            <button type="submit" disabled={enCours || !statutCode || !commentaire.trim()}>
              {enCours ? 'Enregistrement...' : 'Forcer ce statut'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
