import { useEffect, useState } from 'react';
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
  // Détail par champ (`details.fieldErrors` du 400 backend, zod .flatten() — voir
  // candidats.routes.js) — même correctif que InformationsInscription.jsx (audit 2026-08-18,
  // dossiers aux créneaux legacy) : le seul message générique erreurEnvoi ci-dessus ("Données
  // invalides.") ne dit jamais QUEL champ est rejeté, alors que ce moteur affiche toujours
  // l'étape courante, pas forcément celle qui porte le champ en cause (ex. un champ d'une étape
  // déjà validée et quittée). Pas de mapping libellé->champ ici (contrairement à
  // InformationsInscription.jsx) : ce composant reste générique, il ne connaît aucun champ d'aucun
  // bloc par son nom (voir Modularité, CLAUDE.md) — le nom brut du champ suffit à orienter l'agent
  // support/l'accueil vers l'étape à corriger.
  const [erreursChamps, setErreursChamps] = useState({});

  // Ramène en haut de page à chaque changement d'étape : sans ça, la position de
  // défilement de l'étape précédente est conservée et l'utilisateur peut arriver
  // au milieu de la nouvelle étape.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [etapeCourante]);

  if (etapes.length === 0) {
    return <p>Aucun bloc de formulaire actif pour cette entité.</p>;
  }

  // Agrège les valeurs de tous les blocs actifs en un seul objet candidat — le moteur ne
  // connaît pas les champs de chaque bloc, il assemble simplement ce qu'il a collecté.
  const validerInscription = async () => {
    if (!formulaireValide || envoiEnCours) return;

    setErreurEnvoi(null);
    setErreursChamps({});
    setEnvoiEnCours(true);
    try {
      const candidat = Object.assign({}, ...blocsActifs.map((bloc) => valeursParBloc[bloc.code]));
      const { candidatId, dossierId } = await creerCandidat(candidat);
      onInscriptionReussie?.({ candidatId, dossierId });
    } catch (erreur) {
      // Le back renvoie déjà un message précis et distinct selon le cas (conflit NIR/email 409,
      // validation 400...) dans erreur.response.data.erreur — l'afficher tel quel plutôt que le
      // message générique ci-dessous, quel que soit le statut (pas seulement 409). Sur un 400 de
      // validation, il renvoie aussi details.fieldErrors (voir erreursChamps ci-dessus) — jusqu'ici
      // ignoré, laissant seulement "Données invalides." sans dire quel champ est en cause.
      setErreurEnvoi(
        erreur.response
          ? (erreur.response.data?.erreur ?? "Le serveur n'a pas pu enregistrer l'inscription. Merci de réessayer.")
          : 'Connexion au serveur impossible. Vérifiez le réseau et réessayez.',
      );
      setErreursChamps(erreur.response?.data?.details?.fieldErrors ?? {});
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

      {erreurEnvoi && (
        <div role="alert" className="formulaire-inscription__erreur">
          <p>{erreurEnvoi}</p>
          {/* Détail par champ (voir erreursChamps ci-dessus) : le champ en cause peut appartenir à
              une étape déjà quittée, donc invisible sur l'étape courante — cette liste reste le
              seul endroit qui le nomme explicitement. */}
          {Object.keys(erreursChamps).length > 0 && (
            <ul>
              {Object.entries(erreursChamps).map(([champ, messages]) => (
                <li key={champ}>
                  <strong>{champ}</strong> : {messages.join(' ')}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

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
