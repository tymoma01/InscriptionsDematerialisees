import { useEffect, useMemo, useState } from 'react';
import { normaliserTexte } from '../../core/filtres/normaliserTexte';
import { listerSitesAffectation, creerSiteAffectation } from '../../services/siteAffectationService';
import './SelecteurSitesAffectation.css';

// Nombre de sites cités en toutes lettres dans le résumé du bloc replié, au-delà : « et N autres ».
const NOMBRE_SITES_RESUME = 3;

const comparerParNom = (a, b) => a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' });

const libelleSite = (site) => `${site.nom} (${site.initiales})`;

// « AIGLON (AIG), ALBE (AL), AVALON (AVA) et 2 autres » — ordre alphabétique, celui de la grille.
function resumerSelection(sitesSelectionnes) {
  if (sitesSelectionnes.length === 0) return 'Aucun site sélectionné';
  const cites = sitesSelectionnes.slice(0, NOMBRE_SITES_RESUME).map(libelleSite).join(', ');
  const reste = sitesSelectionnes.length - NOMBRE_SITES_RESUME;
  if (reste <= 0) return cites;
  return `${cites} et ${reste} ${reste > 1 ? 'autres' : 'autre'}`;
}

function correspondRecherche(site, rechercheNormalisee) {
  if (!rechercheNormalisee) return true;
  return (
    normaliserTexte(site.nom.toLowerCase()).includes(rechercheNormalisee) ||
    normaliserTexte(site.initiales.toLowerCase()).includes(rechercheNormalisee)
  );
}

// Premier message d'erreur utile renvoyé par POST /api/sites-affectation : message métier (409,
// doublon) ou, pour un 400 de validation, le détail du premier champ en erreur plutôt que le
// générique « Données invalides. ».
function messageErreurAjout(erreur) {
  const donnees = erreur.response?.data;
  if (!donnees) return 'Connexion au serveur impossible. Vérifiez le réseau et réessayez.';
  const detailsChamps = donnees.details?.fieldErrors ?? {};
  const premierDetail = Object.values(detailsChamps).flat()[0];
  return premierDetail ?? donnees.erreur ?? "Impossible d'ajouter ce site.";
}

