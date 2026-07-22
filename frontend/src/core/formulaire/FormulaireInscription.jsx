import { useState } from 'react';
import BlocRenderer from './BlocRenderer';
import { useFormulaireInscription } from './useFormulaireInscription';
import { creerCandidat } from '../../services/candidatService';
import './FormulaireInscription.css';

// Conteneur générique : orchestre la navigation entre blocs actifs d'une entité.
// Ne référence aucun bloc par son code — uniquement via la config reçue en prop.
// onInscriptionReussie({ candidatId, dossierId }) : l'écran affiché une fois l'inscription
// enregistrée (gros message centré + bouton de redirection vers la prise des pièces
// justificatives, voir ConfirmationInscription.jsx) est spécifique à l'entité/à la page, pas au
// moteur générique — ce composant se contente de signaler la réussite à l'appelant
// (InscriptionTablette.jsx), qui décide de l'écran suivant.
export default function FormulaireInscription({ configBlocs, onInscriptionReussie }) {
  const {
    etapes,
    blocsActifs,
    blocsEtapeCourante,
    etapeCourante,
    estPremiereEtape,
    estDerniereEtape,
    etapeCouranteValide,
    formulaireValide,
    valeursParBloc,
    mettreAJourBloc,
    mettreAJourValidite,
    suivant,
    precedent,
  } = useFormulaireInscription(configBlocs);

  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [erreurEnvoi, setErreurEnvoi] = useState(null);

  if (etapes.length === 0) {
    return <p>Aucun bloc de formulaire actif pour cette entité.</p>;
  }

  // Agrège les valeurs de tous les blocs actifs en un seul objet candidat — le moteur ne
  // connaît pas les champs de chaque bloc, il assemble simplement ce qu'il a collecté.
  const validerInscription = async () => {
    if (!formulaireValide || envoiEnCours) return;

    setErreurEnvoi(null);
    setEnvoiEnCours(true);
    try {
      const candidat = Object.assign({}, ...blocsActifs.map((bloc) => valeursParBloc[bloc.code]));
      const { candidatId, dossierId } = await creerCandidat(candidat);
      onInscriptionReussie?.({ candidatId, dossierId });
    } catch (erreur) {
      setErreurEnvoi(
        erreur.response
          ? "Le serveur n'a pas pu enregistrer l'inscription. Merci de réessayer."
          : 'Connexion au serveur impossible. Vérifiez le réseau et réessayez.',
      );
    } finally {
      setEnvoiEnCours(false);
    }
  };

  return (
    <div className="formulaire-inscription">
      <p className="formulaire-inscription__etapes">
        Étape {etapeCourante + 1} / {etapes.length}
      </p>

      <div className="formulaire-inscription__etape">
        {blocsEtapeCourante.map((bloc) => (
          <div
            key={bloc.code}
            className={
              bloc.largeur === 'moitie'
                ? 'formulaire-inscription__bloc formulaire-inscription__bloc--moitie'
                : 'formulaire-inscription__bloc'
            }
          >
            <BlocRenderer
              bloc={bloc}
              valeurs={valeursParBloc[bloc.code]}
              onChange={(valeurs) => mettreAJourBloc(bloc.code, valeurs)}
              onValiditeChange={(estValide) => mettreAJourValidite(bloc.code, estValide)}
            />
          </div>
        ))}
      </div>

      {erreurEnvoi && <p role="alert">{erreurEnvoi}</p>}

      <div className="formulaire-inscription__navigation">
        <button type="button" onClick={precedent} disabled={estPremiereEtape || envoiEnCours}>
          Précédent
        </button>

        {estDerniereEtape ? (
          <button type="button" onClick={validerInscription} disabled={!formulaireValide || envoiEnCours}>
            {envoiEnCours ? 'Envoi en cours...' : 'Valider'}
          </button>
        ) : (
          <button type="button" onClick={suivant} disabled={!etapeCouranteValide}>
            Suivant
          </button>
        )}
      </div>
    </div>
  );
}
