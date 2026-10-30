import { useEffect, useState } from 'react';
import { peut } from '../auth/permissions';
import { relancerEnvoiPegase } from '../../services/dpaeService';
import './SuiviPegase.css';

// Création du salarié dans Pégase, déclenchée par le serveur à la validation d'une nouvelle
// embauche. `pegase` : champ du même nom de la demande (null = demande non concernée). L'envoi se
// fait en arrière-plan : tant qu'il n'a pas de résultat, la fiche est rechargée régulièrement.
const INTERVALLE_RECHARGEMENT_MS = 3000;
const RECHARGEMENTS_MAX = 20;

const TITRE_PAR_STATUT = {
  cree: 'Salarié créé dans Pégase',
  doublon: 'Salarié déjà présent dans Pégase',
  erreur: 'Échec de la création dans Pégase',
};

export default function SuiviPegase({ pegase, demandeId, utilisateur, onRecharger }) {
  const [relanceEnCours, setRelanceEnCours] = useState(false);
  const [erreurRelance, setErreurRelance] = useState(null);
  const [rechargements, setRechargements] = useState(0);

  const enAttente = Boolean(pegase && (pegase.enCours || !pegase.statut));

  useEffect(() => {
    if (!enAttente || rechargements >= RECHARGEMENTS_MAX) return undefined;
    const minuterie = setTimeout(() => {
      setRechargements((nombre) => nombre + 1);
      onRecharger();
    }, INTERVALLE_RECHARGEMENT_MS);
    return () => clearTimeout(minuterie);
  }, [enAttente, rechargements, onRecharger]);

  if (!pegase) return null;

  const relancer = async () => {
    setRelanceEnCours(true);
    setErreurRelance(null);
    try {
      await relancerEnvoiPegase(demandeId);
      setRechargements(0);
      await onRecharger();
    } catch (erreurRequete) {
      setErreurRelance(erreurRequete.response?.data?.erreur ?? 'Impossible de relancer l’envoi vers Pégase.');
    } finally {
      setRelanceEnCours(false);
    }
  };

  const variante = enAttente ? 'attente' : pegase.statut;
  const titre = enAttente ? 'Création dans Pégase en cours…' : TITRE_PAR_STATUT[pegase.statut];

  return (
    <section className={`page-detail-dpae__bloc suivi-pegase suivi-pegase--${variante}`}>
      <h2>{titre}</h2>
      {pegase.pegasePersonnelId && <p>Identifiant Pégase : {pegase.pegasePersonnelId}</p>}
      {pegase.statut === 'cree' && <p>Pièces justificatives envoyées : {pegase.piecesEnvoyees.length}</p>}
      {pegase.message && <p className="suivi-pegase__message">{pegase.message}</p>}
      {pegase.piecesEnErreur.length > 0 && (
        <ul className="suivi-pegase__liste">
          {pegase.piecesEnErreur.map((piece) => (
            <li key={piece.typePieceCode}>
              {piece.typePieceCode} : {piece.erreur}
            </li>
          ))}
        </ul>
      )}
      {pegase.avertissements.length > 0 && (
        <>
          <p>À compléter dans Pégase :</p>
          <ul className="suivi-pegase__liste">
            {pegase.avertissements.map((avertissement) => (
              <li key={avertissement}>{avertissement}</li>
            ))}
          </ul>
        </>
      )}
      {pegase.relancePossible && peut(utilisateur, 'dpaeRelancePegase') && (
        <button type="button" onClick={relancer} disabled={relanceEnCours}>
          {relanceEnCours ? 'Relance…' : 'Relancer l’envoi vers Pégase'}
        </button>
      )}
      {erreurRelance && <p className="suivi-pegase__message">{erreurRelance}</p>}
    </section>
  );
}
