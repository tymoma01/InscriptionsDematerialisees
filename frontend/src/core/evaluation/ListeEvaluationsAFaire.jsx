import { useEffect, useMemo, useRef, useState } from 'react';
import StatutBadge from '../workflow/StatutBadge';
import { normaliserTexte } from '../filtres/normaliserTexte';
import { useParametreURL } from '../filtres/useParametreURL';
import FiltrePlageDate from '../filtres/FiltrePlageDate';
import { listerRendezvousAEvaluer, confirmerTestRealise } from '../../services/evaluationService';
import { appliquerTransition } from '../../services/transitionService';
import './ListeEvaluationsAFaire.css';

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

// Même mapping que Planification.jsx (Suivi des tests, GestionRendezvous.jsx) — dupliqué plutôt
// que partagé, même convention que le reste du projet (voir CLAUDE.md, conventions du projet).
// En pratique toujours 'prevu'/'confirme' ici (voir backend evaluationRepository.
// listerRendezvousAEvaluer, whereIn) : mapping complet gardé malgré tout, pour rester cohérent
// avec les autres pages si ce filtre serveur venait à changer.
// 'absent' affiché "Manqué" (pas "Absent") — audit 2026-08-20, cohérent avec Planification.jsx/
// GestionRendezvous.jsx (même correctif, affichage seul).
const LIBELLES_STATUT = { prevu: 'Prévu', confirme: 'Confirmé', absent: 'Manqué', annule: 'Annulé' };
function varianteStatutRendezvous(statut) {
  return statut === 'confirme' ? 'succes' : 'attente';
}

// Recherche élargie (nom/prénom du candidat, statut) — toutes les colonnes visibles de cette
// liste hormis la date (couverte par le filtre Du/Au dédié, jamais la recherche texte — même
// règle que Dossiers candidats/Suivi des tests/Historique des évaluations, audit 2026-08-20).
// Pas de poste ni de n° de dossier ici : cette liste n'affiche ni l'un ni l'autre (contrairement
// au tableau "Suivi des tests"), rien à y chercher qui ne soit déjà visible à l'écran.
function rechercheCorrespond(rdv, { motsRechercheNom, rechercheNormaliseeTexte }) {
  const nomComplet = normaliserTexte(`${rdv.candidat_prenom} ${rdv.candidat_nom}`.toLowerCase());
  const correspondNom = motsRechercheNom.every((mot) => nomComplet.includes(mot));
  const statut = normaliserTexte((LIBELLES_STATUT[rdv.statut] ?? rdv.statut ?? '').toLowerCase());
  const correspondStatut = statut.includes(rechercheNormaliseeTexte);
  return correspondNom || correspondStatut;
}

