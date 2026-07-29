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

// Orientation du candidat en cas de verdict positif (workflow v3, voir backend evaluationEngine.js,
// ORIENTATIONS_AUTORISEES) — sans objet si le résultat global est "Invalidé", jamais affichée
// dans ce cas (voir orientationVisible plus bas).
const ORIENTATIONS = [
  { code: 'envoi_formation', libelle: 'Envoi en formation' },
  { code: 'pret_embauche', libelle: "Prêt à l'embauche" },
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
  const [orientation, setOrientation] = useState('');
  const [commentaire, setCommentaire] = useState('');
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [erreurEnvoi, setErreurEnvoi] = useState(null);

  const orientationVisible = resultatGlobal === 'valide';

  // Décochée si le formateur repasse sur "Invalidé" après avoir choisi une orientation — sans
  // objet dans ce cas (voir ORIENTATIONS_AUTORISEES, backend evaluationEngine.js), pas de valeur
  // résiduelle envoyée par erreur au serveur.
  const gererChangementResultat = (valeur) => {
    setResultatGlobal(valeur);
    if (valeur !== 'valide') setOrientation('');
  };

  useEffect(() => {
    let annule = false;
    listerCriteres()
      .then((valeur) => {
        if (annule) return;
        setCriteres(valeur);
        setValeurs(Object.fromEntries(valeur.map((critere) => [critere.code, VALEURS[0].code])));
      })
      .catch((erreur) => {
        if (!annule) setErreur(erreur.response?.data?.erreur ?? 'Impossible de récupérer la grille de critères.');
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
    if (orientationVisible && !orientation) return;

    setEnvoiEnCours(true);
    setErreurEnvoi(null);

    try {
      // Le serveur fait avancer le statut du dossier dans la même transaction que l'enregistrement
      // de l'évaluation (voir backend evaluationEngine.enregistrerEvaluation) — plus de second
      // appel front à part pour la transition, workflow v3.
      await enregistrerEvaluation({
        rendezvousId: rendezvous.id,
        resultatGlobal,
        orientation: orientationVisible ? orientation : undefined,
        commentaire,
        criteres: criteres.map((critere) => ({ code: critere.code, valeur: valeurs[critere.code] })),
      });
    } catch (erreur) {
      setEnvoiEnCours(false);
      setErreurEnvoi(
        erreur.response
          ? (erreur.response.data?.erreur ?? "Le serveur n'a pas pu enregistrer l'évaluation. Merci de réessayer.")
          : 'Connexion au serveur impossible. Vérifiez le réseau et réessayez.',
      );
      return;
    }

    setEnvoiEnCours(false);
    onTermine();
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

      <fieldset className="grille-evaluation__resultat-global">
        <legend>
          Résultat du test <span className="champ-obligatoire">*</span>
        </legend>
        <div className="grille-evaluation__choix">
          <label>
            <input
              type="radio"
              name="resultat-global-valide"
              checked={resultatGlobal === 'valide'}
              onChange={() => gererChangementResultat('valide')}
            />
            Validé
          </label>
          <label>
            <input
              type="radio"
              name="resultat-global-invalide"
              checked={resultatGlobal === 'invalide'}
              onChange={() => gererChangementResultat('invalide')}
            />
            Invalidé
          </label>
        </div>
      </fieldset>

      {orientationVisible && (
        <fieldset className="grille-evaluation__orientation">
          <legend>
            Orientation <span className="champ-obligatoire">*</span>
          </legend>
          <div className="grille-evaluation__choix">
            {ORIENTATIONS.map((o) => (
              <label key={o.code}>
                <input
                  type="radio"
                  name={`orientation-${o.code}`}
                  checked={orientation === o.code}
                  onChange={() => setOrientation(o.code)}
                />
                {o.libelle}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <label className="grille-evaluation__commentaire">
        <span>Commentaire (obligatoire)</span>
        <textarea value={commentaire} onChange={(evenement) => setCommentaire(evenement.target.value)} rows={3} required />
      </label>

      {erreurEnvoi && <p role="alert">{erreurEnvoi}</p>}

      <div className="grille-evaluation__actions">
        <button type="button" onClick={onAnnuler} disabled={envoiEnCours}>
          Annuler
        </button>
        <button
          type="submit"
          disabled={envoiEnCours || !commentaire.trim() || criteres.length === 0 || (orientationVisible && !orientation)}
        >
          {envoiEnCours ? 'Enregistrement...' : "Enregistrer l'évaluation"}
        </button>
      </div>
    </form>
  );
}
