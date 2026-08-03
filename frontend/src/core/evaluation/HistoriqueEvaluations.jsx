import { useEffect, useMemo, useState } from 'react';
import StatutBadge from '../workflow/StatutBadge';
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
  if (evaluation.orientation === 'envoi_formation') return 'Validé — envoyé en formation';
  return 'Validé — prêt à l\'embauche';
}

function varianteResultat(evaluation) {
  return evaluation.resultat_global === 'invalide' ? 'echec' : 'succes';
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

  const evaluationsTriees = useMemo(() => {
    const colonneTri = COLONNES.find((colonne) => colonne.cle === tri.colonne);
    const copie = [...evaluations];
    copie.sort((a, b) => {
      const valeurA = colonneTri.extraire(a);
      const valeurB = colonneTri.extraire(b);
      if (valeurA < valeurB) return tri.ordre === 'asc' ? -1 : 1;
      if (valeurA > valeurB) return tri.ordre === 'asc' ? 1 : -1;
      return 0;
    });
    return copie;
  }, [evaluations, tri]);

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
    <div className="historique-evaluations__scroll">
      <table className="historique-evaluations">
        <thead>
          <tr>
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
              <td>
                {evaluation.candidat_prenom} {evaluation.candidat_nom}
              </td>
              <td>{libellePostes(evaluation.postes_codes)}</td>
              <td>{FORMAT_DATE.format(new Date(evaluation.date_evaluation))}</td>
              <td>
                <StatutBadge libelle={libelleResultat(evaluation)} variante={varianteResultat(evaluation)} />
              </td>
              <td>
                <button type="button" onClick={() => onSelectionner(evaluation)}>
                  Voir le détail
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