// Liste des rendez-vous de test assignés au formateur connecté et pas encore évalués (voir
// backend GET /api/evaluations/a-faire — déjà filtrée par formateur et par "pas déjà évalué",
// rien à filtrer ici). `rafraichir` : changer sa valeur force un rechargement (utilisé par
// Evaluation.jsx après une évaluation soumise). `onSelectionner` laisse à l'appelant la décision
// d'ouvrir la grille — ce composant ne connaît pas GrilleEvaluation.jsx. `rendezvousIdCible` : lu
// par Evaluation.jsx/pages/inspecteur/Evaluation.jsx (paramètre d'URL ?rendezvousId=..., voir le
// lien "Voir l'évaluation de ce candidat" de l'email formateur/inspecteur, formatageEmail.
// construireLienEvaluation) — surligne et scrolle jusqu'à la ligne correspondante ci-dessous. Reste
// géré ici (pas dans Evaluation.jsx) car c'est ce composant qui possède le DOM des lignes.
export default function ListeEvaluationsAFaire({ onSelectionner, rafraichir, rendezvousIdCible }) {
  const [rendezvous, setRendezvous] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);
  const [enCoursId, setEnCoursId] = useState(null);
  const [erreurAction, setErreurAction] = useState(null);

  // Ligne ciblée par rendezvousIdCible — même mécanisme que FormulaireUtilisateur
  // (pages/admin/Utilisateurs.jsx:349-352) : un ref posé sur le nœud DOM lui-même, scrollIntoView
  // dans un effet dédié plutôt qu'une requête DOM externe (document.querySelector).
  const ligneCibleRef = useRef(null);

  // Filtres persistés dans l'URL (query params), même mécanisme que Dossiers candidats/Suivi des
  // tests/Historique des évaluations — voir useParametreURL.js. S'appliquent en plus de la
  // restriction RBAC déjà posée côté serveur (listerRendezvousAEvaluer ne renvoie que les
  // rendez-vous du formateur/inspecteur connecté) : filtrage entièrement client sur une liste déjà
  // scopée, jamais une restriction en soi.
  const [recherche, setRecherche] = useParametreURL('q', '');
  const [dateDebutFiltre, setDateDebutFiltre] = useParametreURL('date_debut', '');
  const [dateFinFiltre, setDateFinFiltre] = useParametreURL('date_fin', '');

  useEffect(() => {
    let annule = false;
    setChargement(true);
    setErreur(null);
    listerRendezvousAEvaluer()
      .then((valeur) => {
        if (!annule) setRendezvous(valeur);
      })
      .catch((erreur) => {
        if (!annule) setErreur(erreur.response?.data?.erreur ?? 'Impossible de récupérer les évaluations à faire.');
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, [rafraichir]);

  // Filtrage client (recherche + plage de date sur date_heure) sur la liste déjà reçue — même
  // bornage en heure locale que filtrerDossiers.js/Planification.jsx (dateDebutFiltre/
  // dateFinFiltre viennent d'un <input type="date">, jours calendaires tels que l'agent les lit,
  // pas des instants UTC).
  const rendezvousFiltres = useMemo(() => {
    const rechercheNormalisee = recherche.trim().toLowerCase();
    const rechercheNormaliseeTexte = normaliserTexte(rechercheNormalisee);
    const motsRechercheNom = rechercheNormalisee.split(/\s+/).filter(Boolean).map(normaliserTexte);
    const debut = dateDebutFiltre ? new Date(`${dateDebutFiltre}T00:00:00`) : null;
    const fin = dateFinFiltre ? new Date(`${dateFinFiltre}T23:59:59.999`) : null;
    return rendezvous.filter((rdv) => {
      if (debut || fin) {
        const dateRdv = new Date(rdv.date_heure);
        if (debut && dateRdv < debut) return false;
        if (fin && dateRdv > fin) return false;
      }
      if (motsRechercheNom.length === 0) return true;
      return rechercheCorrespond(rdv, { motsRechercheNom, rechercheNormaliseeTexte });
    });
  }, [rendezvous, recherche, dateDebutFiltre, dateFinFiltre]);

  // Scroll jusqu'à la ligne ciblée une fois la liste rendue (rendezvousFiltres en dépendance : le
  // ref n'est posé sur le bon <li> qu'après ce rendu-là). Silencieux si rendezvousIdCible ne
  // correspond à aucune ligne (déjà évalué entre-temps, ou exclu par un filtre recherche/date
  // actif) — ligneCibleRef.current reste alors null, scrollIntoView n'est simplement pas appelé.
  useEffect(() => {
    if (!rendezvousIdCible) return;
    ligneCibleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [rendezvousIdCible, rendezvousFiltres]);

  // Aucune grille associée (contrairement à "Évaluer" — voir GrilleEvaluation.jsx) : une seule
  // transition (voir workflowEngine.appliquerTransition), commentaire auto-généré comme le fait
  // déjà CaptureTablette.jsx pour "Planifier un test", pas de formulaire à ouvrir pour si peu.
  // Retrait local de la liste au succès : GET /evaluations/a-faire filtre déjà par dossier au
  // statut test_planifie (voir evaluationRepository.listerRendezvousAEvaluer), donc ce rendez-vous
  // ne réapparaîtrait de toute façon plus après un rechargement complet.
  const marquerNonRealise = async (rdv) => {
    setEnCoursId(rdv.id);
    setErreurAction(null);
    try {
      await appliquerTransition(rdv.dossier_id, {
        codeAction: 'test_non_realise',
        commentaire: `Test non réalisé le ${FORMAT_DATE.format(new Date(rdv.date_heure))}.`,
        // Ferme aussi le rendez-vous lui-même (audit 2026-08-20, dossier #84) : sans ça, ce bouton
        // ne faisait avancer que le statut du dossier, laissant le rendez-vous affiché "Prévu"
        // avec Confirmer la présence/Marquer absent/Marquer annulé toujours actifs sur la fiche
        // dossier — même correctif que la bascule automatique (voir
        // backend/src/core/rendezvous/basculeTestNonRealiseService.js). 'test_non_realise' est ici
        // le code du motif de désistement dédié (scripts/seedMotifsDesistement.js), pas le
        // codeAction ci-dessus — coïncidence de nommage, deux vocabulaires distincts (motifs vs
        // transitions_statut).
        rendezvousId: rdv.id,
        statutRendezvous: 'absent',
        motifCodeRendezvous: 'test_non_realise',
      });
      setRendezvous((precedent) => precedent.filter((r) => r.id !== rdv.id));
    } catch (erreur) {
      setErreurAction(
        erreur.response
          ? (erreur.response.data?.erreur ?? "Impossible d'enregistrer ce test comme non réalisé. Merci de réessayer.")
          : 'Connexion au serveur impossible. Vérifiez le réseau et réessayez.',
      );
    } finally {
      setEnCoursId(null);
    }
  };

  // "Confirmer que le test a eu lieu" (workflow v5, audit 2026-08-21) : fait passer le dossier de
  // test_planifie à test_realise — voir evaluationEngine.confirmerTestRealise côté back,
  // l'assignation au rendez-vous précis y est revérifiée, pas seulement supposée parce que la ligne
  // vient déjà de cette liste scopée au formateur connecté. Contrairement à marquerNonRealise
  // ci-dessus, la ligne n'est pas retirée au succès : le rendez-vous reste "à faire" (GET
  // /evaluations/a-faire renvoie aussi test_realise, voir evaluationRepository.
  // listerRendezvousAEvaluer) — seul dossier_statut_code change localement, ce qui bascule
  // l'affichage des boutons ci-dessous vers "Évaluer" sans attendre un rechargement complet.
  const confirmerRealise = async (rdv) => {
    setEnCoursId(rdv.id);
    setErreurAction(null);
    try {
      await confirmerTestRealise(rdv.id);
      setRendezvous((precedent) =>
        precedent.map((r) => (r.id === rdv.id ? { ...r, dossier_statut_code: 'test_realise' } : r)),
      );
    } catch (erreur) {
      setErreurAction(
        erreur.response
          ? (erreur.response.data?.erreur ?? "Impossible de confirmer que ce test a eu lieu. Merci de réessayer.")
          : 'Connexion au serveur impossible. Vérifiez le réseau et réessayez.',
      );
    } finally {
      setEnCoursId(null);
    }
  };

  if (chargement) {
    return <p>Chargement…</p>;
  }
  if (erreur) {
    return <p role="alert">{erreur}</p>;
  }
  if (rendezvous.length === 0) {
    return <p className="liste-evaluations__vide">Aucune évaluation à faire pour l’instant.</p>;
  }

  return (
    <>
      <div className="liste-evaluations__filtres">
        <label className="liste-evaluations__filtre-recherche">
          <span>Rechercher</span>
          <input
            type="search"
            value={recherche}
            onChange={(evenement) => setRecherche(evenement.target.value)}
            placeholder="Nom, prénom ou statut"
          />
        </label>

        {/* Même composant que Dossiers candidats/Suivi des tests/Historique des évaluations (voir
            FiltrePlageDate.jsx) — filtre ici sur rdv.date_heure (date/heure du test). */}
        <FiltrePlageDate
          dateDebutFiltre={dateDebutFiltre}
          onChangerDateDebutFiltre={setDateDebutFiltre}
          dateFinFiltre={dateFinFiltre}
          onChangerDateFinFiltre={setDateFinFiltre}
        />
      </div>

      {erreurAction && <p role="alert">{erreurAction}</p>}

      {rendezvousFiltres.length === 0 ? (
        <p className="liste-evaluations__vide">Aucune évaluation ne correspond aux critères actuels.</p>
      ) : (
        <ul className="liste-evaluations">
          {rendezvousFiltres.map((rdv) => {
            const estCible = rendezvousIdCible && String(rdv.id) === String(rendezvousIdCible);
            return (
            <li
              key={rdv.id}
              ref={estCible ? ligneCibleRef : null}
              className={`liste-evaluations__item${estCible ? ' liste-evaluations__item--cible' : ''}`}
            >
              <span className="liste-evaluations__candidat">
                {rdv.candidat_prenom} {rdv.candidat_nom}
              </span>
              <span className="liste-evaluations__date">{FORMAT_DATE.format(new Date(rdv.date_heure))}</span>
              <StatutBadge libelle={LIBELLES_STATUT[rdv.statut] ?? rdv.statut} variante={varianteStatutRendezvous(rdv.statut)} />
              {/* Grille d'évaluation accessible seulement une fois le test confirmé réalisé
                  (workflow v5, audit 2026-08-21) — tant que le dossier est encore test_planifie,
                  "Test non réalisé" (désistement) et "Confirmer que le test a eu lieu" restent les
                  deux seules issues possibles ; passé test_realise (confirmé par le formateur/
                  inspecteur assigné, voir confirmerRealise ci-dessus), plus de retour en arrière
                  possible depuis cet écran — "Évaluer" seul reste pertinent. */}
              {rdv.dossier_statut_code === 'test_realise' ? (
                <button type="button" disabled={enCoursId === rdv.id} onClick={() => onSelectionner(rdv)}>
                  Évaluer
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="liste-evaluations__bouton-secondaire"
                    disabled={enCoursId === rdv.id}
                    onClick={() => marquerNonRealise(rdv)}
                  >
                    {enCoursId === rdv.id ? 'Enregistrement...' : 'Test non réalisé'}
                  </button>
                  <button type="button" disabled={enCoursId === rdv.id} onClick={() => confirmerRealise(rdv)}>
                    {enCoursId === rdv.id ? 'Enregistrement...' : 'Confirmer que le test a eu lieu'}
                  </button>
                </>
              )}
            </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
