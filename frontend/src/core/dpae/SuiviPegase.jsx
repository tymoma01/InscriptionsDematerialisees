import { useEffect, useState } from 'react';
import { peut } from '../auth/permissions';
import { relancerEnvoiPegase } from '../../services/dpaeService';
import './SuiviPegase.css';

// Salarié Pégase de la demande, traité par le serveur à sa validation : création pour une nouvelle
// embauche, recherche de son id pour un salarié déjà employé (`pegase.recherche`). `pegase` : champ
// du même nom de la demande (null = demande non validée). Le traitement se fait en arrière-plan :
// tant qu'il est en cours, la fiche est rechargée régulièrement.
const INTERVALLE_RECHARGEMENT_MS = 3000;
const RECHARGEMENTS_MAX = 20;

const TITRE_PAR_STATUT = {
  cree: 'Salarié créé dans Pégase',
  doublon: 'Salarié déjà présent dans Pégase',
  retrouve: 'Salarié retrouvé dans Pégase',
};

// Messages informatifs, pas des alertes : salarié déjà connu de Pégase.
const STATUTS_SANS_ALERTE = new Set(['doublon', 'retrouve']);

function titre(pegase) {
  if (pegase.enCours) return pegase.recherche ? 'Recherche dans Pégase en cours…' : 'Création dans Pégase en cours…';
  if (!pegase.statut) return 'Pas encore transmis à Pégase';
  if (pegase.statut === 'erreur') return pegase.recherche ? 'Échec de la recherche dans Pégase' : 'Échec de la création dans Pégase';
  return TITRE_PAR_STATUT[pegase.statut];
}

export default function SuiviPegase({ pegase, demandeId, utilisateur, onRecharger }) {
  const [relanceEnCours, setRelanceEnCours] = useState(false);
  const [erreurRelance, setErreurRelance] = useState(null);
  const [rechargements, setRechargements] = useState(0);

  const enAttente = Boolean(pegase?.enCours);

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

  const variante = enAttente || !pegase.statut ? 'attente' : pegase.statut;

  return (
    <section className={`page-detail-dpae__bloc suivi-pegase suivi-pegase--${variante}`}>
      <h2>{titre(pegase)}</h2>
      {pegase.pegasePersonnelId && <p>Identifiant Pégase : {pegase.pegasePersonnelId}</p>}
      {pegase.statut === 'cree' && <p>Pièces justificatives envoyées : {pegase.piecesEnvoyees.length}</p>}
      {pegase.message && <p className={STATUTS_SANS_ALERTE.has(pegase.statut) ? undefined : 'suivi-pegase__message'}>{pegase.message}</p>}
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
          {relanceEnCours ? 'Relance…' : pegase.recherche ? 'Relancer la recherche dans Pégase' : 'Relancer l’envoi vers Pégase'}
        </button>
      )}
      {erreurRelance && <p className="suivi-pegase__message">{erreurRelance}</p>}
    </section>
  );
}
