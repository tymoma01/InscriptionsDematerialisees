import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ChampRecherche from '../filtres/ChampRecherche';
import FiltrePlageDate from '../filtres/FiltrePlageDate';
import { COLONNES_DPAE, appliquerRechercheFiltresTri, filtreEstActif, valeursPresentes } from './listeDemandesDpae';
import { libellesSites } from './affichageDpae';
import './FiltresListeDpae.css';

// Recherche, filtres et tri des listes de demandes DPAE — composant UNIQUE, partagé par « Suivi des
// demandes DPAE » (SuiviDemandesDpae.jsx) et la liste RH (TraitementDpae.jsx). La logique (ce qui
// est cherché, filtré, trié) vit dans listeDemandesDpae.js ; ce fichier ne porte que l'état et
// l'affichage. Côté client : les deux listes ne sont pas paginées par le serveur.

// État de la recherche, des filtres de colonnes et du tri d'une liste. triParDefaut : ordre de la
// page tant qu'aucun tri de colonne n'est choisi (doit être stable entre deux rendus).
export function useFiltresListeDpae(demandes, { triParDefaut } = {}) {
  const [recherche, setRecherche] = useState('');
  const [filtres, setFiltres] = useState({});
  const [tri, setTri] = useState(null);

  const demandesVisibles = useMemo(
    () => appliquerRechercheFiltresTri(demandes, { recherche, filtres, tri, triParDefaut }),
    [demandes, recherche, filtres, tri, triParDefaut],
  );

  const filtreActif = useCallback((cle) => filtreEstActif(cle, filtres[cle]), [filtres]);
  const unFiltreActif = Object.keys(filtres).some(filtreActif);

  return {
    demandes,
    demandesVisibles,
    recherche,
    setRecherche,
    filtres,
    filtreActif,
    tri,
    // null : retire le filtre de la colonne.
    changerFiltre: (cle, filtre) =>
      setFiltres((precedents) => {
        const suivants = { ...precedents };
        if (filtre && filtreEstActif(cle, filtre)) suivants[cle] = filtre;
        else delete suivants[cle];
        return suivants;
      }),
    // Un second clic sur le tri déjà actif le retire (retour au tri par défaut de la page).
    changerTri: (cle, sens) => setTri((precedent) => (precedent?.cle === cle && precedent.sens === sens ? null : { cle, sens })),
    // « Effacer les filtres » : visible dès qu'une recherche, un filtre de colonne ou un tri de
    // colonne restreint ou réordonne la liste ; rétablit la liste et le tri d'ouverture.
    peutEffacer: Boolean(recherche.trim()) || unFiltreActif || Boolean(tri),
    effacer: () => {
      setRecherche('');
      setFiltres({});
      setTri(null);
    },
  };
}

// Champ de recherche (même composant que Dossiers candidats) et bouton « Effacer les filtres ».
export function BarreRechercheDpae({ etat }) {
  const nombre = etat.demandesVisibles.length;
  return (
    <div className="filtres-liste-dpae__barre">
      <div className="filtres-liste-dpae__recherche">
        <ChampRecherche
          valeur={etat.recherche}
          onChanger={etat.setRecherche}
          placeholder="Rechercher : salarié, site, demandeur, contrat, type de demande, n°…"
          ariaLabel="Rechercher une demande DPAE"
        />
      </div>
      {etat.peutEffacer && (
        <>
          <span className="filtres-liste-dpae__compteur" aria-live="polite">
            {nombre} demande{nombre > 1 ? 's' : ''} sur {etat.demandes.length}
          </span>
          <button type="button" className="filtres-liste-dpae__effacer" onClick={etat.effacer}>
            Effacer les filtres
          </button>
        </>
      )}
    </div>
  );
}

// Position « fixed » d'un élément flottant près de son ancre : jamais rogné par le tableau (coins
// arrondis en overflow: hidden, défilement horizontal sur tablette). Sous l'ancre, ou au-dessus
// s'il y a plus de place en haut (titre de colonne bas dans la fenêtre) ; hauteur limitée à la place
// disponible (défilement interne), pour qu'aucune partie ne sorte jamais de l'écran. Recalculée au
// défilement et au redimensionnement — sans fermer l'élément, pour qu'il reste ouvert pendant la
// saisie sur tablette (le clavier virtuel redimensionne la page).
const MARGE_FENETRE = 8;
const HAUTEUR_MIN_SOUS_ANCRE = 240;

function usePositionSousAncre(ouvert, refAncre, largeur) {
  const [position, setPosition] = useState(null);
  const recalculer = useCallback(() => {
    const rect = refAncre.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.max(MARGE_FENETRE, Math.min(rect.left, window.innerWidth - largeur - MARGE_FENETRE));
    const placeDessous = window.innerHeight - rect.bottom - 4 - MARGE_FENETRE;
    const placeDessus = rect.top - 4 - MARGE_FENETRE;
    if (placeDessous >= HAUTEUR_MIN_SOUS_ANCRE || placeDessous >= placeDessus) {
      setPosition({ top: rect.bottom + 4, left, maxHeight: Math.max(placeDessous, 0) });
    } else {
      setPosition({ bottom: window.innerHeight - rect.top + 4, left, maxHeight: placeDessus });
    }
  }, [refAncre, largeur]);

  useLayoutEffect(() => {
    if (!ouvert) return undefined;
    recalculer();
    window.addEventListener('scroll', recalculer, true);
    window.addEventListener('resize', recalculer);
    return () => {
      window.removeEventListener('scroll', recalculer, true);
      window.removeEventListener('resize', recalculer);
    };
  }, [ouvert, recalculer]);
  return position;
}

