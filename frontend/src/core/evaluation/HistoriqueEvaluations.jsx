import { useEffect, useMemo, useState } from 'react';
import StatutBadge from '../workflow/StatutBadge';
import { normaliserTexte } from '../filtres/normaliserTexte';
import { useParametreURL } from '../filtres/useParametreURL';
import FiltrePlageDate from '../filtres/FiltrePlageDate';
import { listerHistoriqueEvaluations } from '../../services/evaluationService';
import './HistoriqueEvaluations.css';

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

// Libellés des postes hôtel — mêmes codes/libellés que BlocDisponibilites.jsx (POSTES_HOTEL) et
// GrilleEvaluation.jsx (POSTE_HOTEL_LIBELLES), dupliqués ici plutôt que partagés : quelques
// lignes de données, même choix déjà fait ailleurs dans le projet (voir VARIANTE_PAR_CODE_ACCECIT,
// TableauDeBordAccueil.jsx/Backoffice.jsx).
const POSTE_HOTEL_LIBELLES = {
  femme_valet_chambre: 'Femme/Valet de chambre',
  cafetier: 'Cafétier(ère)',
  equipier: 'Équipier(ère)',
  gouvernant: 'Gouvernant(e)',
};
const POSTE_BUREAU_LIBELLES = {
  nettoyage: 'Nettoyage',
  vitrerie: 'Vitrerie',
  machiniste: 'Machiniste',
  chef_equipe: "Chef d'équipe",
  autres: 'Autres',
};

// postes_codes : plusieurs postes peuvent avoir été évalués dans une même évaluation (blocs
// empilés, voir GrilleEvaluation.jsx / backend evaluationEngine.enregistrerEvaluation) — tableau
// vide/absent = repli sur le questionnaire générique (poste hôtel/bureau sans questionnaire dédié,
// ou dossier créé avant l'ajout des questionnaires bureau), voir backend evaluationEngine.js,
// trouverQuestionnairePourPoste. Un dossier bureau évalué par un Inspecteur a désormais un poste
// résolu comme un dossier hôtel (voir GrilleEvaluation.jsx, postesCandidats) : le libellé
// "Générique" ne concerne donc plus que ce vrai cas de repli, pas systématiquement le bureau.
function libellePostes(postesCodes) {
  if (!postesCodes || postesCodes.length === 0) return 'Générique';
  return postesCodes.map((posteCode) => POSTE_HOTEL_LIBELLES[posteCode] ?? POSTE_BUREAU_LIBELLES[posteCode] ?? posteCode).join(', ');
}

// Recherche élargie (nom/prénom du candidat, n° de dossier, poste(s) évalué(s), résultat) — même
// principe que Dossiers candidats/Suivi des tests (filtrerDossiers.js/Planification.jsx) : toutes
// les colonnes visibles du tableau (audit 2026-08-20), jamais seulement un sous-ensemble. Nom/
// prénom comparés mot par mot, insensible à l'ordre de saisie ; poste/résultat comparés par simple
// inclusion sur le libellé AFFICHÉ (libelleResultat, défini plus bas — function déclarée, donc
// disponible ici malgré l'ordre du fichier), jamais resultat_global/orientation bruts : un agent
// tape "invalidé" ou "prêt à l'embauche", pas les codes internes 'invalide'/'pret_embauche'.
// Dupliqué plutôt que partagé : `evaluation` n'a pas la même forme qu'un `dossier`/`rdv`, et cette
// page n'a ni téléphone ni email à chercher. Une saisie numérique courte ("91") ne vise QUE le n°
// de dossier, en égalité stricte — même correctif qu'ailleurs (audit 2026-08-19) : une simple
// inclusion remonterait aussi "191"/"912"/etc. Pas de cas "saisie numérique longue" à gérer ici
// (contrairement à filtrerDossiers.js/Planification.jsx) : cette page n'a aucun champ téléphone,
// une telle saisie ne matche donc simplement rien (repli naturel sur nom/poste/résultat ci-dessous,
// tous non numériques).
function rechercheCorrespond(evaluation, { motsRechercheNom, rechercheNormaliseeTexte, rechercheChiffresSeuls, rechercheEstNumeroDossier }) {
  if (rechercheEstNumeroDossier) {
    return String(evaluation.dossier_id) === rechercheChiffresSeuls;
  }
  const nomComplet = normaliserTexte(`${evaluation.candidat_prenom} ${evaluation.candidat_nom}`.toLowerCase());
  const correspondNom = motsRechercheNom.every((mot) => nomComplet.includes(mot));
  const postes = normaliserTexte(libellePostes(evaluation.postes_codes).toLowerCase());
  const correspondPoste = postes.includes(rechercheNormaliseeTexte);
  const resultat = normaliserTexte(libelleResultat(evaluation).toLowerCase());
  const correspondResultat = resultat.includes(rechercheNormaliseeTexte);
  return correspondNom || correspondPoste || correspondResultat;
}

