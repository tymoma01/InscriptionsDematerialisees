import { useState } from 'react';
import BlocRenderer from './BlocRenderer';
import { useFormulaireInscription } from './useFormulaireInscription';
import { creerCandidat } from '../../services/candidatService';

// Conteneur générique : orchestre la navigation entre blocs actifs d'une entité.
// Ne référence aucun bloc par son code — uniquement via la config reçue en prop.
export default function FormulaireInscription({ configBlocs }) {
  const {
    blocsActifs,
    blocCourant,
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
  const [inscriptionReussie, setInscriptionReussie] = useState(false);

  if (!blocCourant) {
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
      await creerCandidat(candidat);
      setInscriptionReussie(true);
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

  if (inscriptionReussie) {
    return (
      <div className="formulaire-inscription__confirmation" role="status">
        <p>Inscription enregistrée avec succès.</p>
      </div>
    );
  }

  return (
    <div className="formulaire-inscription">
      <p className="formulaire-inscription__etapes">
        Étape {etapeCourante + 1} / {blocsActifs.length}
      </p>

      <BlocRenderer
        bloc={blocCourant}
        valeurs={valeursParBloc[blocCourant.code]}
        onChange={(valeurs) => mettreAJourBloc(blocCourant.code, valeurs)}
        onValiditeChange={(estValide) => mettreAJourValidite(blocCourant.code, estValide)}
      />

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
