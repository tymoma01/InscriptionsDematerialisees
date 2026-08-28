import { useEffect, useState } from 'react';
import { obtenirHistoriqueFormation } from '../../services/dossierService';
import './HistoriqueFormation.css';

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

// Couleur du résultat — même bleu ACCECIT pour "Formation validée" que les autres mises en
// évidence positives de l'app (ex. .informations-inscription__valeur--accent), rouge
// --couleur-erreur pour "Formation non validée" (même famille que le badge echec-fort du statut,
// voir StatutBadge/formation_non_validee) : contrairement à "Test non réalisé"/"Formation non
// validée" ailleurs dans l'app (jamais une couleur d'alerte pour une action normale du workflow),
// ICI c'est un résultat déjà acté qu'on relit, pas un bouton d'action — la couleur sert à repérer
// l'issue en un coup d'œil dans une liste, rôle différent.
function classeResultat(resultatCode) {
  if (resultatCode === 'valide_pret_embauche') return 'historique-formation__resultat--valide';
  if (resultatCode === 'formation_non_validee') return 'historique-formation__resultat--non-valide';
  return '';
}

// Historique de formation d'un dossier (audit 2026-08-28, révise une décision antérieure — voir
// CLAUDE.md) : lecture seule, ces entrées sont produites automatiquement par les transitions de
// "Suivi des formations" (pages/coordination/SuiviFormation.jsx), jamais saisies directement ici
// — contrairement à HistoriqueRelances.jsx (même patron de section, sans le formulaire d'ajout).
// Un dossier peut avoir plusieurs envois en formation (replanifier_test repart de
// valide_envoi_formation vers test_planifie, voir workflow.config.json ACCECIT — confirmé avant
// implémentation) : plusieurs entrées possibles, pas seulement la dernière.
//
// dossierId reçu en prop (pas de useParams() ici) — même patron que HistoriqueRelances.jsx.
export default function HistoriqueFormation({ dossierId }) {
  const [historique, setHistorique] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);

  useEffect(() => {
    let annule = false;
    setChargement(true);
    setErreur(null);
    obtenirHistoriqueFormation(dossierId)
      .then((valeur) => {
        if (!annule) setHistorique(valeur);
      })
      .catch((erreur) => {
        if (!annule) {
          setErreur(erreur.response?.data?.erreur ?? "Impossible de récupérer l'historique de formation.");
        }
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, [dossierId]);

  return (
    <section className="historique-formation">
      <h2>Formation</h2>

      {chargement && <p>Chargement de l'historique…</p>}
      {erreur && <p role="alert">{erreur}</p>}

      {!chargement && !erreur && historique.length === 0 && (
        <p className="historique-formation__vide">Aucune formation enregistrée pour ce dossier.</p>
      )}

      {!chargement && !erreur && historique.length > 0 && (
        <ul className="historique-formation__liste">
          {historique.map((entree, index) => (
            // Pas d'id propre à une "entrée" (reconstituée côté serveur à partir de plusieurs
            // lignes historique_statuts, voir dossierService.construireHistoriqueFormation) — la
            // date d'envoi, unique par construction (une seule ligne valide_envoi_formation par
            // date), sert de clé.
            <li key={`${entree.dateEnvoi}-${index}`} className="historique-formation__item">
              <div className="historique-formation__envoi">
                <span className="historique-formation__libelle">Envoyé en formation</span>
                <span className="historique-formation__meta">
                  {FORMAT_DATE.format(new Date(entree.dateEnvoi))} — {entree.envoyeParPrenom} {entree.envoyeParNom} (
                  {entree.envoyeParRole})
                </span>
              </div>
              {entree.commentaireEnvoi && <p className="historique-formation__commentaire">{entree.commentaireEnvoi}</p>}

              {entree.resultatCode ? (
                <div className="historique-formation__resultat-bloc">
                  <div className="historique-formation__envoi">
                    <span className={`historique-formation__libelle ${classeResultat(entree.resultatCode)}`}>
                      {entree.resultatLibelle}
                    </span>
                    <span className="historique-formation__meta">
                      {FORMAT_DATE.format(new Date(entree.dateResultat))} — {entree.decideParPrenom} {entree.decideParNom} (
                      {entree.decideParRole})
                    </span>
                  </div>
                  {entree.commentaireResultat && (
                    <p className="historique-formation__commentaire">{entree.commentaireResultat}</p>
                  )}
                </div>
              ) : (
                <p className="historique-formation__en-attente">Résultat non renseigné pour l'instant.</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
