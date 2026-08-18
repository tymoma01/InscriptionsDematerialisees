import { useEffect, useState } from 'react';
import { useSession } from '../auth/useSession';
import { listerTransitions, appliquerTransition, listerMotifsPourAction } from '../../services/transitionService';
import './GestionTransitions.css';

// Actions de la machine à états d'un dossier (CLAUDE.md, section Rôles : "décision finale
// (validé/refusé)") — entièrement générique : ne connaît aucun code_action ni statut en dur, tout
// vient de GET /dossiers/:id/transitions, déjà filtré côté serveur par ce que le rôle connecté
// est autorisé à déclencher (voir backend core/workflow/workflowEngine.js, transition_roles).
// Une liste vide n'est donc pas une erreur : c'est qu'il n'y a rien à faire pour ce rôle depuis le
// statut courant du dossier.
//
// dossierId reçu en prop, comme GestionRendezvous.jsx / HistoriqueRelances.jsx — ce composant ne
// connaît rien du routage.
//
// Le commentaire est toujours obligatoire (le serveur le revalide, voir workflowEngine.
// appliquerTransition) ; le motif ne l'est que si la transition choisie le requiert
// (transition.motif_requis), auquel cas son vocabulaire est chargé depuis
// GET /dossiers/transitions/motifs?codeAction=... au moment où l'action est sélectionnée.
//
// Exception explicite à la généricité ci-dessus (audit 2026-08-19, dossier #75) :
// CODE_ACTION_EXCLU écarte 'planifier_test' de la liste, quel que soit le statut courant. Cette
// transition change SEULEMENT le statut (en_attente_pieces -> test_planifie) sans les deux effets
// de bord que le flux dédié (CaptureTablette.jsx/ModalePlanificationTest.jsx, écran Pièces)
// applique toujours ensemble : vérifier les pièces obligatoires et créer la ligne `rendezvous`
// correspondante. Déclenchée ici, elle produit un dossier "Test planifié" sans aucun rendez-vous
// réel ni pièce reçue — c'est exactement ce qui est arrivé au dossier #75. Retirer le bouton
// plutôt que dupliquer ces vérifications ici : la planification doit rester un seul chemin.
// D'autres transitions du même workflow ACCECIT (replanifier_test, test_non_realise,
// invalider_test, valider_envoi_formation, valider_pret_embauche) partagent un risque comparable
// (leurs écrans dédiés — TableauDeBordAccueil.jsx/ModalePlanificationTest.jsx, Evaluation.jsx via
// evaluationEngine.enregistrerEvaluation — appellent aussi ce même workflowEngine.appliquerTransition
// générique après avoir écrit leurs propres données liées) : volontairement PAS exclues ici sans
// validation explicite, voir le rapport d'audit du 2026-08-19.
const CODE_ACTION_EXCLU = 'planifier_test';

