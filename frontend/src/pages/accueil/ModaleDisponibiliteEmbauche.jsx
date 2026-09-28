import { useState } from 'react';
import './ModaleDisponibiliteEmbauche.css';

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

function formaterDate(valeur) {
  if (!valeur) return '-';
  // Même précaution que InformationsInscription.jsx/versDateInput : 'AAAA-MM-JJ' pur, jamais
  // `new Date(valeur)` (décalage possible d'un jour selon le fuseau du navigateur pour une date
  // sans heure) — Intl.DateTimeFormat accepte directement une chaîne 'AAAA-MM-JJ' interprétée en
  // UTC minuit, sans ce risque, contrairement à Date elle-même sur certains moteurs.
  return FORMAT_DATE.format(new Date(`${valeur}T00:00:00Z`));
}

function versDateInput(valeur) {
  return valeur ? String(valeur).slice(0, 10) : '';
}

function aujourdHuiISO() {
  const maintenant = new Date();
  const annee = maintenant.getFullYear();
  const mois = String(maintenant.getMonth() + 1).padStart(2, '0');
  const jour = String(maintenant.getDate()).padStart(2, '0');
  return `${annee}-${mois}-${jour}`;
}

// Correction de la disponibilité d'un candidat "Validé - prêt à l'embauche" (audit 2026-09-28) —
// même patron de modale que ModaleResultatFormation.jsx (SuiviFormation.jsx) : fond sous
// l'en-tête/la nav, carte centrée, commentaire obligatoire, bouton désactivé tant que le
// formulaire n'est pas valide plutôt qu'un message d'erreur au clic.
//
// Préremplissage de la date de début : la disponibilité EFFECTIVE actuelle (corrigée si elle
// existe déjà, sinon déclarée — voir `disponibiliteEffective`, dossierService.js) si elle a une
// date concrète, sinon la date du jour (demande utilisateur explicite : "préremplie avec la date
// du jour si la disponibilité est immédiate" — un dossier sans correction précédente et
// disponibiliteEffective.dateDebut null signifie exactement "immédiate"). La date de fin effective
// est reprise telle quelle (vide si aucune) — un agent ajuste plutôt que de ressaisir de zéro.
export default function ModaleDisponibiliteEmbauche({ dossier, onConfirmer, onAnnuler, enCours, erreur }) {
  const { disponibiliteDeclaree, disponibiliteEffective } = dossier;
  const [dateDebut, setDateDebut] = useState(versDateInput(disponibiliteEffective?.dateDebut) || aujourdHuiISO());
  const [dateFin, setDateFin] = useState(versDateInput(disponibiliteEffective?.dateFin));
  const [commentaire, setCommentaire] = useState('');

  // Contrôle INTERFACE (demande utilisateur explicite, en plus du contrôle serveur déjà posé côté
  // back, voir disponibiliteEmbaucheService.js) — comparaison lexicographique valide sur des
  // dates 'AAAA-MM-JJ' (même ordre que l'ordre chronologique réel).
  const dateFinAvantDateDebut = Boolean(dateFin) && dateFin < dateDebut;
  const formulaireValide = Boolean(dateDebut) && !dateFinAvantDateDebut && Boolean(commentaire.trim());

  const confirmer = (evenement) => {
    evenement.preventDefault();
    if (!formulaireValide) return;
    onConfirmer({ dateDebut, dateFin: dateFin || null, commentaire: commentaire.trim() });
  };

  // "Non renseignée" (ajustement 2026-09-28) : distincte d'"Immédiate" — un dossier n'ayant
  // STRICTEMENT aucun bloc 'disponibilites' enregistré (voir dossierService.js,
  // disponibiliteDeclaree.nonRenseignee) n'a pas déclaré "immédiate", il n'a simplement rien
  // déclaré du tout ; sans cette distinction, disponibiliteDeclaree.disponibiliteImmediate
  // retombait sur `true` par défaut même en l'absence totale de déclaration.
  const declarationTexte = disponibiliteDeclaree?.nonRenseignee
    ? 'Non renseignée'
    : disponibiliteDeclaree?.disponibiliteImmediate
      ? 'Immédiate'
      : `Du ${formaterDate(disponibiliteDeclaree?.dateDebut)}${disponibiliteDeclaree?.dateFin ? ` au ${formaterDate(disponibiliteDeclaree.dateFin)}` : ' (sans date de fin précisée)'}`;

  return (
    <div className="modale-disponibilite-embauche__fond">
      <div className="modale-disponibilite-embauche" role="dialog" aria-label="Corriger la disponibilité">
        <h2>Corriger la disponibilité</h2>
        <p>
          <span className="modale-disponibilite-embauche__accent">
            #{dossier.id} {dossier.candidat_prenom} {dossier.candidat_nom}
          </span>
        </p>

        {/* Déclaration d'origine du candidat — LECTURE SEULE (demande utilisateur explicite),
            jamais modifiée par cette fenêtre, voir disponibiliteEmbaucheService.js. */}
        <div className="modale-disponibilite-embauche__declaration">
          <span className="modale-disponibilite-embauche__declaration-titre">Déclaration d'origine du candidat</span>
          <span>{declarationTexte}</span>
        </div>

        <form onSubmit={confirmer}>
          <div className="modale-disponibilite-embauche__dates">
            <label htmlFor="disponibilite-date-debut">
              Disponible à partir du <span className="champ-obligatoire">*</span>
              <input
                id="disponibilite-date-debut"
                type="date"
                value={dateDebut}
                onChange={(evenement) => setDateDebut(evenement.target.value)}
                autoFocus
              />
            </label>
            <label htmlFor="disponibilite-date-fin">
              Jusqu'au (facultatif)
              <input id="disponibilite-date-fin" type="date" value={dateFin} onChange={(evenement) => setDateFin(evenement.target.value)} />
            </label>
          </div>
          {dateFinAvantDateDebut && (
            <p role="alert">La date de fin ne peut pas être antérieure à la date de début.</p>
          )}

          <label htmlFor="disponibilite-commentaire">
            <span>Commentaire (obligatoire)</span>
            <textarea
              id="disponibilite-commentaire"
              value={commentaire}
              onChange={(evenement) => setCommentaire(evenement.target.value)}
              rows={3}
            />
          </label>

          {erreur && <p role="alert">{erreur}</p>}

          <div className="modale-disponibilite-embauche__actions">
            <button type="button" onClick={onAnnuler} disabled={enCours}>
              Annuler
            </button>
            <button type="submit" disabled={enCours || !formulaireValide}>
              {enCours ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