// Combine resultat_global + orientation en un seul libellé — mêmes formulations que
// workflow.config.json (statuts valide_envoi_formation/valide_pret_embauche/invalide), pour rester
// cohérent avec le vocabulaire déjà utilisé ailleurs dans le back-office (TableauDeBordAccueil.jsx/
// Backoffice.jsx, VARIANTE_PAR_CODE_ACCECIT). Un verdict positif d'Inspecteur (bureau) a
// orientation=NULL (pas de notion de formation, voir backend evaluationEngine.js) — repli sur
// "prêt à l'embauche" plutôt que "envoyé en formation" dans ce cas : le bureau réutilise
// exactement le statut valide_pret_embauche, jamais valide_envoi_formation (voir
// CODE_ACTION_VALIDE_BUREAU côté back).
function libelleResultat(evaluation) {
  if (evaluation.resultat_global === 'invalide') return 'Invalidé';
  if (evaluation.orientation === 'envoi_formation') return 'Validé - envoyé en formation';
  return 'Validé - prêt à l\'embauche';
}

function varianteResultat(evaluation) {
  if (evaluation.resultat_global === 'invalide') return 'echec';
  return evaluation.orientation === 'envoi_formation' ? 'succes' : 'vert-clair';
}

// Une entrée par colonne triable, même patron que DossierList.jsx/Utilisateurs.jsx/
// Planification.jsx. "Candidat" trie sur le nom de famille, pas la chaîne "prénom nom" affichée.
const COLONNES = [
  { cle: 'candidat_nom', libelle: 'Candidat', extraire: (e) => (e.candidat_nom ?? '').toLowerCase() },
  { cle: 'postes_codes', libelle: 'Poste(s) évalué(s)', extraire: (e) => libellePostes(e.postes_codes).toLowerCase() },
  { cle: 'date_evaluation', libelle: 'Date du test', extraire: (e) => new Date(e.date_evaluation).getTime() },
  { cle: 'resultat_global', libelle: 'Résultat', extraire: (e) => libelleResultat(e).toLowerCase() },
];

