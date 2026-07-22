import { useEffect, useState } from 'react';
import { listerCriteres, enregistrerEvaluation } from '../../services/evaluationService';
import './GrilleEvaluation.css';

// Échelle de notation commune à tout critère (voir backend evaluationEngine.js,
// VALEURS_CRITERE_AUTORISEES) — pas une donnée de configuration par entité comme les critères
// eux-mêmes : c'est la forme même de la grille, pas un vocabulaire métier.
const VALEURS = [
  { code: 'conforme', libelle: 'Conforme' },
  { code: 'a_ameliorer', libelle: 'À améliorer' },
  { code: 'non_conforme', libelle: 'Non conforme' },
];

// Grille d'évaluation générique : ne connaît aucun critère en dur (voir Modularité, CLAUDE.md) —
// charge les critères configurés pour l'entité (GET /api/evaluations/criteres) et construit un
// sélecteur par critère, comme FormulaireInscription compose ses blocs actifs plutôt que de les
// connaître.
//
// rendezvous reçu en prop ({ id, candidat_prenom, candidat_nom, ... }, voir
// ListeEvaluationsAFaire.jsx) — ce composant ne connaît pas le routage, même patron que
// CaptureTablette.jsx.
export default function GrilleEvaluation({ rendezvous, onTermine, onAnnuler }) {
  const [criteres, setCriteres] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);

  const [valeurs, setValeurs] = useState({}); // { [code]: valeur }
  const [resultatGlobal, setResultatGlobal] = useState('valide');
  const [commentaire, setCommentaire] = useState('');
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [erreurEnvoi, setErreurEnvoi] = useState(null);

  useEffect(() => {
    let annule = false;
    listerCriteres()
      .then((valeur) => {
        if (annule) return;
        setCriteres(valeur);
        setValeurs(Object.fromEntries(valeur.map((critere) => [critere.code, VALEURS[0].code])));
      })
      .catch(() => {
        if (!annule) setErreur('Impossible de récupérer la grille de critères.');
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, []);

  const gererEnvoi = async (evenement) => {
    evenement.preventDefault();
    if (!commentaire.trim()) return;

    setEnvoiEnCours(true);
    setErreurEnvoi(null);
    try {
      await enregistrerEvaluation({
        rendezvousId: rendezvous.id,
        resultatGlobal,
        commentaire,
        criteres: criteres.map((critere) => ({ code: critere.code, valeur: valeurs[critere.code] })),
      });
      onTermine();
    } catch (erreur) {
      setErreurEnvoi(
        erreur.response
          ? "Le serveur n'a pas pu enregistrer l'évaluation. Merci de réessayer."
          : 'Connexion au serveur impossible. Vérifiez le réseau et réessayez.',
      );
    } finally {
      setEnvoiEnCours(false);
    }
  };

  if (chargement) {
    return <p>Chargement de la grille…</p>;
  }
  if (erreur) {
    return <p role="alert">{erreur}</p>;
  }

  return (
    <form className="grille-evaluation" onSubmit={gererEnvoi}>
      <h2>
        Évaluation — {rendezvous.candidat_prenom} {rendezvous.candidat_nom}
      </h2>

      {criteres.length === 0 && (
        <p className="grille-evaluation__vide">Aucun critère d’évaluation configuré pour cette entité.</p>
      )}

      {criteres.map((critere) => (
        <fieldset key={critere.code} className="grille-evaluation__critere">
          <legend>{critere.libelle}</legend>
          <div className="grille-evaluation__choix">
            {VALEURS.map((v) => (
              <label key={v.code}>
                <input
                  type="radio"
                  // name unique par option (pas par critère) : un name partagé entre les options
                  // d'un même groupe radio ne pose qu'un seul arrêt Tab natif par groupe (les
                  // flèches naviguent alors entre options) — ici on veut que Tab visite chaque
                  // option individuellement (même correctif que BlocDisponibilites.jsx et les
                  // autres blocs du formulaire d'inscription, voir radioAccessible.js). Aucun
                  // risque ici de casser la mise à jour de la valeur : checked/onChange sont déjà
                  // entièrement contrôlés par ce composant, sans dépendre de react-hook-form.
                  name={`critere-${critere.code}-${v.code}`}
                  value={v.code}
                  checked={valeurs[critere.code] === v.code}
                  onChange={() => setValeurs((precedent) => ({ ...precedent, [critere.code]: v.code }))}
                />
                {v.libelle}
              </label>
            ))}
          </div>
        </fieldset>
      ))}

      <label className="grille-evaluation__resultat-global">
        <span>Résultat global</span>
        <select value={resultatGlobal} onChange={(evenement) => setResultatGlobal(evenement.target.value)}>
          <option value="valide">Validé</option>
          <option value="invalide">Invalidé</option>
        </select>
      </label>

      <label className="grille-evaluation__commentaire">
        <span>Commentaire (obligatoire)</span>
        <textarea value={commentaire} onChange={(evenement) => setCommentaire(evenement.target.value)} rows={3} required />
      </label>

      {erreurEnvoi && <p role="alert">{erreurEnvoi}</p>}

      <div className="grille-evaluation__actions">
        <button type="button" onClick={onAnnuler} disabled={envoiEnCours}>
          Annuler
        </button>
        <button type="submit" disabled={envoiEnCours || !commentaire.trim() || criteres.length === 0}>
          {envoiEnCours ? 'Enregistrement...' : "Enregistrer l'évaluation"}
        </button>
      </div>
    </form>
  );
}
