import { useEffect, useMemo, useRef, useState } from 'react';
import StatutBadge from '../../core/workflow/StatutBadge';
import { listerHistoriqueRendezvousDossiers } from '../../services/rendezvousService';
import './PanneauHistoriqueRendezvous.css';

const FORMAT_DATE_HEURE = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

// Catégories produites par le back (voir backend/src/core/rendezvous/rendezvousService.js,
// CATEGORIES_STATUT_HISTORIQUE) — libellé + variante StatutBadge décidés ici, ce composant
// générique (StatutBadge) ne connaît aucun code métier (voir Modularité, CLAUDE.md).
const LIBELLES_STATUT_HISTORIQUE = {
  a_venir: 'À venir',
  honore: 'Honoré',
  manque: 'Manqué',
  annule: 'Annulé',
  replanifie: 'Replanifié',
  a_traiter: 'À traiter',
};
const VARIANTES_STATUT_HISTORIQUE = {
  a_venir: 'bleu',
  honore: 'succes',
  manque: 'echec',
  annule: 'echec-fort',
  replanifie: 'violet',
  a_traiter: 'alerte',
};

// Colonne "Notes/Motif" : les deux SEULES sources réellement rattachées à CE rendez-vous précis
// (voir backend/src/core/rendezvous/rendezvousRepository.js) — mutuellement exclusives en
// pratique (un motif n'existe que sur un rendez-vous 'absent'/'annule', un commentaire
// d'évaluation seulement s'il existe une évaluation liée, jamais les deux). Les notes de dossier
// (notes_dossier) ne sont PAS ici : sans colonne rendezvous_id, impossible de les rattacher à une
// ligne précise — affichées à part, une fois par candidat (voir notesParDossier plus bas, décision
// utilisateur du 2026-08-13).
function noteDuRendezvous(rdv) {
  return rdv.evaluation_commentaire || rdv.motif_libelle || null;
}

// Colonne "Créé par" : seule trace disponible de l'agent Accueil/Coordination à l'origine du
// rendez-vous, portée par journal_audit (pas par rendezvous lui-même, qui n'a aucune colonne
// auteur — voir rendezvousRepository.listerHistoriqueRendezvousParDossiers). cree_le reste NULL
// pour tout rendez-vous sans entrée journal_audit correspondante (créé avant la mise en place de
// cette traçabilité applicative, ou hors interface — ex. script de développement) : afficher "Non
// tracé" explicitement dans ce cas plutôt qu'une cellule vide, qui laisserait croire à une
// création anonyme alors que l'information est simplement absente.
function libelleCreation(rdv) {
  if (!rdv.cree_le) return null;
  const date = FORMAT_DATE_HEURE.format(new Date(rdv.cree_le));
  return rdv.cree_par_nom ? `Créé par ${rdv.cree_par_prenom} ${rdv.cree_par_nom} le ${date}` : `Créé le ${date} (agent non renseigné)`;
}

// Tronque un texte long pour la cellule "Notes/Motif" — le texte complet reste consultable via
// l'attribut title (tooltip natif au survol, même patron que CaptureTablette.jsx/
// CalendrierDisponibiliteFormateur.jsx), pas de composant tooltip dédié pour ce seul usage.
const LONGUEUR_TRONCATURE_NOTE = 80;
function tronquer(texte, longueurMax = LONGUEUR_TRONCATURE_NOTE) {
  if (texte.length <= longueurMax) return texte;
  return `${texte.slice(0, longueurMax).trimEnd()}…`;
}

