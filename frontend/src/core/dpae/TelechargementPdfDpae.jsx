import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '../auth/useSession';
import { ROLES_DPAE_CONSULTATION } from '../auth/rolesGroupes';
import { telechargerPdfDemande, telechargerPdfDemandes } from '../../services/dpaeService';
import './TelechargementPdfDpae.css';

// Téléchargement des demandes DPAE en PDF (2026-10-02) — PDF générés côté serveur
// (backend/src/core/dpae/pdfDemandeDpae.js). Source unique côté front, partagée par la fiche
// (DetailDemandeDpae.jsx) et les deux listes « Demandes DPAE » (SuiviDemandesDpae.jsx pour Admin,
// Planning et Inspecteur Hôtellerie ; TraitementDpae.jsx, file RH) : bouton de la fiche, cases à
// cocher, action groupée (ZIP).
//
// Visible pour les rôles qui consultent les demandes DPAE (ROLES_DPAE_CONSULTATION : Admin, RH,
// Planning, Inspecteur Hôtellerie), pour aucun autre — mêmes règles que le serveur, seul juge
// (dpae.routes.js, GET /:id/pdf et POST /export-pdf).

// Miroir de LIMITE_DEMANDES_PAR_ZIP (dpae.routes.js) : prévient avant l'envoi, le serveur refuse
// de toute façon au-delà.
export const LIMITE_DEMANDES_PAR_ZIP = 50;

export function usePeutTelechargerPdfDpae() {
  const { utilisateur } = useSession();
  return ROLES_DPAE_CONSULTATION.includes(utilisateur?.roleCode);
}

// Nom du fichier fixé par le serveur : filename* (UTF-8, accents conservés) en priorité, sinon
// filename (même lecture que l'export ZIP des pièces, Validation.jsx).
function nomFichierDepuisReponse(reponse, nomParDefaut) {
  const disposition = reponse.headers['content-disposition'] ?? '';
  const encode = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  if (encode) {
    try {
      return decodeURIComponent(encode);
    } catch {
      // Encodage inattendu : on retombe sur filename ci-dessous.
    }
  }
  return /filename="([^"]+)"/.exec(disposition)?.[1] ?? nomParDefaut;
}

function enregistrerFichier(reponse, nomParDefaut) {
  const url = URL.createObjectURL(reponse.data);
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = nomFichierDepuisReponse(reponse, nomParDefaut);
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  URL.revokeObjectURL(url);
}

// Corps d'erreur reçu sous forme de Blob (responseType: 'blob') : relu en JSON pour afficher le
// message du serveur (hors périmètre, limite de 50…).
async function messageErreur(erreurRequete) {
  if (!erreurRequete.response) return 'Connexion au serveur impossible. Vérifiez le réseau et réessayez.';
  let messageServeur = null;
  try {
    messageServeur = JSON.parse(await erreurRequete.response.data.text()).erreur;
  } catch {
    messageServeur = null;
  }
  if (erreurRequete.response.status === 403) return messageServeur ?? "Vous n'avez pas accès à ce téléchargement.";
  if (erreurRequete.response.status === 404) return messageServeur ?? 'Demande introuvable.';
  return messageServeur ?? 'Le téléchargement du PDF a échoué. Merci de réessayer.';
}

function useTelechargement(lancer, nomParDefaut) {
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState(null);
  const telecharger = async (...args) => {
    setEnCours(true);
    setErreur(null);
    try {
      enregistrerFichier(await lancer(...args), nomParDefaut);
    } catch (erreurRequete) {
      setErreur(await messageErreur(erreurRequete));
    } finally {
      setEnCours(false);
    }
  };
  return { enCours, erreur, telecharger };
}

function libelleBouton(enCours) {
  return enCours ? 'Préparation du PDF…' : 'Télécharger en PDF';
}

// Fiche d'une demande : bouton placé à côté de la pastille de statut.
export function BoutonTelechargerPdfDemande({ demandeId }) {
  const peutTelecharger = usePeutTelechargerPdfDpae();
  const { enCours, erreur, telecharger } = useTelechargement(telechargerPdfDemande, `DPAE ${demandeId}.pdf`);
  if (!peutTelecharger) return null;
  return (
    <>
      <button type="button" className="telechargement-pdf-dpae__bouton" onClick={() => telecharger(demandeId)} disabled={enCours}>
        {libelleBouton(enCours)}
      </button>
      {erreur && (
        <p role="alert" className="telechargement-pdf-dpae__erreur">
          {erreur}
        </p>
      )}
    </>
  );
}