// Ferme sur un clic/toucher en dehors des éléments donnés, ou sur Échap.
function useFermetureExterieure(ouvert, refs, fermer) {
  useEffect(() => {
    if (!ouvert) return undefined;
    const surPointeur = (evenement) => {
      if (refs.some((ref) => ref.current?.contains(evenement.target))) return;
      fermer();
    };
    const surTouche = (evenement) => {
      if (evenement.key === 'Escape') fermer();
    };
    document.addEventListener('pointerdown', surPointeur);
    document.addEventListener('keydown', surTouche);
    return () => {
      document.removeEventListener('pointerdown', surPointeur);
      document.removeEventListener('keydown', surTouche);
    };
  }, [ouvert, refs, fermer]);
}

const LARGEUR_MENU = 272;

const LIBELLES_TRI = {
  periode: { asc: 'Plus ancien d’abord', desc: 'Plus récent d’abord' },
  autre: { asc: 'Tri croissant (A → Z)', desc: 'Tri décroissant (Z → A)' },
};

function IconeEntonnoir() {
  return (
    <svg className="filtres-liste-dpae__icone-filtre" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M1.5 2h13l-5 6v5l-3 1.5V8z" fill="currentColor" />
    </svg>
  );
}

// Titre de colonne cliquable : ouvre un petit menu avec le tri croissant/décroissant puis le filtre
// de la colonne (période, cases à cocher parmi les valeurs présentes, ou texte). Titre filtré :
// couleur et icône d'entonnoir ; titre trié : flèche.
export function EnTeteColonneDpae({ etat, cle, libelle, className }) {
  const [ouvert, setOuvert] = useState(false);
  const refBouton = useRef(null);
  const refMenu = useRef(null);
  const refs = useMemo(() => [refBouton, refMenu], []);
  const fermer = useCallback(() => setOuvert(false), []);
  const position = usePositionSousAncre(ouvert, refBouton, LARGEUR_MENU);
  useFermetureExterieure(ouvert, refs, fermer);

  const colonne = COLONNES_DPAE[cle];
  const filtre = etat.filtres[cle];
  const filtree = etat.filtreActif(cle);
  const sensTri = etat.tri?.cle === cle ? etat.tri.sens : null;
  const libellesTri = LIBELLES_TRI[colonne.filtre === 'periode' ? 'periode' : 'autre'];

  return (
    <th className={className} aria-sort={sensTri === 'asc' ? 'ascending' : sensTri === 'desc' ? 'descending' : undefined}>
      <button
        ref={refBouton}
        type="button"
        className={`filtres-liste-dpae__titre${filtree ? ' filtres-liste-dpae__titre--filtre' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={ouvert}
        onClick={() => setOuvert((valeur) => !valeur)}
        title={filtree ? 'Colonne filtrée' : 'Trier ou filtrer'}
      >
        <span>{libelle}</span>
        {filtree && <IconeEntonnoir />}
        {sensTri && <span aria-hidden="true">{sensTri === 'asc' ? '↑' : '↓'}</span>}
        <span className="filtres-liste-dpae__chevron" aria-hidden="true">
          ▾
        </span>
      </button>

      {ouvert && position && (
        <div
          ref={refMenu}
          role="dialog"
          aria-label={`Trier et filtrer : ${libelle}`}
          className="filtres-liste-dpae__menu"
          style={{ ...position, width: LARGEUR_MENU }}
        >
          <div className="filtres-liste-dpae__menu-section" role="group" aria-label="Tri">
            {['asc', 'desc'].map((sens) => (
              <button
                key={sens}
                type="button"
                className={`filtres-liste-dpae__tri${sensTri === sens ? ' filtres-liste-dpae__tri--actif' : ''}`}
                aria-pressed={sensTri === sens}
                onClick={() => etat.changerTri(cle, sens)}
              >
                {sens === 'asc' ? '↑' : '↓'} {libellesTri[sens]}
              </button>
            ))}
          </div>

          <div className="filtres-liste-dpae__menu-section">
            <span className="filtres-liste-dpae__menu-titre">Filtrer</span>
            {colonne.filtre === 'periode' && (
              <div className="filtres-liste-dpae__periode">
                <FiltrePlageDate
                  dateDebutFiltre={filtre?.du ?? ''}
                  onChangerDateDebutFiltre={(du) => etat.changerFiltre(cle, { ...filtre, du })}
                  dateFinFiltre={filtre?.au ?? ''}
                  onChangerDateFinFiltre={(au) => etat.changerFiltre(cle, { ...filtre, au })}
                />
              </div>
            )}
            {colonne.filtre === 'texte' && (
              <input
                type="search"
                className="filtres-liste-dpae__texte"
                placeholder="Contient…"
                aria-label={`Filtrer la colonne ${libelle}`}
                value={filtre?.texte ?? ''}
                onChange={(evenement) => etat.changerFiltre(cle, { texte: evenement.target.value })}
              />
            )}
            {colonne.filtre === 'valeurs' && <CasesValeurs etat={etat} cle={cle} />}
          </div>

          {filtree && (
            <button type="button" className="filtres-liste-dpae__effacer-colonne" onClick={() => etat.changerFiltre(cle, null)}>
              Effacer ce filtre
            </button>
          )}
        </div>
      )}
    </th>
  );
}

// Cases à cocher : valeurs présentes dans la liste chargée ; toutes cochées = aucun filtre.
function CasesValeurs({ etat, cle }) {
  const valeurs = useMemo(() => valeursPresentes(etat.demandes, cle), [etat.demandes, cle]);
  const retenues = etat.filtres[cle]?.valeurs;
  const estCochee = (valeur) => !retenues || retenues.includes(valeur);

  const basculer = (valeur) => {
    const actuelles = retenues ?? valeurs;
    const suivantes = actuelles.includes(valeur) ? actuelles.filter((v) => v !== valeur) : [...actuelles, valeur];
    const toutes = valeurs.every((v) => suivantes.includes(v));
    etat.changerFiltre(cle, toutes ? null : { valeurs: suivantes });
  };

  return (
    <>
      <div className="filtres-liste-dpae__tout">
        <button type="button" onClick={() => etat.changerFiltre(cle, null)}>
          Tout cocher
        </button>
        <button type="button" onClick={() => etat.changerFiltre(cle, { valeurs: [] })}>
          Tout décocher
        </button>
      </div>
      <ul className="filtres-liste-dpae__valeurs">
        {valeurs.map((valeur) => (
          <li key={valeur}>
            <label>
              <input type="checkbox" checked={estCochee(valeur)} onChange={() => basculer(valeur)} />
              <span>{valeur}</span>
            </label>
          </li>
        ))}
      </ul>
    </>
  );
}

const LARGEUR_INFOBULLE = 320;
const SITES_AFFICHES = 2;

// Cellule « Site(s) d'affectation » : au plus 2 sites, puis une pastille « +N ». Info-bulle avec la
// liste complète au survol (souris) et au toucher (tablette) ; un toucher ailleurs la referme.
// À la souris, un clic garde le comportement de la ligne (ouverture de la fiche dans le Suivi) ; au
// toucher, il ouvre/ferme l'info-bulle sans ouvrir la fiche.
export function SitesDemandeDpae({ demande }) {
  const libelles = libellesSites(demande);
  const [ouvert, setOuvert] = useState(false);
  const refCellule = useRef(null);
  const refInfobulle = useRef(null);
  const refs = useMemo(() => [refCellule, refInfobulle], []);
  const typePointeur = useRef('mouse');
  const fermer = useCallback(() => setOuvert(false), []);
  const position = usePositionSousAncre(ouvert, refCellule, LARGEUR_INFOBULLE);
  useFermetureExterieure(ouvert, refs, fermer);

  if (libelles.length === 0) return '—';
  const reste = libelles.length - SITES_AFFICHES;

  return (
    <span
      ref={refCellule}
      className="filtres-liste-dpae__sites"
      tabIndex={0}
      aria-label={`Sites d'affectation : ${libelles.join(', ')}`}
      onPointerDown={(evenement) => {
        typePointeur.current = evenement.pointerType;
      }}
      onPointerEnter={(evenement) => {
        if (evenement.pointerType === 'mouse') setOuvert(true);
      }}
      onPointerLeave={(evenement) => {
        if (evenement.pointerType === 'mouse') setOuvert(false);
      }}
      // Focus clavier seulement : au toucher, le focus précède le clic, qui refermerait aussitôt.
      onFocus={(evenement) => {
        if (evenement.currentTarget.matches(':focus-visible')) setOuvert(true);
      }}
      onBlur={() => setOuvert(false)}
      onClick={(evenement) => {
        if (typePointeur.current === 'mouse') return;
        evenement.stopPropagation();
        setOuvert((valeur) => !valeur);
      }}
    >
      <span className="filtres-liste-dpae__sites-texte">{libelles.slice(0, SITES_AFFICHES).join(', ')}</span>
      {reste > 0 && <span className="filtres-liste-dpae__sites-plus">+{reste}</span>}
      {ouvert && position && (
        <span
          ref={refInfobulle}
          role="tooltip"
          className="filtres-liste-dpae__infobulle"
          style={{ ...position, maxWidth: LARGEUR_INFOBULLE }}
        >
          {libelles.map((libelle) => (
            <span key={libelle}>{libelle}</span>
          ))}
        </span>
      )}
    </span>
  );
}