// Panneau générique de consultation, extrait de Planification.jsx (bouton "Voir l'historique des
// rendez-vous sélectionnés") — même patron en flux (pas d'overlay/backdrop) que
// ModalePlanificationTest.jsx, pour rester sur le même écran sans perdre le contexte de la liste
// filtrée au-dessus. `dossierIds` figé à l'ouverture (tableau reçu tel quel en prop, jamais
// recalculé depuis la sélection courante) : cocher/décocher des candidats après ouverture du
// panneau ne doit pas faire disparaître silencieusement des lignes déjà affichées — l'agent doit
// fermer puis rouvrir pour rafraîchir sur une nouvelle sélection.
export default function PanneauHistoriqueRendezvous({ dossierIds, onFermer }) {
  const panneauRef = useRef(null);
  // { rendezvous, notes } — voir services/rendezvousService.js et backend/src/core/rendezvous/
  // rendezvousService.js : deux listes distinctes, `notes` n'étant rattachable à aucun
  // rendezvous_id précis (voir noteDuRendezvous ci-dessus pour ce qui EST rattaché à une ligne).
  const [historique, setHistorique] = useState({ rendezvous: [], notes: [] });
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);

  useEffect(() => {
    panneauRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  useEffect(() => {
    let annule = false;
    setChargement(true);
    setErreur(null);
    listerHistoriqueRendezvousDossiers(dossierIds)
      .then((valeur) => {
        if (!annule) setHistorique(valeur);
      })
      .catch((erreur) => {
        if (!annule) setErreur(erreur.response?.data?.erreur ?? "Impossible de récupérer l'historique des rendez-vous.");
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dossierIds figé à l'ouverture (voir
    // commentaire d'en-tête) : un tableau reçu en prop change de référence à chaque rendu du
    // parent même à contenu identique, le suivre déclencherait un refetch à chaque frappe/clic
    // sans rapport avec la sélection.
  }, []);

  // Un groupe par dossier (= un candidat), ses rendez-vous triés du plus récent au plus ancien —
  // la dernière tentative (celle qui compte le plus pour la décision en cours) en haut, la
  // première en bas (voir rendezvousRepository.listerHistoriqueRendezvousParDossiers côté back,
  // même ordre que le bloc "Notes du dossier" plus bas — décision utilisateur, 2026-08-14).
  const groupesParCandidat = useMemo(() => {
    const groupes = new Map();
    for (const rdv of historique.rendezvous) {
      if (!groupes.has(rdv.dossier_id)) {
        groupes.set(rdv.dossier_id, {
          dossierId: rdv.dossier_id,
          candidatNom: rdv.candidat_nom,
          candidatPrenom: rdv.candidat_prenom,
          rendezvous: [],
        });
      }
      groupes.get(rdv.dossier_id).rendezvous.push(rdv);
    }
    return [...groupes.values()].sort((a, b) => a.candidatNom.localeCompare(b.candidatNom));
  }, [historique.rendezvous]);

  // Notes de dossier (notes_dossier) indexées par dossier_id — affichées séparément des lignes de
  // rendez-vous (voir noteDuRendezvous, en tête de fichier, pour ce qui reste, lui, rattaché à une
  // ligne précise). Du plus récent au plus ancien (voir notesDossierRepository.
  // listerNotesParDossiers côté back, même ordre que la page dossier).
  const notesParDossier = useMemo(() => {
    const groupes = new Map();
    for (const note of historique.notes) {
      if (!groupes.has(note.dossier_id)) groupes.set(note.dossier_id, []);
      groupes.get(note.dossier_id).push(note);
    }
    return groupes;
  }, [historique.notes]);

  return (
    <div ref={panneauRef} className="panneau-historique-rendezvous" role="region" aria-label="Historique des rendez-vous sélectionnés">
      <div className="panneau-historique-rendezvous__entete">
        <h2>Historique des rendez-vous sélectionnés</h2>
        <button type="button" onClick={onFermer}>
          Fermer
        </button>
      </div>

      {chargement && <p>Chargement de l&rsquo;historique…</p>}
      {erreur && <p role="alert">{erreur}</p>}

      {!chargement && !erreur && groupesParCandidat.length === 0 && (
        <p className="panneau-historique-rendezvous__vide">Aucun rendez-vous de test trouvé pour la sélection.</p>
      )}

      {!chargement &&
        !erreur &&
        groupesParCandidat.map((groupe) => (
          <section key={groupe.dossierId} className="panneau-historique-rendezvous__candidat">
            <h3>
              {groupe.candidatPrenom} {groupe.candidatNom}
              <span className="panneau-historique-rendezvous__compteur">
                {groupe.rendezvous.length} tentative{groupe.rendezvous.length > 1 ? 's' : ''}
              </span>
            </h3>
            <table className="panneau-historique-rendezvous__table">
              <thead>
                <tr>
                  <th scope="col">Date et heure</th>
                  <th scope="col">Statut</th>
                  <th scope="col">Formateur / Inspecteur</th>
                  <th scope="col">Notes / Motif</th>
                  <th scope="col">Créé par</th>
                </tr>
              </thead>
              <tbody>
                {groupe.rendezvous.map((rdv) => {
                  const note = noteDuRendezvous(rdv);
                  const creation = libelleCreation(rdv);
                  return (
                    <tr key={rdv.id}>
                      <td>{FORMAT_DATE_HEURE.format(new Date(rdv.date_heure))}</td>
                      <td>
                        <StatutBadge
                          libelle={LIBELLES_STATUT_HISTORIQUE[rdv.statutCategorise] ?? rdv.statutCategorise}
                          variante={VARIANTES_STATUT_HISTORIQUE[rdv.statutCategorise]}
                        />
                      </td>
                      <td>{rdv.formateur_nom ? `${rdv.formateur_prenom} ${rdv.formateur_nom}` : '-'}</td>
                      {/* Rien si aucune note/motif (pas de "-" ni de cellule vide décorée, voir
                          décision produit) — title porte le texte complet pour un survol, la
                          cellule elle-même le texte tronqué s'il dépasse LONGUEUR_TRONCATURE_NOTE. */}
                      <td className="panneau-historique-rendezvous__cellule-note">
                        {note && <span title={note}>{tronquer(note)}</span>}
                      </td>
                      {/* "Non tracé" explicite (pas de "-"/cellule vide) quand journal_audit n'a
                          aucune entrée pour ce rendez-vous — voir libelleCreation ci-dessus : ne
                          jamais laisser croire à une création anonyme faute d'information. */}
                      <td className="panneau-historique-rendezvous__cellule-createur">
                        {creation ? (
                          creation
                        ) : (
                          <span
                            className="panneau-historique-rendezvous__non-trace"
                            title="Aucune entrée journal_audit pour ce rendez-vous (créé avant la mise en place de cette traçabilité, ou hors interface) : l'agent créateur ne peut pas être affiché de façon fiable."
                          >
                            Non tracé
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Notes du dossier (notes_dossier) — jamais rattachées à un rendez-vous précis (voir
                noteDuRendezvous en tête de fichier), affichées une seule fois par candidat plutôt
                que sous une ligne en particulier (décision utilisateur du 2026-08-13). Absentes
                du tout si le dossier n'en a aucune, pas de bloc vide. */}
            {notesParDossier.get(groupe.dossierId)?.length > 0 && (
              <div className="panneau-historique-rendezvous__notes-dossier">
                <h4>
                  Notes du dossier
                  <span className="panneau-historique-rendezvous__notes-dossier-precision">
                    (non rattachées à un rendez-vous précis)
                  </span>
                </h4>
                <ul>
                  {notesParDossier.get(groupe.dossierId).map((note) => (
                    <li key={note.id}>
                      <span className="panneau-historique-rendezvous__notes-dossier-meta">
                        {FORMAT_DATE_HEURE.format(new Date(note.date_creation))} — {note.auteur_prenom} {note.auteur_nom}
                      </span>
                      <p>{note.contenu}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        ))}
    </div>
  );
}