export default function GestionTransitions({ dossierId, onTransitionAppliquee }) {
  const { utilisateur, chargement: chargementSession } = useSession();

  const [transitions, setTransitions] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);

  const [actionEnCours, setActionEnCours] = useState(null); // transition sélectionnée, ou null
  const [motifs, setMotifs] = useState([]);
  const [motifChoisi, setMotifChoisi] = useState('');
  const [commentaire, setCommentaire] = useState('');
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [erreurEnvoi, setErreurEnvoi] = useState(null);

  const chargerTransitions = () => {
    setChargement(true);
    setErreur(null);
    return listerTransitions(dossierId)
      .then((valeur) => setTransitions(valeur.filter((transition) => transition.code_action !== CODE_ACTION_EXCLU)))
      .catch((erreur) => setErreur(erreur.response?.data?.erreur ?? 'Impossible de récupérer les actions disponibles.'))
      .finally(() => setChargement(false));
  };

  useEffect(() => {
    chargerTransitions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dossierId]);

  const ouvrirAction = (transition) => {
    setActionEnCours(transition);
    setCommentaire('');
    setMotifChoisi('');
    setErreurEnvoi(null);
    if (transition.motif_requis) {
      listerMotifsPourAction(transition.code_action)
        .then((valeur) => {
          setMotifs(valeur);
          if (valeur.length > 0) setMotifChoisi(valeur[0].code);
        })
        .catch(() => setMotifs([]));
    } else {
      setMotifs([]);
    }
  };

  const annulerAction = () => {
    setActionEnCours(null);
    setErreurEnvoi(null);
  };

  const confirmerAction = async (evenement) => {
    evenement.preventDefault();
    if (!commentaire.trim()) return;
    if (actionEnCours.motif_requis && !motifChoisi) return;

    setEnvoiEnCours(true);
    setErreurEnvoi(null);
    try {
      await appliquerTransition(dossierId, {
        codeAction: actionEnCours.code_action,
        motifCode: actionEnCours.motif_requis ? motifChoisi : undefined,
        commentaire,
      });
      setActionEnCours(null);
      await chargerTransitions();
      onTransitionAppliquee?.();
    } catch (erreur) {
      setErreurEnvoi(
        erreur.response
          ? (erreur.response.data?.erreur ?? "Le serveur n'a pas pu enregistrer la décision. Merci de réessayer.")
          : 'Connexion au serveur impossible. Vérifiez le réseau et réessayez.',
      );
    } finally {
      setEnvoiEnCours(false);
    }
  };

  if (chargementSession) {
    return <p>Chargement de la session…</p>;
  }

  if (!utilisateur) {
    return <p role="alert">Vous devez être connecté pour agir sur ce dossier.</p>;
  }

  return (
    <section className="gestion-transitions">
      <h2>Décision</h2>

      {chargement && <p>Chargement des actions disponibles…</p>}
      {erreur && <p role="alert">{erreur}</p>}

      {!chargement && !erreur && transitions.length === 0 && (
        <p className="gestion-transitions__vide">
          Aucune action disponible sur ce dossier pour votre rôle, dans son statut actuel.
        </p>
      )}

      {/* "Passer à « … »" plutôt que le seul libellé du statut destination (audit 2026-08-19,
          dossier #83 lu à tort comme "déjà planifié" par un agent) : aucun pattern verbe-par-
          action n'existe ailleurs dans l'app à réutiliser (composant générique, voir son
          commentaire d'en-tête — pas de dictionnaire code_action -> libellé ACCECIT ici) ; ce
          préfixe reste donc lui aussi générique, applicable à N'IMPORTE QUELLE transition sans
          connaître son code_action, et lève l'ambiguïté bouton/état en une seule fois pour toutes
          les transitions de ce bloc. */}
      {!chargement && !erreur && transitions.length > 0 && !actionEnCours && (
        <div className="gestion-transitions__actions">
          {transitions.map((transition) => (
            <button key={transition.id} type="button" onClick={() => ouvrirAction(transition)}>
              Passer à « {transition.statut_destination_libelle} »
            </button>
          ))}
        </div>
      )}

      {actionEnCours && (
        <form className="gestion-transitions__formulaire" onSubmit={confirmerAction}>
          <h3>{actionEnCours.statut_destination_libelle}</h3>

          {actionEnCours.motif_requis && (
            <label>
              <span>Motif (obligatoire)</span>
              <select value={motifChoisi} onChange={(evenement) => setMotifChoisi(evenement.target.value)} required>
                {motifs.length === 0 && <option value="">Aucun motif configuré</option>}
                {motifs.map((motif) => (
                  <option key={motif.code} value={motif.code}>
                    {motif.libelle}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label>
            <span>Commentaire (obligatoire)</span>
            <textarea
              value={commentaire}
              onChange={(evenement) => setCommentaire(evenement.target.value)}
              rows={3}
              required
            />
          </label>

          {erreurEnvoi && <p role="alert">{erreurEnvoi}</p>}

          <div className="gestion-transitions__formulaire-actions">
            <button type="button" onClick={annulerAction} disabled={envoiEnCours}>
              Annuler
            </button>
            <button
              type="submit"
              disabled={
                envoiEnCours ||
                !commentaire.trim() ||
                (actionEnCours.motif_requis && (!motifChoisi || motifs.length === 0))
              }
            >
              {envoiEnCours ? 'Enregistrement...' : 'Confirmer'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
