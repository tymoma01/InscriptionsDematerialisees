import { useEffect, useState } from 'react';
import { useSession } from '../auth/useSession';
import StatutBadge from '../workflow/StatutBadge';
import {
  listerRendezvous,
  changerStatutRendezvous,
  listerMotifsDesistement,
} from '../../services/rendezvousService';
import './GestionRendezvous.css';

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

// Statuts constituant un désistement (voir backend rendezvousService.js, STATUTS_DESISTEMENT) :
// un motif est obligatoire pour ces deux-là, jamais pour 'confirme'.
const STATUTS_DESISTEMENT = ['absent', 'annule'];

function varianteStatutRendezvous(statut) {
  if (statut === 'confirme') return 'succes';
  if (STATUTS_DESISTEMENT.includes(statut)) return 'echec';
  return 'attente';
}

const LIBELLES_STATUT = { prevu: 'Prévu', confirme: 'Confirmé', absent: 'Absent', annule: 'Annulé' };

// Rendez-vous d'un dossier (CLAUDE.md, besoin Accueil/Coordination : "relances et
// reprogrammations" + "motif de désistement enregistré systématiquement, pour objectiver le
// phénomène"). dossierId reçu en prop, comme HistoriqueRelances.jsx — ce composant ne connaît
// rien du routage.
//
// Le formulaire de désistement (motif obligatoire) est un garde-fou côté UI : le serveur revalide
// systématiquement (voir services/rendezvousService.js), donc même si ce composant était
// contourné, aucun désistement ne peut être enregistré sans motif.
export default function GestionRendezvous({ dossierId }) {
  const { utilisateur, chargement: chargementSession } = useSession();

  const [rendezvous, setRendezvous] = useState([]);
  const [motifs, setMotifs] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);

  const [desistementEnCours, setDesistementEnCours] = useState(null); // { rendezvousId, statutCible }
  const [motifChoisi, setMotifChoisi] = useState('');
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [erreurEnvoi, setErreurEnvoi] = useState(null);

  const chargerRendezvous = () => {
    setChargement(true);
    setErreur(null);
    return listerRendezvous(dossierId)
      .then(setRendezvous)
      .catch((erreur) => setErreur(erreur.response?.data?.erreur ?? 'Impossible de récupérer les rendez-vous.'))
      .finally(() => setChargement(false));
  };

  useEffect(() => {
    let annule = false;
    chargerRendezvous();
    listerMotifsDesistement()
      .then((valeur) => {
        if (annule) return;
        setMotifs(valeur);
        if (valeur.length > 0) setMotifChoisi(valeur[0].code);
      })
      .catch(() => {
        // Non bloquant : sans motifs configurés, marquer un désistement reste désactivé (voir
        // bouton plus bas) mais la liste ci-dessus reste consultable.
      });
    return () => {
      annule = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dossierId]);

  const ouvrirDesistement = (rendezvousId, statutCible) => {
    setDesistementEnCours({ rendezvousId, statutCible });
    setErreurEnvoi(null);
  };

  const annulerDesistement = () => {
    setDesistementEnCours(null);
    setErreurEnvoi(null);
  };

  const confirmerDesistement = async (evenement) => {
    evenement.preventDefault();
    if (!motifChoisi) return;
    setEnvoiEnCours(true);
    setErreurEnvoi(null);
    try {
      await changerStatutRendezvous(dossierId, desistementEnCours.rendezvousId, {
        statut: desistementEnCours.statutCible,
        motifCode: motifChoisi,
      });
      setDesistementEnCours(null);
      await chargerRendezvous();
    } catch (erreur) {
      setErreurEnvoi(
        erreur.response
          ? (erreur.response.data?.erreur ?? "Le serveur n'a pas pu enregistrer le désistement. Merci de réessayer.")
          : 'Connexion au serveur impossible. Vérifiez le réseau et réessayez.',
      );
    } finally {
      setEnvoiEnCours(false);
    }
  };

  const marquerConfirme = async (rendezvousId) => {
    setEnvoiEnCours(true);
    setErreurEnvoi(null);
    try {
      await changerStatutRendezvous(dossierId, rendezvousId, { statut: 'confirme' });
      await chargerRendezvous();
    } catch (erreur) {
      setErreurEnvoi(
        erreur.response
          ? (erreur.response.data?.erreur ?? "Le serveur n'a pas pu enregistrer la confirmation. Merci de réessayer.")
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
    return <p role="alert">Vous devez être connecté pour consulter les rendez-vous.</p>;
  }

  return (
    <section className="gestion-rendezvous">
      <h2>Rendez-vous</h2>

      {chargement && <p>Chargement des rendez-vous…</p>}
      {erreur && <p role="alert">{erreur}</p>}

      {!chargement && !erreur && rendezvous.length === 0 && (
        <p className="gestion-rendezvous__vide">Aucun rendez-vous pour ce dossier.</p>
      )}

      {!chargement && !erreur && rendezvous.length > 0 && (
        <ul className="gestion-rendezvous__liste">
          {rendezvous.map((rdv) => {
            const enDesistementPourCeRdv = desistementEnCours?.rendezvousId === rdv.id;
            const actionsDisponibles = rdv.statut === 'prevu' || rdv.statut === 'confirme';

            return (
              <li key={rdv.id} className="gestion-rendezvous__item">
                <div className="gestion-rendezvous__ligne">
                  <span className="gestion-rendezvous__type">{rdv.type_rdv}</span>
                  <span className="gestion-rendezvous__date">{FORMAT_DATE.format(new Date(rdv.date_heure))}</span>
                  <StatutBadge libelle={LIBELLES_STATUT[rdv.statut] ?? rdv.statut} variante={varianteStatutRendezvous(rdv.statut)} />
                  {rdv.motif_libelle && (
                    <span className="gestion-rendezvous__motif">Motif : {rdv.motif_libelle}</span>
                  )}
                </div>

                {actionsDisponibles && !enDesistementPourCeRdv && (
                  <div className="gestion-rendezvous__actions">
                    {rdv.statut === 'prevu' && (
                      <button type="button" onClick={() => marquerConfirme(rdv.id)} disabled={envoiEnCours}>
                        Confirmer la présence
                      </button>
                    )}
                    <button type="button" onClick={() => ouvrirDesistement(rdv.id, 'absent')} disabled={envoiEnCours}>
                      Marquer absent
                    </button>
                    <button type="button" onClick={() => ouvrirDesistement(rdv.id, 'annule')} disabled={envoiEnCours}>
                      Marquer annulé
                    </button>
                  </div>
                )}

                {enDesistementPourCeRdv && (
                  <form className="gestion-rendezvous__formulaire-motif" onSubmit={confirmerDesistement}>
                    <label>
                      <span>Motif du désistement (obligatoire)</span>
                      <select value={motifChoisi} onChange={(evenement) => setMotifChoisi(evenement.target.value)} required>
                        {motifs.length === 0 && <option value="">Aucun motif configuré</option>}
                        {motifs.map((motif) => (
                          <option key={motif.code} value={motif.code}>
                            {motif.libelle}
                          </option>
                        ))}
                      </select>
                    </label>

                    {erreurEnvoi && <p role="alert">{erreurEnvoi}</p>}

                    <div className="gestion-rendezvous__formulaire-motif-actions">
                      <button type="button" onClick={annulerDesistement} disabled={envoiEnCours}>
                        Annuler
                      </button>
                      <button type="submit" disabled={envoiEnCours || motifs.length === 0}>
                        {envoiEnCours ? 'Enregistrement...' : 'Confirmer le désistement'}
                      </button>
                    </div>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
