import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import './SelecteurSitesJour.css';

// Hauteur maximale de la liste (défilement interne au-delà) et marge laissée au bord de l'écran.
const HAUTEUR_LISTE_MAX = 240;
const MARGE_ECRAN = 8;
// Au-delà de ce nombre de codes, le bouton résume : « AIG, COL +2 ».
const CODES_VISIBLES = 2;

// Texte du bouton : « Choisir les sites » sans sélection, sinon les codes choisis séparés par des
// virgules, avec « +N » au-delà de deux. Fonction pure, testée (SelecteurSitesJour.test.js).
export function resumeSelectionSites(sitesChoisis) {
  if (sitesChoisis.length === 0) return 'Choisir les sites';
  const codes = sitesChoisis.slice(0, CODES_VISIBLES).map((site) => site.initiales).join(', ');
  const reste = sitesChoisis.length - CODES_VISIBLES;
  return reste > 0 ? `${codes} +${reste}` : codes;
}

// Sites d'affectation d'UN jour de la semaine type : liste déroulante à cases à cocher (sélection
// multiple) qui ne propose que les sites sélectionnés dans la demande (`sites`, [{ id, nom, initiales }]).
// Le bouton affiche le résumé (resumeSelectionSites), les noms complets en info-bulle. Le panneau s'ouvre
// EN SUPERPOSITION (la carte du jour garde sa taille), sous le bouton — au-dessus s'il manque de place
// en bas — et reste dans l'écran. Il se ferme au clic à l'extérieur, avec Échap ou quand le focus le
// quitte. Clavier : Tab pour atteindre le bouton, Entrée / Espace / flèche bas pour ouvrir, flèches haut et
// bas pour se déplacer, Espace pour cocher. `selection` : ids choisis ; `onChanger(ids)` les remplace
// (dans l'ordre des sites de la demande).
export default function SelecteurSitesJour({ sites, selection, onChanger, libelleJour, invalide = false }) {
  const [ouvert, setOuvert] = useState(false);
  // Placement calculé à l'ouverture : { haut, droite } — au-dessus du bouton / aligné à droite.
  const [placement, setPlacement] = useState({ haut: false, droite: false });
  const conteneurRef = useRef(null);
  const boutonRef = useRef(null);
  const panneauRef = useRef(null);
  const focusPremierRef = useRef(false);

  const fermer = (rendreLeFocus = false) => {
    setOuvert(false);
    if (rendreLeFocus) boutonRef.current?.focus();
  };

  useEffect(() => {
    if (!ouvert) return undefined;
    const fermerSiExterieur = (evenement) => {
      if (conteneurRef.current && !conteneurRef.current.contains(evenement.target)) setOuvert(false);
    };
    document.addEventListener('mousedown', fermerSiExterieur);
    return () => document.removeEventListener('mousedown', fermerSiExterieur);
  }, [ouvert]);

  // Mesure du panneau une fois affiché (avant la peinture) : il s'ouvre au-dessus du bouton si l'espace
  // manque en dessous (et qu'il y en a plus au-dessus), et s'aligne à droite s'il déborderait de l'écran.
  useLayoutEffect(() => {
    if (!ouvert || !boutonRef.current || !panneauRef.current) return;
    const bouton = boutonRef.current.getBoundingClientRect();
    const panneau = panneauRef.current.getBoundingClientRect();
    const place = { dessous: window.innerHeight - bouton.bottom - MARGE_ECRAN, dessus: bouton.top - MARGE_ECRAN };
    setPlacement({
      haut: panneau.height > place.dessous && place.dessus > place.dessous,
      droite: bouton.left + panneau.width > window.innerWidth - MARGE_ECRAN,
    });
    if (focusPremierRef.current) {
      focusPremierRef.current = false;
      panneauRef.current.querySelector('input[type="checkbox"]')?.focus();
    }
  }, [ouvert]);

  const choisis = sites.filter((site) => selection.includes(site.id));
  const infoBulle = choisis.length > 0 ? choisis.map((site) => site.nom).join(', ') : undefined;

  const remplacer = (ids) => onChanger(sites.filter((site) => ids.includes(site.id)).map((site) => site.id));
  const basculer = (siteId) => remplacer(selection.includes(siteId) ? selection.filter((id) => id !== siteId) : [...selection, siteId]);

  const ouvrir = (avecFocus) => {
    focusPremierRef.current = avecFocus;
    setOuvert(true);
  };

  const surToucheBouton = (evenement) => {
    if (evenement.key === 'ArrowDown' || evenement.key === 'ArrowUp') {
      evenement.preventDefault();
      if (!ouvert) ouvrir(true);
    }
  };

  // Flèches : déplacement entre les cases à cocher ; Échap : fermeture, focus rendu au bouton.
  const surTouchePanneau = (evenement) => {
    if (evenement.key === 'Escape') {
      evenement.stopPropagation();
      fermer(true);
      return;
    }
    if (evenement.key !== 'ArrowDown' && evenement.key !== 'ArrowUp') return;
    evenement.preventDefault();
    const cases = [...panneauRef.current.querySelectorAll('input[type="checkbox"]')];
    const indice = cases.indexOf(document.activeElement);
    const suivant = evenement.key === 'ArrowDown' ? indice + 1 : indice - 1;
    cases[Math.min(Math.max(suivant, 0), cases.length - 1)]?.focus();
  };

  // Le focus quitte le composant (Tab hors du panneau) : fermeture.
  const surPerteFocus = (evenement) => {
    if (conteneurRef.current && !conteneurRef.current.contains(evenement.relatedTarget)) setOuvert(false);
  };

  return (
    <div className="selecteur-sites-jour" ref={conteneurRef} onBlur={surPerteFocus}>
      <button
        type="button"
        ref={boutonRef}
        className={`selecteur-sites-jour__bouton${invalide ? ' selecteur-sites-jour__bouton--invalide' : ''}`}
        aria-haspopup="true"
        aria-expanded={ouvert}
        aria-label={`Sites du ${libelleJour}`}
        title={infoBulle}
        onClick={() => (ouvert ? fermer() : ouvrir(false))}
        onKeyDown={surToucheBouton}
      >
        <span className="selecteur-sites-jour__resume">{resumeSelectionSites(choisis)}</span>
        <span className="selecteur-sites-jour__chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {ouvert && (
        <div
          ref={panneauRef}
          className={`selecteur-sites-jour__panneau${placement.haut ? ' selecteur-sites-jour__panneau--haut' : ''}${placement.droite ? ' selecteur-sites-jour__panneau--droite' : ''}`}
          role="group"
          aria-label={`Sites du ${libelleJour}`}
          onKeyDown={surTouchePanneau}
        >
          <div className="selecteur-sites-jour__actions">
            <button type="button" onClick={() => remplacer(sites.map((site) => site.id))}>
              Tout cocher
            </button>
            <button type="button" onClick={() => remplacer([])}>
              Tout décocher
            </button>
          </div>
          <ul className="selecteur-sites-jour__liste" style={{ maxHeight: HAUTEUR_LISTE_MAX }}>
            {sites.map((site) => (
              <li key={site.id}>
                <label className="selecteur-sites-jour__ligne" title={site.nom}>
                  <input type="checkbox" checked={selection.includes(site.id)} onChange={() => basculer(site.id)} />
                  <span>
                    {site.nom} ({site.initiales})
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
