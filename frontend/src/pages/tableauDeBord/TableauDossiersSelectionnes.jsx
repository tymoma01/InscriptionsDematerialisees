import { Link } from 'react-router-dom';
import StatutBadge from '../../core/workflow/StatutBadge';
import './TableauDossiersSelectionnes.css';

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

// Tableau consolidé du dashboard KPI (Indicateurs.jsx) : une ligne par dossier satisfaisant au
// moins un des indicateurs sélectionnés (cartes/segments cliqués). La déduplication (un dossier
// qui satisfait deux indicateurs à la fois n'apparaît qu'une fois) est déjà faite côté back
// (statistiquesService.listerDossiersParIndicateurs) — ce composant se contente d'afficher ce
// qu'il reçoit, aucune règle métier propre, même esprit que DossierList.jsx.
//
// Composant dédié plutôt qu'extension de DossierList (core/dossier/DossierList.jsx) : les
// colonnes diffèrent trop pour justifier d'alourdir un composant déjà utilisé tel quel par
// TableauDeBordAccueil.jsx/Backoffice.jsx (n° de dossier cliquable — absent de DossierList,
// qui n'affiche qu'un rang d'affichage —, badges d'indicateurs, dates clés qui varient selon
// l'indicateur plutôt qu'une seule "dernière mise à jour").
//
// `libelleIndicateur`/`varianteIndicateur`/`varianteStatut` : mêmes principes que
// `libellePoste`/`varianteStatut` dans DossierList.jsx — ce composant ne connaît aucun code
// métier propre à ACCECIT, uniquement des fonctions de traduction fournies par l'appelant.
export default function TableauDossiersSelectionnes({
  dossiers,
  libellePoste,
  libelleIndicateur,
  varianteIndicateur,
  varianteStatut,
}) {
  if (dossiers.length === 0) {
    return <p className="tableau-dossiers-selectionnes__vide">Aucun dossier pour cette sélection.</p>;
  }

  return (
    <div className="tableau-dossiers-selectionnes__scroll">
      <table className="tableau-dossiers-selectionnes">
        <thead>
          <tr>
            <th scope="col">N° dossier</th>
            <th scope="col">Candidat</th>
            <th scope="col">Poste</th>
            <th scope="col">Statut</th>
            <th scope="col">Indicateurs</th>
            <th scope="col">Dates clés</th>
          </tr>
        </thead>
        <tbody>
          {dossiers.map((dossier) => (
            <tr key={dossier.id}>
              <td>
                <Link to={`/recruteur/dossiers/${dossier.id}/validation`}>#{dossier.id}</Link>
              </td>
              <td>
                {dossier.candidat_prenom} {dossier.candidat_nom}
              </td>
              <td>
                <div className="tableau-dossiers-selectionnes__postes">
                  {[...dossier.postesBureau, ...dossier.postesHotel].map((code) => (
                    <span key={code} className="tableau-dossiers-selectionnes__badge-poste">
                      {libellePoste(code)}
                    </span>
                  ))}
                </div>
              </td>
              <td>
                <StatutBadge libelle={dossier.statut_libelle} variante={varianteStatut(dossier.statut_code)} />
              </td>
              <td>
                <div className="tableau-dossiers-selectionnes__indicateurs">
                  {dossier.indicateurs.map(({ code }) => (
                    <StatutBadge key={code} libelle={libelleIndicateur(code)} variante={varianteIndicateur(code)} />
                  ))}
                </div>
              </td>
              <td>
                <ul className="tableau-dossiers-selectionnes__dates">
                  {dossier.indicateurs.map(({ code, dateCle }) => (
                    <li key={code}>
                      {libelleIndicateur(code)} : {FORMAT_DATE.format(new Date(dateCle))}
                    </li>
                  ))}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
