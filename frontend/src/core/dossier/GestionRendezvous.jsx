import { useEffect, useState } from 'react';
import { useSession } from '../auth/useSession';
import StatutBadge from '../workflow/StatutBadge';
import {
  listerRendezvous,
  changerStatutRendezvous,
  listerMotifsDesistement,
} from '../../services/rendezvousService';
import './GestionRendezvous.css';

// Trois formats distincts plutôt qu'un seul date+heure combiné (comportement précédent) : la
// colonne timeline (voir .gestion-rendezvous__timeline) affiche jour/mois et heure sur deux
// lignes séparées, et la métadonnée "Planifié le [date] à [heure]" recompose les deux dans une
// phrase — même logique de découpage que ModalePlanificationTest.jsx (date/heure/minute saisis
// comme trois contrôles séparés).
const FORMAT_JOUR_MOIS = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit' });
const FORMAT_HEURE = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const FORMAT_DATE_SEULE = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

// Statuts constituant un désistement (voir backend rendezvousService.js, STATUTS_DESISTEMENT) :
// un motif est obligatoire pour ces deux-là, jamais pour 'confirme'.
const STATUTS_DESISTEMENT = ['absent', 'annule'];

// 'remplace' (posé automatiquement par neutraliserRendezvousActifsDossier lors d'une
// replanification, jamais choisi par un agent — voir rendezvousRepository.js) retombait
// jusqu'ici sur la variante par défaut 'attente', indiscernable visuellement d'un rendez-vous
// réellement 'prevu' — badge neutre gris explicite désormais (audit 2026-08-19, refonte
// timeline), cohérent avec son statut de simple historique, jamais l'état à mettre en avant.
function varianteStatutRendezvous(statut) {
  if (statut === 'confirme') return 'succes';
  if (STATUTS_DESISTEMENT.includes(statut)) return 'echec';
  if (statut === 'remplace') return 'neutre';
  return 'attente';
}

const LIBELLES_STATUT = {
  prevu: 'Prévu',
  confirme: 'Confirmé',
  absent: 'Absent',
  annule: 'Annulé',
  remplace: 'Remplacé',
};

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
            // Seul état "remplacé" (posé automatiquement lors d'une replanification, voir
            // varianteStatutRendezvous ci-dessus) à estomper — absent/annule/confirme/prevu
            // restent tous des états "actifs" au sens de cette page : ce sont de vrais
            // événements arrivés à CE rendez-vous précis (demande explicite, "non remplacé" est
            // le seul critère, pas le statut exact).
            const estRemplace = rdv.statut === 'remplace';

            return (
              <li
                key={rdv.id}
                className={`gestion-rendezvous__item ${
                  estRemplace ? 'gestion-rendezvous__item--remplace' : 'gestion-rendezvous__item--actif'
                }`}
              >
                {/* Colonne timeline (audit 2026-08-19, refonte visuelle) — jour/mois du TEST en
                    évidence, heure en dessous plus petite/discrète, plutôt que la date en
                    préfixe inline de la ligne de titre (comportement précédent). Toujours la
                    date_heure du rendez-vous lui-même (le test), jamais planifie_le (voir la
                    métadonnée "Planifié le..." plus bas, qui elle porte cette seconde date). */}
                <div className="gestion-rendezvous__timeline">
                  <span className="gestion-rendezvous__timeline-jour">
                    {FORMAT_JOUR_MOIS.format(new Date(rdv.date_heure))}
                  </span>
                  <span className="gestion-rendezvous__timeline-heure">
                    {FORMAT_HEURE.format(new Date(rdv.date_heure))}
                  </span>
                </div>

                <div className="gestion-rendezvous__contenu">
                  <div className="gestion-rendezvous__ligne">
                    <span className="gestion-rendezvous__type">{rdv.type_rdv}</span>
                    <StatutBadge libelle={LIBELLES_STATUT[rdv.statut] ?? rdv.statut} variante={varianteStatutRendezvous(rdv.statut)} />
                    {rdv.motif_libelle && (
                      <span className="gestion-rendezvous__motif">Motif : {rdv.motif_libelle}</span>
                    )}
                  </div>

                  {/* "Planifié le [date] à [heure] par [Nom] (Rôle)" (audit 2026-08-19, demande
                      explicite) — métadonnée toujours affichée dès qu'un auteur est connu (plus
                      seulement en présence d'une note, comportement précédent), dérivée de
                      journal_audit (rendezvous n'a lui-même aucune colonne auteur/date de
                      planification, voir rendezvousRepository.listerRendezvousParDossier).
                      Absente pour un rendez-vous créé hors API (script de dev, planifie_par_prenom
                      NULL dans ce cas). */}
                  {rdv.planifie_par_prenom && (
                    <p className="gestion-rendezvous__meta-planification">
                      Planifié le {FORMAT_DATE_SEULE.format(new Date(rdv.planifie_le))} à{' '}
                      {FORMAT_HEURE.format(new Date(rdv.planifie_le))} par {rdv.planifie_par_prenom}{' '}
                      {rdv.planifie_par_nom} ({rdv.planifie_par_role_libelle})
                    </p>
                  )}

                  {/* Note de planification (migration 049, ModalePlanificationTest.jsx) — propre
                      à CE rendez-vous, distincte du bloc "Notes" général (NotesDossier.jsx) rendu
                      plus bas sur la fiche dossier. Deux présentations distinctes (audit
                      2026-08-19, demande explicite) : un encart toujours visible pour le
                      rendez-vous actif (ne doit rien manquer à l'agent), un <details> replié par
                      défaut pour un rendez-vous remplacé (reste consultable — "l'historique
                      reste consultable" — sans concurrencer visuellement le rendez-vous actif). */}
                  {rdv.note_planification && !estRemplace && (
                    <div className="gestion-rendezvous__note-encart">
                      <p className="gestion-rendezvous__note-contenu">{rdv.note_planification}</p>
                    </div>
                  )}
                  {rdv.note_planification && estRemplace && (
                    <details className="gestion-rendezvous__note-repliee">
                      <summary>Voir la note de planification</summary>
                      <p className="gestion-rendezvous__note-contenu">{rdv.note_planification}</p>
                    </details>
                  )}

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
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
