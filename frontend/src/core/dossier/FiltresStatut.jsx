import './FiltresStatut.css';

// Barre de filtres générique à choix unique ("Tous" + un bouton par option) — au départ dédiée
// au statut des dossiers (tableau de bord Accueil, back-office Recruteur), réutilisée telle
// quelle pour le rôle et le statut de compte sur la page Comptes utilisateurs (voir Modularité,
// CLAUDE.md : un même rendu, pas une divergence par page/domaine) : `statuts` n'a jamais besoin
// de porter autre chose que `{code, libelle}`, peu importe ce que ces options représentent.
// Composant purement d'affichage : aucune logique de filtrage ici, seulement
// statuts/statutFiltre/onChangerStatutFiltre reçus en props — la page appelante reste seule
// responsable du comptage et du déclenchement de la requête/du filtrage.
// `ariaLabel` optionnel (défaut : "Filtrer par statut", comportement historique inchangé) : les
// nouveaux appelants d'un autre domaine (rôle, statut de compte) passent un libellé adapté pour
// que le lecteur d'écran annonce la bonne barre de filtres.
export default function FiltresStatut({ statuts = [], statutFiltre, onChangerStatutFiltre, ariaLabel = 'Filtrer par statut' }) {
  return (
    <nav className="filtres-statut" aria-label={ariaLabel}>
      <div className="filtres-statut__tous">
        <button
          type="button"
          className={statutFiltre === null ? 'actif' : ''}
          onClick={() => onChangerStatutFiltre(null)}
        >
          Tous
        </button>
      </div>
      <div className="filtres-statut__statuts">
        {statuts.map((statut) => (
          <button
            key={statut.code}
            type="button"
            className={statutFiltre === statut.code ? 'actif' : ''}
            onClick={() => onChangerStatutFiltre(statut.code)}
          >
            {statut.libelle}
          </button>
        ))}
      </div>
    </nav>
  );
}