// Sélection de demandes d'une liste. Seules les demandes AFFICHÉES comptent : une demande cochée
// puis masquée par un filtre (ou disparue au rafraîchissement automatique) n'est jamais téléchargée.
export function useSelectionDemandesDpae(demandes) {
  const [idsCoches, setIdsCoches] = useState(() => new Set());
  const idsVisibles = useMemo(() => demandes.map((demande) => demande.id), [demandes]);
  const selection = useMemo(() => idsVisibles.filter((id) => idsCoches.has(id)), [idsVisibles, idsCoches]);
  const toutCoche = idsVisibles.length > 0 && selection.length === idsVisibles.length;

  return {
    selection,
    toutCoche,
    partiel: selection.length > 0 && !toutCoche,
    estCoche: (id) => idsCoches.has(id),
    basculer: (id) =>
      setIdsCoches((precedent) => {
        const suivant = new Set(precedent);
        if (suivant.has(id)) suivant.delete(id);
        else suivant.add(id);
        return suivant;
      }),
    // « Tout cocher » : coche toutes les demandes affichées, ou décoche tout si elles le sont déjà.
    basculerTout: () => setIdsCoches(toutCoche ? new Set() : new Set(idsVisibles)),
    vider: () => setIdsCoches(new Set()),
  };
}

// Évite qu'un clic ou Entrée sur une case n'ouvre la fiche (lignes cliquables du suivi).
const arreterPropagation = (evenement) => evenement.stopPropagation();

export function CaseToutCocherDpae({ selectionDemandes }) {
  const reference = useRef(null);
  useEffect(() => {
    if (reference.current) reference.current.indeterminate = selectionDemandes.partiel;
  }, [selectionDemandes.partiel]);
  return (
    <input
      ref={reference}
      type="checkbox"
      className="telechargement-pdf-dpae__case"
      checked={selectionDemandes.toutCoche}
      onChange={selectionDemandes.basculerTout}
      onClick={arreterPropagation}
      aria-label="Tout cocher"
    />
  );
}

export function CaseDemandeDpae({ selectionDemandes, demande }) {
  return (
    <input
      type="checkbox"
      className="telechargement-pdf-dpae__case"
      checked={selectionDemandes.estCoche(demande.id)}
      onChange={() => selectionDemandes.basculer(demande.id)}
      onClick={arreterPropagation}
      onKeyDown={arreterPropagation}
      aria-label={`Sélectionner la demande n° ${demande.id} (${demande.salarie_nom} ${demande.salarie_prenom})`}
    />
  );
}

// Action groupée : nombre de demandes cochées et « Télécharger en PDF » (un ZIP, un PDF par
// demande). Au-delà de 50 : bouton désactivé et message explicite, sans appel au serveur.
export function ActionTelechargementPdfDpae({ selectionDemandes }) {
  const { enCours, erreur, telecharger } = useTelechargement(telechargerPdfDemandes, 'Demandes DPAE.zip');
  const nombre = selectionDemandes.selection.length;
  const auDelaLimite = nombre > LIMITE_DEMANDES_PAR_ZIP;
  return (
    <div className="telechargement-pdf-dpae__action" role="group" aria-label="Demandes sélectionnées">
      <span className="telechargement-pdf-dpae__compteur">
        {nombre === 0 ? 'Aucune demande sélectionnée' : `${nombre} demande${nombre > 1 ? 's' : ''} sélectionnée${nombre > 1 ? 's' : ''}`}
      </span>
      <button
        type="button"
        className="telechargement-pdf-dpae__bouton"
        onClick={() => telecharger(selectionDemandes.selection)}
        disabled={nombre === 0 || auDelaLimite || enCours}
      >
        {libelleBouton(enCours)}
      </button>
      {nombre > 0 && (
        <button type="button" className="telechargement-pdf-dpae__vider" onClick={selectionDemandes.vider} disabled={enCours}>
          Tout décocher
        </button>
      )}
      {auDelaLimite && (
        <p role="alert" className="telechargement-pdf-dpae__erreur">
          {nombre} demandes sélectionnées : le téléchargement est limité à {LIMITE_DEMANDES_PAR_ZIP} demandes par fichier ZIP.
          Décochez-en au moins {nombre - LIMITE_DEMANDES_PAR_ZIP}.
        </p>
      )}
      {erreur && !auDelaLimite && (
        <p role="alert" className="telechargement-pdf-dpae__erreur">
          {erreur}
        </p>
      )}
    </div>
  );
}
