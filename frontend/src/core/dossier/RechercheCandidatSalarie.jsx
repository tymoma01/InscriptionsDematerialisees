import { useEffect, useRef, useState } from 'react';
import { rechercherCandidats } from '../../services/dpaeService';
import './RechercheCandidatSalarie.css';

const DELAI_DEBOUNCE_MS = 300;
// Même seuil que dossierService.rechercherCandidats côté back (donnees.length < 2) — évite un
// aller-retour réseau pour rien à la première frappe, le back renverrait de toute façon [].
const LONGUEUR_MINIMALE = 2;

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

// Champ "Nom du salarié" avec autocomplétion sur les candidats déjà connus de l'entité (module
// Demandes DPAE, demande utilisateur en cours d'échange) — remplace le simple champ texte de la
// maquette d'origine. Reste un champ texte libre : sélectionner une suggestion renseigne
// `candidatId` (voir onSelectionnerCandidat) et pré-remplit nom/prénom, mais rien n'empêche de
// continuer à taper librement si le salarié est nouveau (pas encore candidat chez nous).
//
// `candidatId` reçu en prop (pas géré en interne) : dès que le parent le remet à null (l'agent a
// retouché nom/prénom à la main après une sélection), ce composant doit redevenir un champ de
// recherche normal plutôt que de garder une sélection périmée.
export default function RechercheCandidatSalarie({ valeur, onChanger, onSelectionnerCandidat, candidatId }) {
  const [suggestions, setSuggestions] = useState([]);
  const [ouvert, setOuvert] = useState(false);
  const [chargement, setChargement] = useState(false);
  const minuteurRef = useRef(null);
  const conteneurRef = useRef(null);

  useEffect(() => {
    // Une sélection déjà faite (candidatId non nul) : pas besoin de rechercher, la valeur vient
    // d'être posée par le parent suite au clic sur une suggestion (voir selectionner ci-dessous).
    if (candidatId || valeur.trim().length < LONGUEUR_MINIMALE) {
      setSuggestions([]);
      setOuvert(false);
      return undefined;
    }

    clearTimeout(minuteurRef.current);
    minuteurRef.current = setTimeout(async () => {
      setChargement(true);
      try {
        const resultats = await rechercherCandidats(valeur.trim());
        setSuggestions(resultats);
        setOuvert(resultats.length > 0);
      } catch {
        // Un échec de recherche ne doit jamais bloquer la saisie libre — l'agent peut toujours
        // continuer à taper le nom à la main.
        setSuggestions([]);
      } finally {
        setChargement(false);
      }
    }, DELAI_DEBOUNCE_MS);

    return () => clearTimeout(minuteurRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valeur, candidatId]);

  useEffect(() => {
    function surClicExterieur(evenement) {
      if (conteneurRef.current && !conteneurRef.current.contains(evenement.target)) {
        setOuvert(false);
      }
    }
    document.addEventListener('mousedown', surClicExterieur);
    return () => document.removeEventListener('mousedown', surClicExterieur);
  }, []);

  const selectionner = (candidat) => {
    onSelectionnerCandidat(candidat);
    setOuvert(false);
  };

  return (
    <div className="recherche-candidat-salarie" ref={conteneurRef}>
      <input
        type="text"
        value={valeur}
        onChange={(evenement) => onChanger(evenement.target.value)}
        onFocus={() => setOuvert(suggestions.length > 0)}
        autoComplete="off"
        role="combobox"
        aria-expanded={ouvert}
        aria-autocomplete="list"
      />
      {ouvert && (
        <ul className="recherche-candidat-salarie__suggestions" role="listbox">
          {chargement && <li className="recherche-candidat-salarie__info">Recherche…</li>}
          {!chargement &&
            suggestions.map((candidat) => (
              <li key={candidat.id}>
                <button type="button" role="option" onClick={() => selectionner(candidat)}>
                  {candidat.prenom} {candidat.nom}
                  {candidat.date_naissance && (
                    <span className="recherche-candidat-salarie__naissance">
                      {' '}
                      — né(e) le {FORMAT_DATE.format(new Date(candidat.date_naissance))}
                    </span>
                  )}
                </button>
              </li>
            ))}
        </ul>
      )}
      {candidatId && (
        <p className="recherche-candidat-salarie__selection" role="status">
          Candidat existant sélectionné.{' '}
          <button type="button" onClick={() => onSelectionnerCandidat(null)}>
            Retirer
          </button>
        </p>
      )}
    </div>
  );
}