// Sélection d'un ou plusieurs sites d'affectation (formulaire « Nouvelle demande DPAE », 2026-09-29)
// dans le référentiel `sites_affectation` (migration 069). Encadré repliable IDENTIQUE à « Voir les
// informations d'inscription complètes » (InformationsInscription.jsx) : même <details>/<summary>
// natifs, même classe partagée .encadre-repliable (styles/encadreRepliable.css) — flèche native
// ▸/▾, clic sur toute la ligne de titre, ouverture au clavier (Tab puis Entrée ou Espace).
//
// Ouverture PILOTÉE par le parent (`ouvert`/`onChangerOuvert`) : « Valider la sélection » replie le
// bloc, et le formulaire le déplie lui-même si l'on tente d'envoyer sans site (voir
// DemandeDpae.jsx). Il ne se replie jamais de lui-même à chaque clic sur un site.
//
// `selection` : ids sélectionnés (tenus par le formulaire parent, envoyés tels quels au serveur
// comme sitesAffectationIds) ; `onChangerSelection(ids)` les remplace. `onSitesCharges(sites)` (facultatif)
// reçoit les sites actifs chargés.
export default function SelecteurSitesAffectation({ selection, onChangerSelection, ouvert, onChangerOuvert, onSitesCharges }) {
  const [sites, setSites] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreurChargement, setErreurChargement] = useState(null);
  const [recherche, setRecherche] = useState('');

  const [ajoutOuvert, setAjoutOuvert] = useState(false);
  const [nouveauNom, setNouveauNom] = useState('');
  const [nouvellesInitiales, setNouvellesInitiales] = useState('');
  const [ajoutEnCours, setAjoutEnCours] = useState(false);
  const [erreurAjout, setErreurAjout] = useState(null);

  useEffect(() => {
    let annule = false;
    listerSitesAffectation()
      .then((liste) => {
        if (!annule) setSites(liste);
      })
      .catch(() => {
        if (!annule) setErreurChargement('Impossible de charger la liste des sites.');
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, []);

  // Le formulaire a besoin du nom des sites sélectionnés (liste « site par jour » de la semaine type) :
  // il reçoit la liste chargée, site ajouté via « + » compris.
  useEffect(() => {
    onSitesCharges?.(sites);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sites]);

  // Tri côté client aussi (en plus du tri serveur) : un site ajouté via « + » prend ainsi sa place
  // alphabétique sans recharger la liste.
  const sitesTries = useMemo(() => [...sites].sort(comparerParNom), [sites]);
  const sitesSelectionnes = useMemo(() => sitesTries.filter((site) => selection.includes(site.id)), [sitesTries, selection]);
  const sitesAffiches = useMemo(() => {
    const rechercheNormalisee = normaliserTexte(recherche.trim().toLowerCase());
    return sitesTries.filter((site) => correspondRecherche(site, rechercheNormalisee));
  }, [sitesTries, recherche]);

  const basculerSite = (siteId) =>
    onChangerSelection(selection.includes(siteId) ? selection.filter((id) => id !== siteId) : [...selection, siteId]);

  const fermerAjout = () => {
    setAjoutOuvert(false);
    setNouveauNom('');
    setNouvellesInitiales('');
    setErreurAjout(null);
  };

  const enregistrerSite = async () => {
    if (ajoutEnCours) return;
    setAjoutEnCours(true);
    setErreurAjout(null);
    try {
      const site = await creerSiteAffectation({ nom: nouveauNom.trim(), initiales: nouvellesInitiales.trim() });
      setSites((precedents) => [...precedents, site]);
      // Ajouté à la sélection en cours, sans remplacer les sites déjà choisis.
      onChangerSelection([...selection, site.id]);
      // Recherche vidée : le nouveau site doit apparaître à sa place alphabétique dans la grille.
      setRecherche('');
      fermerAjout();
    } catch (erreur) {
      setErreurAjout(messageErreurAjout(erreur));
    } finally {
      setAjoutEnCours(false);
    }
  };

  // Ce petit formulaire vit DANS le formulaire DPAE (un <form> imbriqué est interdit en HTML) :
  // Entrée ne doit pas envoyer la demande entière, elle enregistre le site.
  const gererToucheAjout = (evenement) => {
    if (evenement.key === 'Enter') {
      evenement.preventDefault();
      enregistrerSite();
    }
  };

  const nombreSelectionnes = selection.length;

  return (
    <details
      className="encadre-repliable selecteur-sites"
      open={ouvert}
      onToggle={(evenement) => onChangerOuvert(evenement.currentTarget.open)}
    >
      {/* <summary> laissé en affichage par défaut (flèche native, voir encadreRepliable.css) : son
          contenu reste en ligne — libellé puis résumé, toujours visible replié comme déplié. */}
      <summary>
        Site(s) d&rsquo;affectation <span className="champ-obligatoire">*</span>{' '}
        <span className={`selecteur-sites__choix${nombreSelectionnes === 0 ? ' selecteur-sites__choix--vide' : ''}`}>
          {resumerSelection(sitesSelectionnes)}
        </span>
      </summary>

      <div className="selecteur-sites__contenu">
        <div className="selecteur-sites__barre">
          <input
            type="search"
            className="selecteur-sites__recherche"
            value={recherche}
            onChange={(evenement) => setRecherche(evenement.target.value)}
            onKeyDown={(evenement) => {
              if (evenement.key === 'Enter') evenement.preventDefault();
            }}
            placeholder="Rechercher un site (nom ou initiales)"
            aria-label="Rechercher un site d'affectation"
          />
          <button
            type="button"
            className="selecteur-sites__bouton-ajout"
            onClick={() => (ajoutOuvert ? fermerAjout() : setAjoutOuvert(true))}
            aria-expanded={ajoutOuvert}
            title="Ajouter un site"
          >
            +
          </button>
        </div>

        {ajoutOuvert && (
          <div className="selecteur-sites__ajout" role="group" aria-label="Ajouter un site d'affectation">
            <label>
              <span>Nom du site</span>
              <input type="text" value={nouveauNom} onChange={(evenement) => setNouveauNom(evenement.target.value)} onKeyDown={gererToucheAjout} />
            </label>
            <label>
              <span>Initiales</span>
              <input
                type="text"
                value={nouvellesInitiales}
                // Majuscules à la saisie (le serveur n'accepte que majuscules et chiffres).
                onChange={(evenement) => setNouvellesInitiales(evenement.target.value.toUpperCase())}
                onKeyDown={gererToucheAjout}
                maxLength={5}
              />
            </label>
            <div className="selecteur-sites__ajout-actions">
              <button type="button" onClick={enregistrerSite} disabled={ajoutEnCours || !nouveauNom.trim() || !nouvellesInitiales.trim()}>
                Enregistrer
              </button>
              <button type="button" className="selecteur-sites__bouton-secondaire" onClick={fermerAjout} disabled={ajoutEnCours}>
                Annuler
              </button>
            </div>
            {erreurAjout && (
              <p role="alert" className="selecteur-sites__erreur">
                {erreurAjout}
              </p>
            )}
          </div>
        )}

        {chargement && <p>Chargement des sites…</p>}
        {erreurChargement && <p role="alert">{erreurChargement}</p>}
        {!chargement && !erreurChargement && sitesAffiches.length === 0 && (
          <p className="selecteur-sites__vide">Aucun site ne correspond à la recherche.</p>
        )}

        {/* Grille : ordre alphabétique de lecture ligne par ligne, de gauche à droite (flux de grille
            par défaut), 4 colonnes en largeur bureau, 2 en tablette (voir le .css). */}
        <div className="selecteur-sites__grille">
          {sitesAffiches.map((site) => {
            const estSelectionne = selection.includes(site.id);
            return (
              <button
                key={site.id}
                type="button"
                className={`selecteur-sites__site${estSelectionne ? ' selecteur-sites__site--selectionne' : ''}`}
                aria-pressed={estSelectionne}
                onClick={() => basculerSite(site.id)}
              >
                <span className="selecteur-sites__coche" aria-hidden="true">
                  {estSelectionne ? '✓' : ''}
                </span>
                <span className="selecteur-sites__nom">{site.nom}</span>
                <span className="selecteur-sites__initiales">{site.initiales}</span>
              </button>
            );
          })}
        </div>

        <div className="selecteur-sites__pied">
          <span className="selecteur-sites__compteur">
            {nombreSelectionnes} {nombreSelectionnes > 1 ? 'sites sélectionnés' : 'site sélectionné'}
          </span>
          <button type="button" className="selecteur-sites__lien" onClick={() => onChangerSelection([])} disabled={nombreSelectionnes === 0}>
            Tout désélectionner
          </button>
          <button type="button" className="selecteur-sites__valider" onClick={() => onChangerOuvert(false)}>
            Valider la sélection
          </button>
        </div>
      </div>
    </details>
  );
}
