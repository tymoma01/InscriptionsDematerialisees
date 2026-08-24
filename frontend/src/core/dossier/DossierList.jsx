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
// "Poste" trie sur la liste brute des codes (postesBureau + postesHotel concaténés, voir
// dossierService.listerDossiers) plutôt que sur les libellés traduits par libellePoste : un tri
// stable ne doit pas dépendre d'un prop optionnel qui pourrait être absent.
const COLONNES = [
  { cle: 'candidat_nom', libelle: 'Candidat', extraire: (dossier) => (dossier.candidat_nom ?? '').toLowerCase() },
  {
    cle: 'candidat_telephone',
    libelle: 'Téléphone',
    extraire: (dossier) => dossier.candidat_telephone ?? '',
  },
  {
    cle: 'candidat_email',
    libelle: 'Email',
    extraire: (dossier) => (dossier.candidat_email ?? '').toLowerCase(),
  },
  {
    cle: 'postes',
    libelle: 'Poste',
    extraire: (dossier) => [...(dossier.postesBureau ?? []), ...(dossier.postesHotel ?? [])].join(', '),
  },
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
// visible?(dossier), alignerADroite?, accent? }] — `visible` optionnel (défaut : toujours
// affichée), pour des actions qui ne concernent que certains statuts (ex. "Replanifier" sur
// TableauDeBordAccueil.jsx, réservé aux dossiers en test_non_realise/invalide) sans que ce
// composant générique ait besoin de connaître ces codes de statut lui-même. `alignerADroite` /
// `accent` : mêmes principes, deux leviers purement visuels/génériques (poussée à droite via
// margin-left: auto sur le flex ; couleur d'accent back-office) qu'une page peut activer sur UNE
// action (ex. "Étudier le dossier", TableauDeBordAccueil.jsx) sans que ce composant sache pourquoi
// — voir DossierList.css.
//
// `libellePoste` : même principe que `varianteStatut`, pour la colonne "Poste" — les codes bruts
// (dossier.postesBureau/postesHotel, voir dossierService.listerDossiers) sont un vocabulaire
// propre à ACCECIT (voir BlocDisponibilites.jsx), ce composant générique ne les traduit pas
// lui-même. Sans `libellePoste` fourni, affiche le code brut plutôt que d'échouer.
//
// Tri entièrement client, sur la liste déjà reçue (déjà filtrée par statut/recherche/date par
// l'appelant, voir TableauDeBordAccueil.jsx/Backoffice.jsx) : ni l'une ni l'autre des deux pages
// qui utilisent ce composant ne pagine côté serveur, un paramètre de tri sur GET /api/dossiers
// ferait un aller-retour réseau pour un travail que le navigateur fait déjà instantanément sur
// quelques dizaines/centaines de lignes. Défaut = dernière mise à jour décroissante (comportement
// historique du composant), préservé tant qu'aucun en-tête n'a été cliqué.
// `dossiersSelectionnes`/`onTogglerSelectionDossier`/`toutSelectionne`/`onTogglerSelectionnerTout`
// (sélection multiple + actions groupées, audit 2026-08-24) : optionnels comme `actions` ci-dessus
// — sans `dossiersSelectionnes` fourni (undefined), aucune colonne de case à cocher ne se rend,
// comportement inchangé pour un futur appelant qui n'en aurait pas besoin. Calculs (quels ids sont
// "visibles" pour la case "tout sélectionner", quel Set contient quoi) laissés à l'appelant
// (TableauDeBordAccueil.jsx) plutôt que recalculés ici : ce composant trie déjà `dossiers` en
// interne (dossiersTries) mais ne le FILTRE jamais lui-même, donc "tout ce qui est affiché" reste
// littéralement le tableau `dossiers` reçu — pas de logique de filtrage supplémentaire à dupliquer
// ici, même principe que `actions`/`varianteStatut` déjà externalisés.
export default function DossierList({
  dossiers,
  varianteStatut,
  libellePoste,
  actions = [],
  dossiersSelectionnes,
  onTogglerSelectionDossier,
  toutSelectionne = false,
  onTogglerSelectionnerTout,
}) {
  const selectionActive = dossiersSelectionnes != null;
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
      {/* --dossier-list-largeur-colonne-case ramenée à 0 quand la sélection ne se rend pas
          (selectionActive false) : cette variable pilote aussi le décalage (`left`) en cascade de
          "N°"/"Candidat" (voir DossierList.css) — sans ce recalage, ces deux colonnes figées
          garderaient un vide à gauche correspondant à la largeur de la case à cocher absente,
          même mécanisme exact que Planification.css/--planification-largeur-colonne-case. */}
      <table className="dossier-list" style={selectionActive ? undefined : { '--dossier-list-largeur-colonne-case': '0rem' }}>
        <thead>
          <tr>
            {/* Sélection multiple (barre d'actions groupées, TableauDeBordAccueil.jsx) — même
                pattern que Planification.jsx (Suivi des tests) : case "tout sélectionner" dans
                l'en-tête, première colonne figée au défilement horizontal (voir DossierList.css,
                --dossier-list-largeur-colonne-case décale désormais "N°"/"Candidat"). */}
            {selectionActive && (
              <th scope="col" className="dossier-list__colonne-case">
                <input
                  type="checkbox"
                  checked={toutSelectionne}
                  onChange={onTogglerSelectionnerTout}
                  aria-label="Tout sélectionner"
                />
              </th>
            )}
            {/* N° de dossier = dossier.id, identifiant métier déjà utilisé partout ailleurs dans
                l'app (en-tête "Dossier #id" de Validation.jsx/Relances.jsx/VerificationPieces.jsx,
                colonne "N° dossier" de TableauDossiersSelectionnes.jsx) — plus un simple rang
                d'affichage recalculé à chaque tri (comportement précédent). Figée avec "Candidat"
                (voir .dossier-list__colonne-numero) pour rester un repère constant même une fois
                les colonnes suivantes défilées hors champ. */}
            <th scope="col" className="dossier-list__colonne-numero">
              N°
            </th>
            {COLONNES.map((colonne) => {
              const actif = tri.colonne === colonne.cle;
              return (
                <th
                  key={colonne.cle}
                  scope="col"
                  // Colonne "Candidat" figée au défilement horizontal (voir
                  // .dossier-list__colonne-figee, DossierList.css) — repère constant pour savoir à
                  // quel dossier se rapportent les colonnes suivantes une fois défilées hors champ,
                  // même patron que .table-utilisateurs__colonne-figee (Utilisateurs.jsx).
                  className={colonne.cle === 'candidat_nom' ? 'dossier-list__colonne-figee' : undefined}
                  aria-sort={actif ? (tri.ordre === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <button type="button" className="dossier-list__entete-tri" onClick={() => trierPar(colonne.cle)}>
                    {colonne.libelle}
                    <span className="dossier-list__indicateur-tri" aria-hidden="true">
                      {actif ? (tri.ordre === 'asc' ? '▲' : '▼') : ''}
                    </span>
                  </button>
                </th>
              );
            })}
            {actions.length > 0 && <th scope="col">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {dossiersTries.map((dossier) => (
            <tr key={dossier.id}>
              {selectionActive && (
                <td className="dossier-list__colonne-case">
                  <input
                    type="checkbox"
                    checked={dossiersSelectionnes.has(dossier.id)}
                    onChange={() => onTogglerSelectionDossier(dossier.id)}
                    aria-label={`Sélectionner ${dossier.candidat_prenom} ${dossier.candidat_nom}`}
                  />
                </td>
              )}
              <td className="dossier-list__colonne-numero">{dossier.id}</td>
              <td className="dossier-list__colonne-figee">
                {dossier.candidat_prenom} {dossier.candidat_nom}
              </td>
              <td>{dossier.candidat_telephone}</td>
              <td>{dossier.candidat_email}</td>
              <td>
                {/* Une puce par poste, empilées verticalement plutôt qu'une seule chaîne
                    "poste1, poste2" : reste lisible même quand un candidat coche plusieurs postes
                    bureau ET hôtel (voir BlocDisponibilites.jsx, cases indépendantes). */}
                <div className="dossier-list__postes">
                  {[...(dossier.postesBureau ?? []), ...(dossier.postesHotel ?? [])].map((code) => (
                    <span key={code} className="dossier-list__badge-poste">
                      {libellePoste ? libellePoste(code) : code}
                    </span>
                  ))}
                </div>
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
                        <button
                          key={action.libelle}
                          type="button"
                          className={
                            [action.alignerADroite && 'dossier-list__action--droite', action.accent && 'dossier-list__action--accent']
                              .filter(Boolean)
                              .join(' ') || undefined
                          }
                          onClick={() => action.onSelectionner(dossier)}
                        >
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
