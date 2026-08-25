import { useEffect, useState } from 'react';
import { useSession } from '../auth/useSession';
import StatutBadge from '../workflow/StatutBadge';
import {
  listerRendezvous,
  changerStatutRendezvous,
  listerMotifsDesistement,
} from '../../services/rendezvousService';
import { useRafraichissementAuto } from './useRafraichissementAuto';
import './GestionRendezvous.css';

// Trois formats distincts plutôt qu'un seul date+heure combiné (comportement précédent) : la
// colonne timeline (voir .gestion-rendezvous__timeline) affiche jour/mois et heure sur deux
// lignes séparées, et la métadonnée "Planifié le [date] à [heure]" recompose les deux dans une
// phrase — même logique de découpage que ModalePlanificationTest.jsx (date/heure/minute saisis
// comme trois contrôles séparés).
const FORMAT_JOUR_MOIS = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit' });
const FORMAT_HEURE = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const FORMAT_DATE_SEULE = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

// Un motif est obligatoire pour 'absent'/'annule' (voir backend rendezvousService.js,
// STATUTS_DESISTEMENT), jamais pour 'confirme' — mais les deux divergent désormais en couleur
// (voir varianteStatutRendezvous ci-dessous, audit 2026-08-20) : une annulation s'annonce à
// l'avance (couleur neutre), une absence est un incident constaté après coup (reste 'echec').
//
// 'remplace' (posé automatiquement par neutraliserRendezvousActifsDossier lors d'une
// replanification, jamais choisi par un agent — voir rendezvousRepository.js) retombait
// jusqu'ici sur la variante par défaut 'attente', indiscernable visuellement d'un rendez-vous
// réellement 'prevu' — badge neutre explicite désormais (audit 2026-08-19, refonte timeline),
// cohérent avec son statut de simple historique, jamais l'état à mettre en avant. Variante
// 'neutre-fort' (pas le simple 'neutre', jugé trop discret — audit 2026-08-20) : gris moyen/texte
// foncé, neutre mais bien lisible ; même variante reprise sur Planification.jsx (Suivi des tests)
// pour rester cohérent entre les deux endroits où ce badge apparaît. 'annule' reprend la même
// variante (audit 2026-08-20) : les libellés distincts ("Annulé" vs "Remplacé", voir
// LIBELLES_STATUT plus bas) suffisent à les distinguer, pas besoin d'une troisième teinte neutre.
//
// 'honore' (audit 2026-08-20, dossiers #89/#91/#85/#74/#69, posé par evaluationEngine.
// enregistrerEvaluation) : 'vert-clair', pas 'succes' comme 'confirme' — même famille positive,
// mais visuellement distinct pour ne pas confondre une présence confirmée À L'AVANCE avec un test
// réellement conduit et conclu positivement (voir rendezvousService.STATUTS_AUTORISES pour la
// même distinction côté back). Même variante que le badge dossier "Validé - prêt à l'embauche"
// (Validation.jsx/TableauDeBordAccueil.jsx), cohérent avec l'issue positive qu'il accompagne.
function varianteStatutRendezvous(statut) {
  if (statut === 'confirme') return 'succes';
  if (statut === 'honore') return 'vert-clair';
  if (statut === 'absent') return 'echec';
  if (statut === 'annule' || statut === 'remplace') return 'neutre-fort';
  return 'attente';
}

// Source UNIQUE pour le titre (.gestion-rendezvous__type) ET le badge de statut — audit
// 2026-08-20 : titre et badge affichaient auparavant deux libellés distincts pour 'absent' ("Non
// réalisé" vs "Manqué"), incohérence repérée en comparant avec 'honore' (déjà identique des deux
// côtés, "Réalisé"/"Réalisé"). Un seul dictionnaire désormais, lu aux deux endroits (voir plus
// bas) : titre et badge ne peuvent plus diverger, quel que soit le statut.
const LIBELLES_STATUT = {
  prevu: 'Prévu',
  confirme: 'Confirmé',
  absent: 'Manqué',
  annule: 'Annulé',
  remplace: 'Remplacé',
  honore: 'Réalisé',
};

