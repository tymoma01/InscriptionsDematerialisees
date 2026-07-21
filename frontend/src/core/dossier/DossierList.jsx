import StatutBadge from '../workflow/StatutBadge';
import './DossierList.css';

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

// Liste générique de dossiers : ne connaît aucun statut ni règle métier propre à une entité
// (voir Modularité, CLAUDE.md) — reçoit les dossiers déjà chargés (champs bruts renvoyés par
// GET /api/dossiers, voir services/dossierService.js), une fonction de variante de statut et une
// liste d'actions par ligne, comme FormulaireInscription reçoit ses blocs actifs plutôt que de
// les connaître.
// `varianteStatut` et `actions` restent optionnels : sans eux, la liste reste utilisable en
// lecture seule avec des badges neutres. `actions` : [{ libelle, onSelectionner(dossier) }].
export default function DossierList({ dossiers, varianteStatut, actions = [] }) {
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
            <th scope="col">Candidat</th>
            <th scope="col">Statut</th>
            <th scope="col">Dernière mise à jour</th>
            {actions.length > 0 && <th scope="col"></th>}
          </tr>
        </thead>
        <tbody>
          {dossiers.map((dossier) => (
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
                <td className="dossier-list__actions">
                  {actions.map((action) => (
                    <button key={action.libelle} type="button" onClick={() => action.onSelectionner(dossier)}>
                      {action.libelle}
                    </button>
                  ))}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