// Historique des évaluations déjà soumises par le formateur connecté (jamais tous formateurs
// confondus, voir backend evaluationEngine.listerHistorique) — un même candidat peut apparaître
// plusieurs fois si repassé un test (postes_codes distincts par ligne d'évaluation, une évaluation
// pouvant elle-même couvrir plusieurs postes empilés), volontairement pas dédupliqué.
// `onSelectionner` laisse à l'appelant la décision d'ouvrir le détail — ce composant ne connaît pas
// DetailEvaluation.jsx, même patron que ListeEvaluationsAFaire.jsx.
export default function HistoriqueEvaluations({ onSelectionner }) {
  const [evaluations, setEvaluations] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);
  const [tri, setTri] = useState({ colonne: 'date_evaluation', ordre: 'desc' });

  // Filtres persistés dans l'URL (query params), même mécanisme que Dossiers candidats/Suivi des
  // tests — voir useParametreURL.js. S'appliquent en plus de la restriction RBAC déjà posée côté
  // serveur (listerHistoriqueEvaluations ne renvoie que les évaluations du formateur/inspecteur
  // connecté, voir son commentaire d'en-tête) : filtrage entièrement client sur une liste déjà
  // scopée, jamais une restriction en soi.
  const [recherche, setRecherche] = useParametreURL('q', '');
  const [dateDebutFiltre, setDateDebutFiltre] = useParametreURL('date_debut', '');
  const [dateFinFiltre, setDateFinFiltre] = useParametreURL('date_fin', '');

  useEffect(() => {
    let annule = false;
    setChargement(true);
    setErreur(null);
    listerHistoriqueEvaluations()
      .then((valeur) => {
        if (!annule) setEvaluations(valeur);
      })
      .catch((erreur) => {
        if (!annule) setErreur(erreur.response?.data?.erreur ?? "Impossible de récupérer l'historique des évaluations.");
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, []);

  // Filtrage client (recherche + plage de date sur date_evaluation) sur la liste déjà reçue —
  // même bornage en heure locale que filtrerDossiers.js/Planification.jsx (dateDebutFiltre/
  // dateFinFiltre viennent d'un <input type="date">, jours calendaires tels que l'agent les lit,
  // pas des instants UTC).
  const evaluationsFiltrees = useMemo(() => {
    const rechercheNormalisee = recherche.trim().toLowerCase();
    const rechercheNormaliseeTexte = normaliserTexte(rechercheNormalisee);
    const motsRechercheNom = rechercheNormalisee.split(/\s+/).filter(Boolean).map(normaliserTexte);
    const rechercheChiffresSeuls = rechercheNormalisee.replace(/[\s-]/g, '');
    const rechercheEstNumeroDossier = rechercheChiffresSeuls.length > 0 && /^\d+$/.test(rechercheChiffresSeuls);
    const debut = dateDebutFiltre ? new Date(`${dateDebutFiltre}T00:00:00`) : null;
    const fin = dateFinFiltre ? new Date(`${dateFinFiltre}T23:59:59.999`) : null;
    return evaluations.filter((evaluation) => {
      if (debut || fin) {
        const dateEvaluation = new Date(evaluation.date_evaluation);
        if (debut && dateEvaluation < debut) return false;
        if (fin && dateEvaluation > fin) return false;
      }
      if (motsRechercheNom.length === 0) return true;
      return rechercheCorrespond(evaluation, {
        motsRechercheNom,
        rechercheNormaliseeTexte,
        rechercheChiffresSeuls,
        rechercheEstNumeroDossier,
      });
    });
  }, [evaluations, recherche, dateDebutFiltre, dateFinFiltre]);

  const evaluationsTriees = useMemo(() => {
    const colonneTri = COLONNES.find((colonne) => colonne.cle === tri.colonne);
    const copie = [...evaluationsFiltrees];
    copie.sort((a, b) => {
      const valeurA = colonneTri.extraire(a);
      const valeurB = colonneTri.extraire(b);
      if (valeurA < valeurB) return tri.ordre === 'asc' ? -1 : 1;
      if (valeurA > valeurB) return tri.ordre === 'asc' ? 1 : -1;
      return 0;
    });
    return copie;
  }, [evaluationsFiltrees, tri]);

  // Reclique sur la colonne déjà active : inverse l'ordre. Nouvelle colonne : "Date du test"
  // repart décroissant (l'évaluation la plus récente en premier reste le repère le plus utile
  // pour un historique), les colonnes textuelles repartent croissant — même patron que
  // DossierList.jsx.
  const trierPar = (colonne) => {
    setTri((precedent) => {
      if (precedent.colonne === colonne) {
        return { colonne, ordre: precedent.ordre === 'asc' ? 'desc' : 'asc' };
      }
      return { colonne, ordre: colonne === 'date_evaluation' ? 'desc' : 'asc' };
    });
  };

  if (chargement) {
    return <p>Chargement de l’historique…</p>;
  }
  if (erreur) {
    return <p role="alert">{erreur}</p>;
  }
  if (evaluations.length === 0) {
    return <p className="historique-evaluations__vide">Aucune évaluation soumise pour l’instant.</p>;
  }

  return (
    <>
      <div className="historique-evaluations__filtres">
        <label className="historique-evaluations__filtre-recherche">
          <span>Rechercher</span>
          <input
            type="search"
            value={recherche}
            onChange={(evenement) => setRecherche(evenement.target.value)}
            placeholder="Nom, prénom, N° dossier, poste ou résultat"
          />
        </label>

        {/* Même composant que Dossiers candidats/Suivi des tests (voir FiltrePlageDate.jsx) —
            filtre ici sur date_evaluation ("Date du test") plutôt que la date de dernière mise à
            jour du dossier ou du rendez-vous. */}
        <FiltrePlageDate
          dateDebutFiltre={dateDebutFiltre}
          onChangerDateDebutFiltre={setDateDebutFiltre}
          dateFinFiltre={dateFinFiltre}
          onChangerDateFinFiltre={setDateFinFiltre}
        />
      </div>

      {evaluationsTriees.length === 0 ? (
        <p className="historique-evaluations__vide">Aucune évaluation ne correspond aux critères actuels.</p>
      ) : (
        <div className="historique-evaluations__scroll">
          <table className="historique-evaluations">
            <thead>
              <tr>
                {/* N° de dossier = evaluation.dossier_id, même principe que Dossiers candidats/
                    Suivi des tests (identifiant métier plutôt qu'un simple rang d'affichage). */}
                <th scope="col">N°</th>
                {COLONNES.map((colonne) => {
                  const actif = tri.colonne === colonne.cle;
                  return (
                    <th key={colonne.cle} scope="col" aria-sort={actif ? (tri.ordre === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <button type="button" className="historique-evaluations__entete-tri" onClick={() => trierPar(colonne.cle)}>
                        {colonne.libelle}
                        <span className="historique-evaluations__indicateur-tri" aria-hidden="true">
                          {actif ? (tri.ordre === 'asc' ? '▲' : '▼') : ''}
                        </span>
                      </button>
                    </th>
                  );
                })}
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {evaluationsTriees.map((evaluation) => (
                <tr key={evaluation.id}>
                  <td>{evaluation.dossier_id}</td>
                  <td>
                    {evaluation.candidat_prenom} {evaluation.candidat_nom}
                  </td>
                  <td>{libellePostes(evaluation.postes_codes)}</td>
                  <td>{FORMAT_DATE.format(new Date(evaluation.date_evaluation))}</td>
                  <td>
                    <StatutBadge libelle={libelleResultat(evaluation)} variante={varianteResultat(evaluation)} />
                  </td>
                  <td>
                    <div className="historique-evaluations__actions">
                      <button
                        type="button"
                        className="historique-evaluations__action-detail"
                        onClick={() => onSelectionner(evaluation)}
                      >
                        Voir le détail
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