// Rendez-vous 'prevu' (valeur en base INCHANGÉE, uniquement l'affichage ci-dessous) dont la date
// est déjà passée sans qu'aucun flux (bascule automatique, action manuelle) ne l'ait fait
// avancer — dossier #37, audit 2026-08-21 : montrer "Prévu" pour un test déjà passé induirait en
// erreur. Calculé à la volée à chaque rendu (Date.now()), pas mémorisé : cohérent avec le reste
// de cette page, qui ne maintient aucune horloge vivante.
function rendezvousPrevuExpire(rdv) {
  return rdv.statut === 'prevu' && new Date(rdv.date_heure).getTime() < Date.now();
}

// Libellé/variante EFFECTIFS affichés (titre ET badge) — jamais LIBELLES_STATUT/
// varianteStatutRendezvous appliqués tels quels sans être passés par rendezvousPrevuExpire
// d'abord : "Non réalisé" pour un rendez-vous 'prevu' expiré, DISTINCT de "Manqué"
// (LIBELLES_STATUT.absent, réservé à un désistement réellement enregistré avec motif) — ici,
// personne n'a constaté/enregistré quoi que ce soit, seule la date a débordé.
function libelleAffiche(rdv) {
  if (rendezvousPrevuExpire(rdv)) return 'Non réalisé';
  return LIBELLES_STATUT[rdv.statut] ?? rdv.statut;
}
function varianteAffichee(rdv) {
  if (rendezvousPrevuExpire(rdv)) return 'echec';
  return varianteStatutRendezvous(rdv.statut);
}

// Titre générique fixe devant le badge (.gestion-rendezvous__type) — décision utilisateur,
// 2026-08-21 : remplace l'ancien titre variable par statut (retiré la veille pour les statuts
// clos, "Remplacé Remplacé" jugé redondant — voir git blame), qui changeait de mot selon
// LIBELLES_STATUT/rendezvousPrevuExpire. "Test" reste identique quel que soit le statut, aucune
// variation possible ici : seul le badge juste à côté (voir libelleAffiche/varianteAffichee
// ci-dessus) porte l'information de statut, avec sa couleur habituelle.
const TITRE_RENDEZVOUS = 'Test';

// "Test non réalisé" est désormais porté par le titre/badge "Manqué" ci-dessus (LIBELLES_STATUT)
// pour un rendez-vous 'absent' — le motif affiché à côté ne doit plus le répéter (audit
// 2026-08-20, dossier #86) :
// préfixe retiré s'il est présent (motif dédié "test_non_realise", scripts/
// seedMotifsDesistement.js), laissé tel quel sinon (les autres motifs de désistement — "Ne répond
// plus", "Finalement indisponible"... — n'ont jamais porté ce préfixe).
const PREFIXE_MOTIF_REDONDANT = 'Test non réalisé ';
function libelleMotifAffiche(motifLibelle) {
  if (motifLibelle?.startsWith(PREFIXE_MOTIF_REDONDANT)) {
    return motifLibelle.slice(PREFIXE_MOTIF_REDONDANT.length);
  }
  return motifLibelle;
}

// Statuts de DOSSIER (pas de rendez-vous) au-delà desquels Confirmer la présence/Marquer absent/
// Marquer annulé n'ont plus de sens — copie exacte de STATUTS_DOSSIER_RENDEZVOUS_CLOS
// (backend/src/core/rendezvous/rendezvousService.js, qui revérifie la même règle côté serveur,
// voir son commentaire) : les deux listes doivent rester synchronisées à la main, aucun partage de
// code entre front et back sur ce projet (audit 2026-08-20, dossier #84).
// 'test_realise' ajouté (workflow v5, audit 2026-08-21) : une fois le test confirmé réalisé par le
// formateur/inspecteur assigné, le rendez-vous est lui aussi tranché — même raisonnement que les
// autres statuts déjà listés ici.
const STATUTS_DOSSIER_RENDEZVOUS_CLOS = [
  'test_realise',
  'test_non_realise',
  'invalide',
  'valide_envoi_formation',
  'valide_pret_embauche',
];

