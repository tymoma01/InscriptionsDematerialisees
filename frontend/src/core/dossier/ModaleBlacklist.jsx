import { useState } from 'react';
import './ModaleBlacklist.css';

// Longueurs du commentaire : miroir de blacklistService (le serveur reste seul juge).
export const COMMENTAIRE_BLACKLIST_MIN = 10;
export const COMMENTAIRE_BLACKLIST_MAX = 500;

const FORMAT_DATE_HEURE = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const LIBELLE_TYPE_RDV = { test: 'test', formation: 'formation' };

// Fenêtre de confirmation de « Refus définitif » (mode 'blacklister') et de « Lever le refus définitif »
// (mode 'retirer'). Dans les deux cas, un commentaire de 10 à 500 caractères est obligatoire ; le
// blacklistage exige en plus une catégorie (`categories`, configurée en base).
//
// Les rendez-vous actifs du dossier sont signalés : le blacklistage NE les annule PAS, l'agent décide.
export default function ModaleBlacklist({ mode, dossier, categories = [], avertissement, onConfirmer, onAnnuler, enCours, erreur }) {
  const estRetrait = mode === 'retirer';
  const [motifCode, setMotifCode] = useState('');
  const [commentaire, setCommentaire] = useState('');

  const longueur = commentaire.trim().length;
  const commentaireValide = longueur >= COMMENTAIRE_BLACKLIST_MIN && longueur <= COMMENTAIRE_BLACKLIST_MAX;
  const formulaireValide = commentaireValide && (estRetrait || Boolean(motifCode));
  const rendezvousActifs = dossier.rendezvousActifs ?? [];

  const confirmer = (evenement) => {
    evenement.preventDefault();
    if (!formulaireValide) return;
    onConfirmer({ motifCode: estRetrait ? undefined : motifCode, commentaire: commentaire.trim() });
  };

  const titre = estRetrait ? 'Lever le refus définitif' : 'Refus définitif du candidat';

  return (
    <div className="modale-blacklist__fond">
      <div className="modale-blacklist" role="dialog" aria-label={titre}>
        <h2>{titre}</h2>
        <p>
          <span className="modale-blacklist__accent">
            #{dossier.id} {dossier.candidat_prenom} {dossier.candidat_nom}
          </span>
        </p>

        {estRetrait ? (
          <p className="modale-blacklist__information">
            Le dossier retrouvera son statut d&rsquo;avant le refus définitif :{' '}
            <strong>{dossier.statutAvantBlacklist?.libelle ?? 'introuvable'}</strong>.
          </p>
        ) : (
          rendezvousActifs.length > 0 && (
            <div className="modale-blacklist__avertissement" role="alert">
              <strong>
                {rendezvousActifs.length === 1 ? 'Un rendez-vous est encore actif' : `${rendezvousActifs.length} rendez-vous sont encore actifs`}{' '}
                sur ce dossier :
              </strong>
              <ul>
                {rendezvousActifs.map((rdv) => (
                  <li key={rdv.id}>
                    {LIBELLE_TYPE_RDV[rdv.type] ?? rdv.type} du {FORMAT_DATE_HEURE.format(new Date(rdv.dateHeure))}
                  </li>
                ))}
              </ul>
              <span>Le refus définitif ne l&rsquo;annule pas : pensez à l&rsquo;annuler ou à prévenir le formateur.</span>
            </div>
          )
        )}

        {!estRetrait && avertissement && <p className="modale-blacklist__information">{avertissement}</p>}

        <form onSubmit={confirmer}>
          {!estRetrait && (
            <fieldset>
              <legend>Catégorie (obligatoire)</legend>
              {categories.map((categorie) => (
                <label key={categorie.code} className="modale-blacklist__categorie">
                  <input
                    type="radio"
                    name="categorie-blacklist"
                    value={categorie.code}
                    checked={motifCode === categorie.code}
                    onChange={() => setMotifCode(categorie.code)}
                  />
                  <span>{categorie.libelle}</span>
                </label>
              ))}
            </fieldset>
          )}

          <label>
            <span>{estRetrait ? 'Motif du retrait (obligatoire)' : 'Commentaire factuel (obligatoire)'}</span>
            <textarea
              value={commentaire}
              onChange={(evenement) => setCommentaire(evenement.target.value)}
              rows={4}
              maxLength={COMMENTAIRE_BLACKLIST_MAX}
              aria-describedby="compteur-commentaire-blacklist"
            />
            <span
              id="compteur-commentaire-blacklist"
              className={commentaireValide || longueur === 0 ? 'modale-blacklist__compteur' : 'modale-blacklist__compteur modale-blacklist__compteur--insuffisant'}
            >
              {longueur}/{COMMENTAIRE_BLACKLIST_MAX} (minimum {COMMENTAIRE_BLACKLIST_MIN})
            </span>
          </label>

          {erreur && <p role="alert">{erreur}</p>}

          <div className="modale-blacklist__actions">
            <button type="button" onClick={onAnnuler} disabled={enCours}>
              Annuler
            </button>
            <button type="submit" disabled={enCours || !formulaireValide}>
              {enCours ? 'Enregistrement...' : estRetrait ? 'Lever le refus définitif' : 'Confirmer le refus définitif'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
