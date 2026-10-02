import './FiltreEtudiant.css';

// Filtre « Étudiant » de Dossiers candidats (2026-10-02, remplace la colonne « Étudiant », décision
// de Florence) — une seule pastille, sous Hôtellerie/Tertiaire, sur toute la largeur du bloc comme
// « Tous » : un clic n'affiche que les étudiants, un second clic revient à la liste complète.
// Couleurs au repos : celles de BadgeEtudiant (« Étudiant », FiltreEtudiant.css) ; sélectionnée :
// même marquage que les pastilles de secteur (remplissage plein .actif de FiltresStatut.css).
// Composant d'affichage seul : filtrage et compteur dans core/dossier/filtrerDossiers.js.
export default function FiltreEtudiant({ actif, onBasculer, compteur }) {
  return (
    <div className="filtre-etudiant" role="group" aria-label="Filtrer les étudiants">
      <button type="button" className={actif ? 'actif' : ''} aria-pressed={actif} onClick={onBasculer}>
        Étudiant <strong>({compteur})</strong>
      </button>
    </div>
  );
}
