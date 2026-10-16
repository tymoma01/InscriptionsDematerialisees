import { POSTES_BUREAU, POSTES_HOTEL, libelleEtAbreviationPoste } from '../referentiels/postes';
import './FiltreMetier.css';

const GROUPES_METIER = [
  { secteur: 'hotel', libelle: 'Hôtellerie', postes: POSTES_HOTEL },
  { secteur: 'bureau', libelle: 'Tertiaire', postes: POSTES_BUREAU },
];

// Filtre « Métier » de Dossiers candidats : exactement une ligne par secteur (Hôtellerie puis
// Tertiaire), chacune titrée de son secteur, avec une pastille par poste en toutes lettres suivies de
// l'abréviation des listes. Même comportement que les pastilles « Expérience » : un clic
// sélectionne, un second clic revient à tous les métiers. `secteurs` restreint les lignes
// affichées (l'Inspecteur Hôtellerie ne voit que l'hôtellerie). Composant d'affichage seul :
// filtrage dans filtrerDossiers.js, compteurs calculés par la page.
export default function FiltreMetier({ metierFiltre, onBasculerMetier, compteurs, secteurs = ['hotel', 'bureau'] }) {
  return (
    <div className="filtres-statut__statuts filtre-metier" role="group" aria-label="Filtrer par métier">
      <div className="filtre-metier__lignes">
        {GROUPES_METIER.filter((groupe) => secteurs.includes(groupe.secteur)).map((groupe) => (
          <div key={groupe.secteur} className="filtre-metier__groupe" data-secteur={groupe.secteur}>
            <span className="filtre-metier__secteur">{groupe.libelle}</span>
            {groupe.postes.map((code) => (
              <button
                key={code}
                type="button"
                className={metierFiltre === code ? 'actif' : ''}
                aria-pressed={metierFiltre === code}
                onClick={() => onBasculerMetier(code)}
              >
                {libelleEtAbreviationPoste(code)}
                <strong> ({compteurs[code] ?? 0})</strong>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