// Rôles autorisés à gérer un rendez-vous (reprogrammation/désistement ici, planification côté back
// — voir ROLES_GESTION_RENDEZVOUS, rendezvous.routes.js) — exportée (audit 2026-08-25) pour que
// Tests.jsx réutilise EXACTEMENT la même liste plutôt que de la dupliquer, pour son propre bouton
// "Valider et planifier un test" (première planification d'un test, voir son commentaire d'en-tête) :
// jamais deux listes de rôles à faire évoluer séparément pour une même action.
export const ROLES_GESTION_RENDEZVOUS = ['accueil_coordination', 'recruteur', 'admin'];

// Rendez-vous d'un dossier (CLAUDE.md, besoin Accueil/Coordination : "relances et
// reprogrammations" + "motif de désistement enregistré systématiquement, pour objectiver le
// phénomène"). dossierId reçu en prop, comme HistoriqueRelances.jsx — ce composant ne connaît
// rien du routage.
//
// codeStatutDossier/libelleStatutDossier (audit 2026-08-20, dossier #84) : reçus du parent
// (Relances.jsx, qui les a déjà via obtenirDossier) plutôt que rechargés ici — ce composant
// n'appelait jusqu'ici jamais GET /dossiers/:id, pas la peine d'ajouter un second appel réseau
// juste pour connaître le statut du dossier.
//
// Le formulaire de désistement (motif obligatoire) est un garde-fou côté UI : le serveur revalide
// systématiquement (voir services/rendezvousService.js), donc même si ce composant était
// contourné, aucun désistement ne peut être enregistré sans motif. Le verrouillage ci-dessous suit
// le même principe : masquage ici, revérifié côté serveur (rendezvousService.
// changerStatutRendezvous, ErreurRendezvousDossierClos) — jamais qu'un garde-fou d'affichage.
//
// dernierSeulement (audit 2026-08-21, Tests.jsx) : n'affiche que le premier élément de
// `rendezvous` (déjà trié par le back — non-remplacés d'abord, puis date de PLANIFICATION
// décroissante, voir rendezvousRepository.listerRendezvousParDossier) et omet le <h2> ci-dessous,
// pour s'insérer dans une section "Rendez-vous" qui porte déjà son propre titre (voir
// .page-tests__rendezvous-entete) — plutôt que de dupliquer la logique d'affichage (timeline/
// titre/badge/motif/actions) dans Tests.jsx, seul autre écran qui a besoin d'un aperçu du dossier
// sans son historique complet (déjà visible sur Relances.jsx, point de rendu par défaut de ce
// composant). L'état "aucun rendez-vous" (voir plus bas) reste affiché tel quel dans les deux
// modes : c'est déjà le message que ce cas d'usage doit reprendre (point 4 de la demande), pas la
// peine d'en écrire un second.
export default function GestionRendezvous({ dossierId, codeStatutDossier, libelleStatutDossier, dernierSeulement = false }) {
  const { utilisateur, chargement: chargementSession } = useSession();

  // Formateur/Inspecteur (audit 2026-08-20, accès en lecture accordé à cette fiche via "Voir le
  // dossier" sur Suivi des tests, voir rendezvous.routes.js ROLES_LECTURE_RENDEZVOUS) : consultent
  // la liste ci-dessous mais ne voient jamais les actions de reprogrammation/désistement,
  // réservées à Accueil/Coordination/Recruteur/Admin (voir ROLES_GESTION_RENDEZVOUS côté back —
  // ces routes PATCH restent fermées pour ces deux rôles, ce masquage d'affichage évite un bouton
  // visible mais non fonctionnel).
  const peutGererRendezvous = ROLES_GESTION_RENDEZVOUS.includes(utilisateur?.roleCode);

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

  // Rafraîchissement automatique (audit 2026-08-24) : ne recharge que la liste des rendez-vous,
  // jamais les motifs (config statique, sans intérêt à repoller) ni `desistementEnCours`/
  // `motifChoisi` (le mini-formulaire de désistement en cours, état séparé ci-dessus).
  useRafraichissementAuto(chargerRendezvous);

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

  // Limité au premier élément seulement en mode dernierSeulement (voir son commentaire d'en-tête)
  // — la liste reçue est toujours triée avec le plus récent (par planification) en premier, ce
  // slice n'a donc besoin d'aucun tri supplémentaire ici.
  const rendezvousAffiches = dernierSeulement ? rendezvous.slice(0, 1) : rendezvous;

  return (
    // gestion-rendezvous--imbrique (dernierSeulement) neutralise la carte (bordure/ombre/fond
    // propres, voir GestionRendezvous.css) : Tests.jsx monte déjà ce composant À L'INTÉRIEUR de sa
    // propre carte .page-tests__rendezvous — sans ce modificateur, une seconde carte s'imbriquerait
    // dans la première (double bordure/ombre, largeur re-contrainte).
    <section className={dernierSeulement ? 'gestion-rendezvous gestion-rendezvous--imbrique' : 'gestion-rendezvous'}>
      {!dernierSeulement && <h2>Rendez-vous</h2>}

      {chargement && <p>Chargement des rendez-vous…</p>}
      {erreur && <p role="alert">{erreur}</p>}

      {!chargement && !erreur && rendezvousAffiches.length === 0 && (
        <p className="gestion-rendezvous__vide">Aucun rendez-vous pour ce dossier.</p>
      )}

      {!chargement && !erreur && rendezvousAffiches.length > 0 && (
        <ul className="gestion-rendezvous__liste">
          {rendezvousAffiches.map((rdv) => {
            const enDesistementPourCeRdv = desistementEnCours?.rendezvousId === rdv.id;
            const dossierEnEtatClos = STATUTS_DOSSIER_RENDEZVOUS_CLOS.includes(codeStatutDossier);
            const rdvEligiblePourAction = rdv.statut === 'prevu' || rdv.statut === 'confirme';
            const actionsDisponibles = peutGererRendezvous && rdvEligiblePourAction && !dossierEnEtatClos;
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
                    <span className="gestion-rendezvous__type">{TITRE_RENDEZVOUS}</span>
                    <StatutBadge libelle={libelleAffiche(rdv)} variante={varianteAffichee(rdv)} />
                    {rdv.motif_libelle && (
                      <span className="gestion-rendezvous__motif">Motif : {libelleMotifAffiche(rdv.motif_libelle)}</span>
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

                  {/* Dossier déjà passé à un statut incompatible avec une action sur CE
                      rendez-vous (voir STATUTS_DOSSIER_RENDEZVOUS_CLOS ci-dessus) — message
                      explicite plutôt que masquer silencieusement les 3 boutons, pour que l'agent
                      comprenne pourquoi ils ont disparu plutôt que de soupçonner un bug (audit
                      2026-08-20, dossier #84). Mêmes conditions d'affichage que le bloc actions
                      ci-dessus (peutGererRendezvous + rdv encore prevu/confirme), seul
                      dossierEnEtatClos change de valeur entre les deux blocs. */}
                  {peutGererRendezvous && rdvEligiblePourAction && dossierEnEtatClos && !enDesistementPourCeRdv && (
                    <p className="gestion-rendezvous__etat-clos">
                      Ce test est déjà clôturé ({libelleStatutDossier ?? codeStatutDossier}) : action sur ce rendez-vous
                      indisponible.
                    </p>
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
