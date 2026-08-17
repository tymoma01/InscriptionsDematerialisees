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
// `filtresSupplementaires` optionnel (ReactNode) : rendu entre "Tous" et la boîte de statuts —
// permet à une page appelante d'insérer ses propres filtres complémentaires (ex. Backoffice.jsx,
// filtre "Entité" Hôtellerie/Tertiaire) sur la même ligne sans que ce composant générique n'ait à
// connaître leur vocabulaire (voir Modularité, CLAUDE.md) : le contenu, sa mise en page et son
// état restent entièrement à la charge de l'appelant, ce composant se contente de lui réserver un
// emplacement. Les boutons qu'il contient héritent malgré tout du style `.filtres-statut
// button`/`.actif` ci-dessous (descendants du même <nav>), sans code CSS dupliqué.
//
// `compteurTous`/`compteurs` optionnels (refonte compteurs, 2026-08-17) : nombre affiché entre
// parenthèses après chaque libellé ("Test planifié **(5)**", chiffre seul en gras via <strong> —
// le libellé garde son poids normal, y compris sur "Tous" : voir la suppression du
// font-weight: 700 qui portait auparavant sur tout .filtres-statut__tous, FiltresStatut.css).
// `compteurs` est un objet/Map code -> nombre — un code qui n'y figure pas (aucun dossier ne le
// satisfait actuellement, vu les autres filtres actifs) affiche "(0)" plutôt que de ne rien
// afficher : omettre le compteur laisserait croire qu'il n'a pas encore été calculé, alors que 0
// est une réponse à part entière. Seule l'ABSENCE totale de la prop `compteurs` (undefined)
// désactive l'affichage des compteurs : comportement historique inchangé pour Utilisateurs.jsx,
// qui réutilise ce même composant pour filtrer par rôle/statut de compte, sans compteur.
export default function FiltresStatut({
  statuts = [],
  statutFiltre,
  onChangerStatutFiltre,
  ariaLabel = 'Filtrer par statut',
  filtresSupplementaires,
  compteurTous,
  compteurs,
}) {
  return (
    <nav className="filtres-statut" aria-label={ariaLabel}>
      <div className="filtres-statut__tous">
        <button
          type="button"
          className={statutFiltre === null ? 'actif' : ''}
          onClick={() => onChangerStatutFiltre(null)}
        >
          Tous{compteurTous != null ? <strong> ({compteurTous})</strong> : ''}
        </button>
      </div>
      {filtresSupplementaires}
      <div className="filtres-statut__statuts">
        {statuts.map((statut) => (
          <button
            key={statut.code}
            type="button"
            className={statutFiltre === statut.code ? 'actif' : ''}
            onClick={() => onChangerStatutFiltre(statut.code)}
          >
            {statut.libelle}
            {compteurs ? <strong> ({compteurs[statut.code] ?? 0})</strong> : ''}
          </button>
        ))}
      </div>
    </nav>
  );
}
