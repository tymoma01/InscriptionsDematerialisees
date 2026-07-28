import { useMemo, useState } from 'react';
import StatutBadge from '../workflow/StatutBadge';
import './DossierList.css';

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

// Une entrée par colonne triable, dans l'ordre d'affichage des <th> — `cle` sert à la fois
// d'identifiant de tri et de clé de comparaison. "Candidat" trie sur candidats.nom (nom de
// famille), pas sur la chaîne "prénom nom" affichée : la colonne affiche les deux mais le tri ne
// doit dépendre que du nom de famille, seul champ stable pour classer un annuaire.
const COLONNES = [
  { cle: 'candidat_nom', libelle: 'Candidat', extraire: (dossier) => (dossier.candidat_nom ?? '').toLowerCase() },
  { cle: 'statut_libelle', libelle: 'Statut', extraire: (dossier) => (dossier.statut_libelle ?? '').toLowerCase() },
  { cle: 'date_maj', libelle: 'Dernière mise à jour', extraire: (dossier) => new Date(dossier.date_maj).getTime() },
];

// Liste générique de dossiers : ne connaît aucun statut ni règle métier propre à une entité
// (voir Modularité, CLAUDE.md) — reçoit les dossiers déjà chargés (champs bruts renvoyés par
// GET /api/dossiers, voir services/dossierService.js), une fonction de variante de statut et une
// liste d'actions par ligne, comme FormulaireInscription reçoit ses blocs actifs plutôt que de
// les connaître.
// `varianteStatut` et `actions` restent optionnels : sans eux, la liste reste utilisable en
// lecture seule avec des badges neutres. `actions` : [{ libelle, onSelectionner(dossier),
// visible?(dossier) }] — `visible` optionnel (défaut : toujours affichée), pour des actions qui
// ne concernent que certains statuts (ex. "Replanifier" sur TableauDeBordAccueil.jsx, réservé aux
// dossiers en test_non_realise/verdict_negatif) sans que ce composant générique ait besoin de
// connaître ces codes de statut lui-même.
//
// Tri entièrement client, sur la liste déjà reçue (déjà filtrée par statut/recherche/date par
// l'appelant, voir TableauDeBordAccueil.jsx/Backoffice.jsx) : ni l'une ni l'autre des deux pages
// qui utilisent ce composant ne pagine côté serveur, un paramètre de tri sur GET /api/dossiers
// ferait un aller-retour réseau pour un travail que le navigateur fait déjà instantanément sur
// quelques dizaines/centaines de lignes. Défaut = dernière mise à jour décroissante (comportement
// historique du composant), préservé tant qu'aucun en-tête n'a été cliqué.
export default function DossierList({ dossiers, varianteStatut, actions = [] }) {
  const [tri, setTri] = useState({ colonne: 'date_maj', ordre: 'desc' });

  const dossiersTries = useMemo(() => {
    const colonneTri = COLONNES.find((colonne) => colonne.cle === tri.colonne);
    const copie = [...dossiers];
    copie.sort((a, b) => {
      const valeurA = colonneTri.extraire(a);
      const valeurB = colonneTri.extraire(b);
      if (valeurA < valeurB) return tri.ordre === 'asc' ? -1 : 1;
      if (valeurA > valeurB) return tri.ordre === 'asc' ? 1 : -1;
      return 0;
    });
    return copie;
  }, [dossiers, tri]);

  // Reclique sur la colonne déjà active : inverse l'ordre. Nouvelle colonne : "Dernière mise à
  // jour" repart décroissant (le plus récent en premier reste le repère le plus utile), les
  // colonnes textuelles repartent croissant (ordre alphabétique naturel).
  const trierPar = (colonne) => {
    setTri((precedent) => {
      if (precedent.colonne === colonne) {
        return { colonne, ordre: precedent.ordre === 'asc' ? 'desc' : 'asc' };
      }
      return { colonne, ordre: colonne === 'date_maj' ? 'desc' : 'asc' };
    });
  };

  if (dossiers.length === 0) {
    return <p className="dossier-list__vide">Aucun dossier.</p>;
  }

  return (
    // Conteneur dédié au défilement horizontal : un <table> ne rétrécit jamais sous la largeur
    // naturelle de son contenu (ici, quatre colonnes dont deux boutons d'action) — sans ce
    // conteneur, dépasser cette largeur pousserait toute la page en scroll horizontal sur un
    // écran étroit (tablette en portrait), pas seulement le tableau.
    <div className="dossier-list__scroll">
      <table className="dossier-list">
        <thead>
          <tr>
            {COLONNES.map((colonne) => {
              const actif = tri.colonne === colonne.cle;
              return (
                <th key={colonne.cle} scope="col" aria-sort={actif ? (tri.ordre === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" className="dossier-list__entete-tri" onClick={() => trierPar(colonne.cle)}>
                    {colonne.libelle}
                    <span className="dossier-list__indicateur-tri" aria-hidden="true">
                      {actif ? (tri.ordre === 'asc' ? '▲' : '▼') : ''}
                    </span>
                  </button>
                </th>
              );
            })}
            {actions.length > 0 && <th scope="col"></th>}
          </tr>
        </thead>
        <tbody>
          {dossiersTries.map((dossier) => (
            <tr key={dossier.id}>
              <td>
                {dossier.candidat_prenom} {dossier.candidat_nom}
              </td>
              <td>
                <StatutBadge
                  libelle={dossier.statut_libelle}
                  variante={varianteStatut ? varianteStatut(dossier.statut_code) : 'neutre'}
                />
              </td>
              <td>{FORMAT_DATE.format(new Date(dossier.date_maj))}</td>
              {actions.length > 0 && (
                <td>
                  {/* display: flex sur un <div> interne plutôt que directement sur le <td> :
                      posé sur la cellule elle-même, ça lui ferait perdre son display: table-cell
                      (donc son étirement/centrage vertical automatique sur la hauteur de la
                      ligne) — décalage visible dès qu'une autre cellule de la même ligne est plus
                      haute (ex. nom de candidat sur deux lignes). */}
                  <div className="dossier-list__actions">
                    {actions
                      .filter((action) => !action.visible || action.visible(dossier))
                      .map((action) => (
                        <button key={action.libelle} type="button" onClick={() => action.onSelectionner(dossier)}>
                          {action.libelle}
                        </button>
                      ))}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
