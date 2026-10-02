import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { useSession } from '../../core/auth/useSession';
import { ROLE_INSPECTEUR_HOTELLERIE } from '../../core/auth/permissions';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import { obtenirIndicateursKpi, listerDossiersParIndicateurs } from '../../services/statistiqueService';
import { useRafraichissementAuto } from '../../core/dossier/useRafraichissementAuto';
import ErrorBoundary from '../../core/backOffice/ErrorBoundary';
import TableauDossiersSelectionnes from './TableauDossiersSelectionnes';
import { POSTES_BUREAU, POSTES_HOTEL } from '../../core/referentiels/postes';
import {
  varianteStatut,
  ORDRE_CANONIQUE_INDICATEURS,
  PREFIXE_POSTE,
  PREFIXE_VOLUMETRIE,
  CARTES_VOLUMETRIE_ACCECIT,
  PAIRES_INDICATEURS_EXCLUSIFS,
  libellePoste,
  libelleOptionTousLesPostes,
  libelleIndicateur,
  varianteIndicateur,
  estIndicateurPoste,
  libelleDateCle,
  varianteDateCle,
  COULEURS_VERDICT,
  COULEURS_ORIENTATION,
  COULEURS_POSTE,
  COULEUR_POSTE_NON_SPECIFIE,
  STYLE_TOOLTIP_GRAPHIQUE,
  STYLE_TOOLTIP_ITEM_GRAPHIQUE,
  STYLE_TOOLTIP_ITEM_CAMEMBERT,
  creerFormatteurTooltipCamembert,
  useSuiviCurseurCamembert,
  labelPartCamembert,
  bornesParDefaut,
} from './libellesIndicateurs';
import './Indicateurs.css';

// Tableau de bord KPI back-office (CLAUDE.md, section Tableau de bord : "indicateurs de pilotage
// et filtres, alimenté par les statuts et les motifs collectés tout au long du parcours") —
// réservé à Recruteur/Admin côté serveur (voir backend/src/api/routes/statistiques.routes.js),
// aucune garde de route ici, même principe que le reste du back-office (voir App.jsx).
export default function Indicateurs() {
  const { utilisateur, chargement: chargementSession } = useSession();

  const [periode, setPeriode] = useState(bornesParDefaut);
  const [typePoste, setTypePoste] = useState(''); // '' = toutes (Hôtellerie + Tertiaire)
  // Inspecteur Hôtellerie : indicateurs limités à l'Hôtellerie — imposé côté serveur
  // (statistiques.routes.js), reflété ici (Entité figée sur Hôtellerie, sélecteur masqué).
  const estInspecteurHotellerie = utilisateur?.roleCode === ROLE_INSPECTEUR_HOTELLERIE;
  useEffect(() => {
    if (estInspecteurHotellerie) setTypePoste('hotel');
  }, [estInspecteurHotellerie]);
  const [poste, setPoste] = useState(''); // '' = tous les postes

  const [indicateurs, setIndicateurs] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);

  // Un suivi de curseur indépendant par camembert (voir useSuiviCurseurCamembert plus haut) :
  // chacun a son propre conteneur DOM et sa propre dernière position connue.
  const suiviCurseurVerdicts = useSuiviCurseurCamembert();
  const suiviCurseurOrientations = useSuiviCurseurCamembert();

  // Sélection multiple des cartes/segments cliqués (Set de codes, voir LIBELLES_INDICATEURS plus
  // haut) — état séparé de `indicateurs` ci-dessus (les agrégats affichés sur les cartes/
  // graphiques), qui reste la source de vérité des CHIFFRES ; celui-ci ne pilote que le tableau
  // consolidé sous les graphiques.
  const [selectionIndicateurs, setSelectionIndicateurs] = useState(() => new Set());
  const [dossiersSelectionnes, setDossiersSelectionnes] = useState([]);
  const [chargementTableau, setChargementTableau] = useState(false);
  const [erreurTableau, setErreurTableau] = useState(null);
  // Largeur du panneau latéral "Dossiers sélectionnés" —
  // simple bascule visuelle, jamais rechargée depuis l'API ni persistée : repart à `false` (largeur
  // par défaut) à chaque rechargement de page, cohérent avec le reste des états d'affichage locaux
  // de cet écran (ex. selectionIndicateurs lui-même).
  const [panneauElargi, setPanneauElargi] = useState(false);

  // Dérivé plutôt que `panneauElargi` seul, répété à trois endroits du rendu (disposition, contenu
  // principal masqué, panneau) — n'agrandit réellement rien tant que le panneau lui-même n'est pas
  // affiché (correctif 2026-08-24, 2e itération) : sans ce garde-fou combiné, activer "Agrandir"
  // puis effacer la sélection laisserait la grille en une seule colonne et le contenu principal
  // masqué alors qu'aucun panneau ne resterait affiché pour justifier l'un ou l'autre.
  const panneauElargiActif = panneauElargi && selectionIndicateurs.size > 0;

  // Active `code` en retirant d'abord son opposé exclusif s'il y en a un et qu'il est
  // actuellement sélectionné (voir PAIRES_INDICATEURS_EXCLUSIFS plus haut) — seul l'AJOUT déclenche
  // cette exclusion ; désélectionner `code` (déjà actif) n'a aucun effet sur son opposé.
  function basculerIndicateur(code) {
    setSelectionIndicateurs((precedent) => {
      const suivant = new Set(precedent);
      if (suivant.has(code)) {
        suivant.delete(code);
      } else {
        const paire = PAIRES_INDICATEURS_EXCLUSIFS.find((p) => p.includes(code));
        const oppose = paire?.find((c) => c !== code);
        if (oppose) suivant.delete(oppose);
        suivant.add(code);
      }
      return suivant;
    });
  }

  const postesDisponibles = useMemo(() => {
    if (typePoste === 'bureau') return POSTES_BUREAU;
    if (typePoste === 'hotel') return POSTES_HOTEL;
    return [...POSTES_BUREAU, ...POSTES_HOTEL];
  }, [typePoste]);

  // Le filtre poste devient incohérent si l'entité change entretemps (ex. "cafetier" alors qu'on
  // repasse sur Tertiaire) — réinitialisé plutôt que laissé sur une valeur que le sélecteur
  // n'affiche plus.
  useEffect(() => {
    if (poste && !postesDisponibles.includes(poste)) setPoste('');
  }, [postesDisponibles, poste]);

  // Dérivé de façon SYNCHRONE (pas seulement via l'effet ci-dessus, qui ne réinitialise `poste`
  // qu'au rendu suivant) : sur le rendu où `typePoste` vient de changer, `poste` peut encore
  // porter la valeur incompatible de l'entité précédente pendant un instant — sans cette valeur
  // dérivée, les appels API ci-dessous (effets suivants, mêmes dépendances) partiraient avec cette
  // combinaison typePoste/poste incohérente le temps d'un aller-retour réseau inutile, avant que
  // l'effet de réinitialisation ne rattrape `poste` au rendu suivant. `posteEffectif` élimine cette
  // fenêtre : jamais transmis au back tant qu'il ne correspond pas à `postesDisponibles`.
  const posteEffectif = poste && postesDisponibles.includes(poste) ? poste : '';

  // Même raisonnement pour un segment de répartition par poste sélectionné ('poste:<code>') :
  // si le typePoste filtré ne propose plus ce poste, sa sélection n'a plus de sens (le segment
  // correspondant a d'ailleurs disparu du graphique). 'poste_non_specifie' (barre "Non spécifié")
  // suit la même logique dès qu'un filtre poste OU typePoste est actif : le back-end court-circuite
  // alors cette catégorie à 0 (voir statistiquesRepository.compterEvaluationsSansPoste/
  // listerEvaluationsSansPosteDossiers — ces évaluations n'ont par définition aucun poste connu à
  // comparer au filtre), la barre disparaît donc aussi du graphique dans ce cas.
  useEffect(() => {
    setSelectionIndicateurs((precedent) => {
      let modifie = false;
      const suivant = new Set(precedent);
      for (const code of suivant) {
        const posteDevenuIndisponible =
          code.startsWith(PREFIXE_POSTE) && !postesDisponibles.includes(code.slice(PREFIXE_POSTE.length));
        const nonSpecifieDevenuIndisponible = code === 'poste_non_specifie' && (typePoste || poste);
        if (posteDevenuIndisponible || nonSpecifieDevenuIndisponible) {
          suivant.delete(code);
          modifie = true;
        }
      }
      return modifie ? suivant : precedent;
    });
  }, [postesDisponibles, typePoste, poste]);

  useEffect(() => {
    let annule = false;
    setChargement(true);
    setErreur(null);
    obtenirIndicateursKpi({
      dateDebut: periode.dateDebut,
      dateFin: periode.dateFin,
      typePoste: typePoste || undefined,
      poste: posteEffectif || undefined,
    })
      .then((valeur) => {
        if (!annule) setIndicateurs(valeur);
      })
      .catch((erreurRequete) => {
        if (!annule) {
          setErreur(erreurRequete.response?.data?.erreur ?? 'Impossible de récupérer les indicateurs.');
        }
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, [periode, typePoste, posteEffectif]);

  // Tableau consolidé : re-fetché à chaque changement de sélection OU de filtres (période/poste/
  // typePoste) — les dossiers listés doivent toujours correspondre aux mêmes critères que les
  // chiffres affichés sur les cartes/graphiques au même instant. Sélection vide : pas d'appel
  // réseau, juste une liste vide (aucune sélection ne peut logiquement rien renvoyer).
  useEffect(() => {
    if (selectionIndicateurs.size === 0) {
      setDossiersSelectionnes([]);
      setErreurTableau(null);
      return;
    }
    let annule = false;
    setChargementTableau(true);
    setErreurTableau(null);
    listerDossiersParIndicateurs({
      dateDebut: periode.dateDebut,
      dateFin: periode.dateFin,
      typePoste: typePoste || undefined,
      poste: posteEffectif || undefined,
      indicateurs: selectionIndicateurs,
    })
      .then((valeur) => {
        if (!annule) setDossiersSelectionnes(valeur);
      })
      .catch((erreurRequete) => {
        if (!annule) {
          setErreurTableau(erreurRequete.response?.data?.erreur ?? 'Impossible de récupérer le détail des dossiers.');
        }
      })
      .finally(() => {
        if (!annule) setChargementTableau(false);
      });
    return () => {
      annule = true;
    };
  }, [selectionIndicateurs, periode, typePoste, posteEffectif]);

  // Rafraîchissement automatique : rejoue les deux fetches ci-dessus avec les
  // filtres COURANTS (fermeture sur periode/typePoste/posteEffectif/selectionIndicateurs, toujours
  // à jour via callbackRef, voir useRafraichissementAuto.js) — silencieux, ne touche jamais
  // chargement/chargementTableau pour éviter un flash de "Chargement…" toutes les 45s. Le tableau
  // consolidé n'est rejoué que si une sélection est active, même garde que l'effet ci-dessus.
  useRafraichissementAuto(() => {
    obtenirIndicateursKpi({
      dateDebut: periode.dateDebut,
      dateFin: periode.dateFin,
      typePoste: typePoste || undefined,
      poste: posteEffectif || undefined,
    })
      .then(setIndicateurs)
      .catch(() => {});

    if (selectionIndicateurs.size > 0) {
      listerDossiersParIndicateurs({
        dateDebut: periode.dateDebut,
        dateFin: periode.dateFin,
        typePoste: typePoste || undefined,
        poste: posteEffectif || undefined,
        indicateurs: selectionIndicateurs,
      })
        .then(setDossiersSelectionnes)
        .catch(() => {});
    }
  });

  // Session sans objet à vérifier ici (RouteProtegee, App.jsx, redirige déjà vers /connexion avant
  // même de monter cette page en l'absence de session) — `!utilisateur` ne couvre plus qu'un très
  // bref instant où le useSession() PROPRE à cette page (ci-dessus) n'a pas encore résolu le sien
  // (deuxième appel indépendant, même patron que le reste du back-office — voir
  // BoutonNouvelleInscription.jsx), jamais un visiteur réellement non connecté.
  if (chargementSession || !utilisateur) {
    return (
      <PageBackOffice>
        <p>Chargement de la session…</p>
      </PageBackOffice>
    );
  }

  // `code` : indicateur associé à ce segment (voir LIBELLES_INDICATEURS/basculerIndicateur plus
  // haut) — toujours présent, y compris pour "Non spécifié" (posteCode null, code
  // 'poste_non_specifie' plutôt que le préfixe 'poste:<code>', voir plus bas : "aucun poste
  // renseigné" n'est pas un poste parmi POSTES_BUREAU/POSTES_HOTEL).
  // nom: 'Validé'/'Invalidé' (renommé le 2026-09-14, demande utilisateur — remplace 'Réussis'/
  // 'Ratés') : reprend EXACTEMENT le libellé déjà utilisé pour ce même verdict ailleurs sur cet
  // écran (LIBELLES_DATES_CLES.verdict_valide/verdict_invalide, badge "Validé : date"/"Invalidé :
  // date" de la colonne "Indicateurs"/"Dates clés", TableauDossiersSelectionnes.jsx) — deux
  // libellés distincts pour le même événement n'avaient pas de raison d'être. Seul `nom` change
  // (légende + nom affiché dans le Tooltip, voir nameKey="nom" sur le <Pie> plus bas) : `code`
  // (sélection/clic, basculerIndicateur), `fill` (couleur) et `total` (calcul) restent inchangés.
  // Titre du graphique aligné dans un second temps :
  // "Tests réussis vs ratés" → "Tests validés vs invalidés" (voir <h2>/ErrorBoundary titre plus
  // bas), même portée limitée au libellé, aucun changement de calcul/couleur/clic.
  const donneesVerdicts = indicateurs
    ? [
        { nom: 'Validé', total: indicateurs.verdicts.valide, code: 'verdict_valide', fill: COULEURS_VERDICT.verdict_valide },
        { nom: 'Invalidé', total: indicateurs.verdicts.invalide, code: 'verdict_invalide', fill: COULEURS_VERDICT.verdict_invalide },
      ]
    : [];
  const formatteurTooltipVerdicts = creerFormatteurTooltipCamembert(donneesVerdicts);

  const donneesOrientations = indicateurs
    ? [
        {
          nom: 'Envoi en formation',
          total: indicateurs.orientations.envoi_formation,
          code: 'orientation_envoi_formation',
          fill: COULEURS_ORIENTATION.orientation_envoi_formation,
        },
        {
          nom: 'Prêt à l’embauche',
          total: indicateurs.orientations.pret_embauche,
          code: 'orientation_pret_embauche',
          fill: COULEURS_ORIENTATION.orientation_pret_embauche,
        },
      ]
    : [];
  const formatteurTooltipOrientations = creerFormatteurTooltipCamembert(donneesOrientations);

  const donneesRepartitionPoste = indicateurs
    ? indicateurs.repartitionParPoste.parEvaluation.map((ligne) => ({
        nom: libellePoste(ligne.posteCode),
        total: ligne.nbEvaluations,
        code: ligne.posteCode ? `${PREFIXE_POSTE}${ligne.posteCode}` : 'poste_non_specifie',
        fill: ligne.posteCode ? (COULEURS_POSTE[ligne.posteCode] ?? COULEUR_POSTE_NON_SPECIFIE) : COULEUR_POSTE_NON_SPECIFIE,
      }))
    : [];

  return (
    <PageBackOffice>
      <div className="indicateurs">
        <header className="indicateurs__entete">
          {/* Devant le titre, sur la même ligne — aucun autre
              écran back-office n'a ce patron précis (voir HistoriqueEvaluations.jsx, titre+bouton
              empilés en colonne, ou Validation.jsx/Planification.jsx, bouton sous le header aligné
              à droite) : .indicateurs__titre-bloc reste local à cette page. */}
          <div className="indicateurs__titre-bloc">
            {/* Bouton "Retour backoffice recruteur" retiré (refonte navigation, 2026-08-17) :
                couvert par le lien "Back-office recruteur" de la barre de navigation commune,
                voir BarreNavigation.jsx (montée dans PageBackOffice.jsx). */}
            <h1>Tableau de bord - Indicateurs</h1>
          </div>
          <EnTeteBackOffice />
        </header>

        <div className="indicateurs__filtres">
          <label className="indicateurs__filtre">
            <span>Du</span>
            <input
              type="date"
              value={periode.dateDebut}
              max={periode.dateFin}
              onChange={(evenement) => setPeriode((precedent) => ({ ...precedent, dateDebut: evenement.target.value }))}
            />
          </label>
          <label className="indicateurs__filtre">
            <span>Au</span>
            <input
              type="date"
              value={periode.dateFin}
              min={periode.dateDebut}
              onChange={(evenement) => setPeriode((precedent) => ({ ...precedent, dateFin: evenement.target.value }))}
            />
          </label>
          {!estInspecteurHotellerie && (
          <label className="indicateurs__filtre">
            <span>Entité</span>
            <select value={typePoste} onChange={(evenement) => setTypePoste(evenement.target.value)}>
              <option value="">Toutes (Hôtellerie + Tertiaire)</option>
              <option value="hotel">Hôtellerie</option>
              <option value="bureau">Tertiaire</option>
            </select>
          </label>
          )}
          <label className="indicateurs__filtre">
            <span>Poste</span>
            <select value={poste} onChange={(evenement) => setPoste(evenement.target.value)}>
              <option value="">{libelleOptionTousLesPostes(typePoste)}</option>
              {postesDisponibles.map((code) => (
                <option key={code} value={code}>
                  {libellePoste(code)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {chargement && <p>Chargement des indicateurs…</p>}
        {erreur && <p role="alert">{erreur}</p>}

        {/* Mode dégradé du back-office — les tuiles/graphiques/tableau
            partagent un seul fetch (obtenirIndicateursKpi, sauf le tableau consolidé qui a le
            sien, listerDossiersParIndicateurs) mais restent des sous-arbres de RENDU distincts :
            une ErrorBoundary par section limite un plantage de rendu (donnée inattendue, bug
            recharts...) à cette seule section plutôt qu'à toute la page. L'état interactif partagé
            (selectionIndicateurs, qui relie tuiles/segments/tableau) vit dans ce composant parent,
            jamais dans une section : le déclenchement d'une limite n'y touche donc pas, les
            sections encore valides restent pleinement interactives. */}
        {!chargement && !erreur && indicateurs && (
          <>
            {/* Empilement vertical simple (audit 2026-08-31, décision utilisateur : le panneau
                "Dossiers sélectionnés" passe de colonne latérale fixe à pleine largeur SOUS les
                graphiques, voir Indicateurs.css) — plus de grille à deux colonnes ici : l'ordre du
                JSX (contenu-principal puis panneau) suffit à lui seul à placer le panneau juste en
                dessous, .indicateurs__disposition ne fait plus qu'empiler ses deux enfants avec un
                `gap`. */}
            <div className="indicateurs__disposition">
            {/* Masqué entièrement (display: none, pas une simple diminution d'opacité) en mode
                agrandi : laisse le panneau "Dossiers sélectionnés" juste en dessous occuper toute
                la hauteur utile de la page plutôt que de rester coincé sous des graphiques qui ne
                servent plus à rien une fois le tableau consulté en détail. */}
            <div
              className={`indicateurs__contenu-principal${panneauElargiActif ? ' indicateurs__contenu-principal--masque' : ''}`}
            >
            <ErrorBoundary titre="Indicateurs (tuiles)">
            <div className="indicateurs__tuiles">
              {/* Bouton plutôt qu'un <div> statique : sélection multiple des cartes (voir
                  basculerIndicateur plus haut), accessible au clavier sans rien ajouter. Chaque
                  carte reste indépendamment sélectionnable (pas un groupe radio) : rien n'empêche
                  de croiser "Inscrits" et "Envoyé en test" dans le tableau consolidé.
                  Modificateur `indicateurs__tuile--<variante>` (voir Indicateurs.css) : une couleur
                  distincte par tuile, décision utilisateur 2026-08-11 — réutilise EXACTEMENT les
                  variantes déjà attribuées à ces mêmes codes dans VARIANTE_PAR_INDICATEUR plus haut
                  (badges de la colonne "Indicateurs"), pour que la couleur d'une tuile et celle de
                  son badge restent cohérentes partout sur l'écran. Exception : `delai_formation`
                  prend `violet` ici (pas `attente`, son variante de badge) — les deux tuiles de
                  délai partagent la même variante `attente` côté badge, ce qui les aurait rendues
                  indiscernables l'une de l'autre en tuile ; `violet` n'est déjà utilisée par aucune
                  autre tuile (même exception, reprise telle quelle, que l'ancienne tuile
                  `delai_test_verdict` qu'elle remplace ici — audit tableau de bord 2026-08-31,
                  point d'audit, corrigé le 2026-09-01). */}
              <button
                type="button"
                className={`indicateurs__tuile indicateurs__tuile--neutre${selectionIndicateurs.has('inscrits') ? ' indicateurs__tuile--active' : ''}`}
                aria-pressed={selectionIndicateurs.has('inscrits')}
                onClick={() => basculerIndicateur('inscrits')}
              >
                <span className="indicateurs__tuile-valeur">{indicateurs.inscrits.total}</span>
                {/* "Inscriptions" (pas "Inscrits", audit 2026-08-24) : le workflow v5 a donné au
                    statut `nouveau` le libellé exact "Inscrit" (voir workflow.config.json) — cette
                    tuile reste un TOTAL DE COHORTE (tous statuts confondus sur la période, voir
                    compterInscrits, statistiquesRepository.js), pas "combien de dossiers sont
                    actuellement au statut Inscrit" ; même collision, même principe de correction
                    que `conversion` ("Converti" → "Retenu", clarification du 2026-08-11), logique
                    de calcul strictement inchangée. */}
                <span className="indicateurs__tuile-libelle">Inscriptions</span>
              </button>
              <button
                type="button"
                className={`indicateurs__tuile indicateurs__tuile--bleu${selectionIndicateurs.has('envoyes_en_test') ? ' indicateurs__tuile--active' : ''}`}
                aria-pressed={selectionIndicateurs.has('envoyes_en_test')}
                onClick={() => basculerIndicateur('envoyes_en_test')}
              >
                <span className="indicateurs__tuile-valeur">{indicateurs.envoyesEnTest.total}</span>
                <span className="indicateurs__tuile-libelle">Envoyé en test</span>
              </button>
              <button
                type="button"
                className={`indicateurs__tuile indicateurs__tuile--attente${selectionIndicateurs.has('delai_inscription_test') ? ' indicateurs__tuile--active' : ''}`}
                aria-pressed={selectionIndicateurs.has('delai_inscription_test')}
                onClick={() => basculerIndicateur('delai_inscription_test')}
              >
                <span className="indicateurs__tuile-valeur">
                  {indicateurs.delaisMoyens.inscriptionVersTestPlanifie.moyenneJours ?? '-'} j
                </span>
                <span className="indicateurs__tuile-libelle">Délai moyen Inscription → Envoi en test</span>
                <span className="indicateurs__tuile-precision">Moyenne, jours écoulés</span>
              </button>
              <button
                type="button"
                className={`indicateurs__tuile indicateurs__tuile--violet${selectionIndicateurs.has('delai_formation') ? ' indicateurs__tuile--active' : ''}`}
                aria-pressed={selectionIndicateurs.has('delai_formation')}
                onClick={() => basculerIndicateur('delai_formation')}
              >
                <span className="indicateurs__tuile-valeur">
                  {indicateurs.delaisMoyens.formation.moyenneJours ?? '-'} j
                </span>
                <span className="indicateurs__tuile-libelle">Délai moyen Test → Formation</span>
                <span className="indicateurs__tuile-precision">Moyenne, jours écoulés</span>
              </button>
            </div>
            </ErrorBoundary>

            {/* Section "Effectifs par statut" SUPPRIMÉE (audit 2026-09-14, demande utilisateur,
                confirmée par audit préalable) : ses 4 cartes n'ont plus lieu d'être en l'état —
                "Validé - prêt à l'embauche"/"Formation non validée"/"Embauché" étaient de purs
                doublons des badges déjà présents sur "Dossiers candidats" (même calcul exact,
                statut courant, compterParStatut côté back — voir
                CODES_STATUTS_EFFECTIF_COURANT_ACCECIT, statistiquesService.js). "Test réalisé" avait
                d'abord été RELOCALISÉE ici (voir historique git) puis RETIRÉE à son tour le même
                jour (demande utilisateur explicite, retrait purement visuel) — plus aucune carte de
                cet ex-écran, sous quelque forme que ce soit. `indicateurs.effectifsParStatut` reste
                calculé côté back (statistiquesService.js, hors périmètre de cette demande — aucun
                changement de calcul) mais n'est plus lu nulle part sur cet écran. */}

            {/* "Volumétrie sur la période" (audit dashboard 2026-09-02, décision affinée le même
                jour ; rendue cliquable/filtrante le même jour, 2e passe — jusque-là de simples
                compteurs ; "Formations non validées" ajoutée le 2026-09-14 ; "Prêt à l'embauche" et
                "Test Invalidé" ajoutées le 2026-09-19) — 4 des 6 cartes de CARTES_VOLUMETRIE_ACCECIT
                comptent "combien de FOIS cet événement s'est produit" (charge de travail réelle,
                JAMAIS dédupliquée par dossier : un dossier retesté/reformé compte plusieurs fois,
                voir statistiquesRepository.listerOccurrencesHistorique/listerOccurrencesFormationValidee)
                — "Prêt à l'embauche" et "Test Invalidé" font exception (dossiers DISTINCTS, même
                critère que les camemberts plus bas, voir leur commentaire dans
                CARTES_VOLUMETRIE_ACCECIT ci-dessus), affichées avec le même format de carte malgré
                cette nuance de nature (décision utilisateur, cohérence visuelle de la section
                privilégiée). Style visuellement distinct des tuiles KPI au-dessus (bordure en
                tirets, voir .indicateurs__tuiles--
                volumetrie/.indicateurs__tuile--volumetrie, Indicateurs.css) : le sous-texte
                explicatif qui accompagnait initialement ce style a été retiré (décision utilisateur,
                2e passe), la bordure en tirets reste seule porteuse de la distinction "occurrences
                brutes" pour les 4 cartes concernées.
                Générées par CARTES_VOLUMETRIE_ACCECIT (liste éditoriale, voir son commentaire plus
                haut), pas les boutons recopiés en dur. `<button>`, MÊME mécanisme de sélection/
                filtrage que le reste de l'écran (basculerIndicateur) — code cliquable
                '${PREFIXE_VOLUMETRIE}<code>' résolu génériquement côté back (voir PREFIXE_VOLUMETRIE)
                SAUF si `codeIndicateur` est fourni explicitement par la carte (voir "Prêt à
                l'embauche"/"Test Invalidé" ci-dessus, qui réutilisent chacune un code déjà existant
                plutôt que d'en générer un nouveau) — un dossier avec plusieurs occurrences
                n'apparaît qu'UNE FOIS dans le tableau consolidé (dédup côté back), mais sa colonne
                "Dates clés" liste TOUTES ses occurrences (voir TableauDossiersSelectionnes.jsx,
                dossier.occurrencesVolumetrie) : il est normal et attendu que le nombre affiché ici
                (occurrences) soit supérieur ou égal au nombre de lignes du tableau (dossiers
                distincts), pas une incohérence à corriger — sans objet pour "Prêt à l'embauche"/
                "Test Invalidé", déjà en dossiers distincts.
                `valeur` : accesseur explicite si fourni (voir "Prêt à l'embauche"/"Test Invalidé"
                ci-dessus, qui lisent respectivement indicateurs.orientations.pret_embauche et
                indicateurs.verdicts.invalide plutôt que indicateurs.volumetrieParStatut, des
                agrégats backend distincts), repli sur indicateurs.volumetrieParStatut[code] sinon
                (les 4 cartes "classiques"). `--compacte` (Indicateurs.css) : ces cartes n'ont
                qu'un libellé + un nombre (pas de précision secondaire comme les deux tuiles de délai
                plus haut), plus resserrées pour absorber cette rangée sans repousser le reste de la
                page.
                "Test réalisé" (effectif dédupliqué, ex-"Effectifs par statut") a un temps cohabité
                ici (voir historique git) avant d'être retirée le même jour (demande utilisateur
                explicite, retrait purement visuel — code/calcul jamais touchés entre-temps) : cette
                ligne ne porte donc plus QUE les cartes ci-dessous, générées par
                CARTES_VOLUMETRIE_ACCECIT, sans bouton supplémentaire recopié en dur. */}
            <ErrorBoundary titre="Indicateurs (volumétrie sur la période)">
            <div className="indicateurs__section-volumetrie">
              <h2 className="indicateurs__sous-titre">Volumétrie sur la période</h2>
              <div className="indicateurs__tuiles indicateurs__tuiles--volumetrie">
                {CARTES_VOLUMETRIE_ACCECIT.map(({ code, libelle, variante, codeIndicateur: codeIndicateurPersonnalise, valeur }) => {
                  const codeIndicateur = codeIndicateurPersonnalise ?? `${PREFIXE_VOLUMETRIE}${code}`;
                  const valeurAffichee = valeur ? valeur(indicateurs) : indicateurs.volumetrieParStatut[code];
                  return (
                    <button
                      type="button"
                      key={code}
                      className={`indicateurs__tuile indicateurs__tuile--volumetrie indicateurs__tuile--compacte indicateurs__tuile--${variante}${selectionIndicateurs.has(codeIndicateur) ? ' indicateurs__tuile--active' : ''}`}
                      aria-pressed={selectionIndicateurs.has(codeIndicateur)}
                      onClick={() => basculerIndicateur(codeIndicateur)}
                    >
                      <span className="indicateurs__tuile-valeur">{valeurAffichee}</span>
                      <span className="indicateurs__tuile-libelle">{libelle}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            </ErrorBoundary>

            <div className="indicateurs__graphiques">
              <ErrorBoundary titre="Tests validés vs invalidés">
              <section className="indicateurs__graphique indicateurs__graphique--camembert indicateurs__graphique--verdicts">
                <h2>Tests validés vs invalidés</h2>
                {donneesVerdicts.every((entree) => entree.total === 0) ? (
                  <p className="indicateurs__vide">Aucun verdict sur la période.</p>
                ) : (
                  <div ref={suiviCurseurVerdicts.conteneurRef}>
                    <ResponsiveContainer width="100%" height={185}>
                      <PieChart>
                        {/* cx décalé vers la droite du centre (pas 50%, ni le 38% initial — voir
                            historique) : avec la grille corrigée à deux colonnes fixes
                            (.indicateurs__graphiques, Indicateurs.css), ce cadre est maintenant
                            assez large pour qu'un centrage trop à gauche laisse un grand vide entre
                            le bord droit du camembert et la légende (align="right", voir
                            ci-dessous) — 45% rapproche les deux plutôt que de les laisser à leurs
                            extrémités respectives avec un vide entre les deux. outerRadius relevé à
                            "92%" (labels désormais À L'INTÉRIEUR de la part — labelPartCamembert
                            plus haut — donc plus besoin de marge extérieure pour un label+ligne de
                            rappel) : un camembert plus grand comble aussi une partie de ce vide par
                            lui-même. height du ResponsiveContainer réduite à 185 (audit 2026-08-31,
                            décision utilisateur : la page doit tenir sans défilement sur un écran
                            1080p — 320 restait disproportionné pour seulement 2 parts par camembert)
                            : outerRadius restant un pourcentage, le camembert rétrécit
                            proportionnellement sans autre changement ici ; la légende (layout
                            vertical, voir <Legend> plus bas) reste lisible à cette taille, seuls
                            deux libellés courts à afficher. */}
                        <Pie
                          data={donneesVerdicts}
                          dataKey="total"
                          nameKey="nom"
                          cx="45%"
                          outerRadius="92%"
                          label={labelPartCamembert}
                          labelLine={false}
                          onMouseEnter={suiviCurseurVerdicts.gererSurvol}
                          onMouseMove={suiviCurseurVerdicts.gererSurvol}
                        >
                          {donneesVerdicts.map((entree) => (
                            // Segment cliquable (voir basculerIndicateur) : opacité réduite pour les
                            // segments non sélectionnés dès qu'AU MOINS UN segment (toutes cartes/
                            // graphiques confondus) est sélectionné, contour renforcé sur les
                            // segments actifs — même logique de mise en évidence que les tuiles
                            // ci-dessus (classe --active), adaptée aux props recharts (pas de
                            // className sur <Cell>). `fill` porté par la donnée elle-même (voir
                            // donneesVerdicts, COULEURS_VERDICT) plutôt qu'indexé par position :
                            // couleur stable par indicateur, pas par rang d'affichage.
                            <Cell
                              key={entree.nom}
                              fill={entree.fill}
                              cursor="pointer"
                              opacity={selectionIndicateurs.size === 0 || selectionIndicateurs.has(entree.code) ? 1 : 0.35}
                              stroke={selectionIndicateurs.has(entree.code) ? '#1a1a1a' : undefined}
                              strokeWidth={selectionIndicateurs.has(entree.code) ? 2 : undefined}
                              onClick={() => basculerIndicateur(entree.code)}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={STYLE_TOOLTIP_GRAPHIQUE}
                          itemStyle={STYLE_TOOLTIP_ITEM_CAMEMBERT}
                          position={suiviCurseurVerdicts.position ?? undefined}
                          formatter={formatteurTooltipVerdicts}
                        />
                        {/* Légende en bas à droite du cadre (pas au centre vertical) : reste posée
                            dans le même coin que la légende repositionnée à droite (voir plus haut),
                            sans couper la moitié supérieure du camembert en deux zones visuelles
                            distinctes — le bloc légende se lit comme une seule unité avec le
                            camembert au lieu de flotter au milieu. */}
                        <Legend layout="vertical" align="right" verticalAlign="bottom" />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </section>
              </ErrorBoundary>

              <ErrorBoundary titre="Formation vs prêt à l’embauche">
              <section className="indicateurs__graphique indicateurs__graphique--camembert indicateurs__graphique--orientations">
                <h2>Formation vs prêt à l’embauche</h2>
                {donneesOrientations.every((entree) => entree.total === 0) ? (
                  <p className="indicateurs__vide">Aucune orientation sur la période.</p>
                ) : (
                  <div ref={suiviCurseurOrientations.conteneurRef}>
                    <ResponsiveContainer width="100%" height={185}>
                      <PieChart>
                        {/* Même camembert que "Tests validés vs invalidés" ci-dessus — taille et style
                            volontairement identiques (cx, outerRadius, label, légende) : cohérence
                            visuelle entre les deux graphiques du même écran, voir CLAUDE.md. */}
                        <Pie
                          data={donneesOrientations}
                          dataKey="total"
                          nameKey="nom"
                          cx="45%"
                          outerRadius="92%"
                          label={labelPartCamembert}
                          labelLine={false}
                          onMouseEnter={suiviCurseurOrientations.gererSurvol}
                          onMouseMove={suiviCurseurOrientations.gererSurvol}
                        >
                          {donneesOrientations.map((entree) => (
                            <Cell
                              key={entree.nom}
                              fill={entree.fill}
                              cursor="pointer"
                              opacity={selectionIndicateurs.size === 0 || selectionIndicateurs.has(entree.code) ? 1 : 0.35}
                              stroke={selectionIndicateurs.has(entree.code) ? '#1a1a1a' : undefined}
                              strokeWidth={selectionIndicateurs.has(entree.code) ? 2 : undefined}
                              onClick={() => basculerIndicateur(entree.code)}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={STYLE_TOOLTIP_GRAPHIQUE}
                          itemStyle={STYLE_TOOLTIP_ITEM_CAMEMBERT}
                          position={suiviCurseurOrientations.position ?? undefined}
                          formatter={formatteurTooltipOrientations}
                        />
                        <Legend layout="vertical" align="right" verticalAlign="bottom" />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </section>
              </ErrorBoundary>

              <ErrorBoundary titre="Répartition par poste">
              <section className="indicateurs__graphique indicateurs__graphique--large">
                <h2>Répartition par poste (évaluations distinctes)</h2>
                {donneesRepartitionPoste.length === 0 ? (
                  <p className="indicateurs__vide">Aucune évaluation sur la période.</p>
                ) : (
                  // height réduite à 175 (audit 2026-08-31, décision utilisateur : la page doit
                  // tenir sans défilement sur un écran 1080p, comme les deux camemberts ci-dessus)
                  // — XAxis height=80 (espace réservé aux libellés de poste inclinés) inchangée,
                  // toujours comprise dans ce total, donc toujours assez de place pour les libellés
                  // les plus longs ("Femme/Valet de chambre") sans les couper.
                  <ResponsiveContainer width="100%" height={175}>
                    <BarChart data={donneesRepartitionPoste}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="nom" interval={0} angle={-20} textAnchor="end" height={80} />
                      <YAxis allowDecimals={false} />
                      <Tooltip contentStyle={STYLE_TOOLTIP_GRAPHIQUE} itemStyle={STYLE_TOOLTIP_ITEM_GRAPHIQUE} />
                      {/* <Cell> par barre (comme pour les camemberts ci-dessus) : chaque barre a
                          son propre indicateur, "poste:<code>" ou 'poste_non_specifie' pour la
                          barre "Non spécifié" (voir donneesRepartitionPoste) — toutes cliquables
                          de façon identique, aucun cas particulier ici. `fill` du <Bar> gardé comme
                          repli (jamais utilisé en pratique : chaque barre a son propre <Cell fill>,
                          voir COULEURS_POSTE) plutôt qu'une seule teinte pour toutes les barres. */}
                      <Bar dataKey="total" fill={COULEUR_POSTE_NON_SPECIFIE}>
                        {donneesRepartitionPoste.map((entree) => (
                          <Cell
                            key={entree.nom}
                            fill={entree.fill}
                            cursor="pointer"
                            opacity={selectionIndicateurs.size === 0 || selectionIndicateurs.has(entree.code) ? 1 : 0.35}
                            stroke={selectionIndicateurs.has(entree.code) ? '#1a1a1a' : undefined}
                            strokeWidth={selectionIndicateurs.has(entree.code) ? 2 : undefined}
                            onClick={() => basculerIndicateur(entree.code)}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </section>
              </ErrorBoundary>
            </div>
            </div>

            {/* Panneau "Dossiers sélectionnés" — uniquement visible dès qu'au moins une
                carte/segment est sélectionné (comportement inchangé) : garde la sélection visible
                pendant qu'on consulte le détail, voir l'audit préalable à cette fonctionnalité.
                Repositionné pleine largeur SOUS les graphiques (audit 2026-08-31, décision
                utilisateur — remplace la colonne latérale fixe du 2026-08-24, voir
                .indicateurs__disposition ci-dessus) : purement une question de mise en page CSS,
                aucun changement à la sélection de dossiers, au bouton "Effacer la sélection", au
                bouton d'agrandissement, au défilement horizontal du tableau ni aux liens vers les
                dossiers, tous inchangés (voir Indicateurs.css pour le détail du repositionnement). */}
            {selectionIndicateurs.size > 0 && (
              <aside
                className={`indicateurs__panneau-lateral${panneauElargi ? ' indicateurs__panneau-lateral--elargi' : ''}`}
              >
                <ErrorBoundary titre="Dossiers sélectionnés">
                <section className="indicateurs__tableau-consolide">
                  <div className="indicateurs__tableau-consolide-entete">
                    <h2>Dossiers sélectionnés ({selectionIndicateurs.size} indicateur(s))</h2>
                    <div className="indicateurs__tableau-consolide-actions">
                      {/* Icône seule (»/«) + aria-label explicite : élargit le panneau (280px ->
                          480px, voir Indicateurs.css) pour afficher plus de colonnes/détails par
                          ligne sans recharger la page ni masquer le reste du tableau de bord — un
                          second clic revient à la largeur par défaut. Purement visuel (CSS), la
                          liste de dossiers/le filtre par indicateurs restent inchangés par ce
                          bouton. */}
                      <button
                        type="button"
                        className="indicateurs__bouton-agrandir"
                        aria-expanded={panneauElargi}
                        aria-label={panneauElargi ? 'Réduire le panneau' : 'Agrandir le panneau'}
                        title={panneauElargi ? 'Réduire le panneau' : 'Agrandir le panneau'}
                        onClick={() => setPanneauElargi((precedent) => !precedent)}
                      >
                        {panneauElargi ? '«' : '»'}
                      </button>
                      {/* Classe --effacer (distinction visuelle, audit 2026-08-25) : même intention
                          que sur Dossiers candidats/Suivi des tests (TableauDeBordAccueil.css/
                          Planification.css) — une réinitialisation d'affichage doit se distinguer
                          visuellement, ici du bouton d'agrandissement voisin. Teinte grise/ardoise
                          (fond clair ici, pas de dégradé back-office) plutôt que le fantôme blanc
                          translucide des deux autres pages, voir Indicateurs.css. */}
                      <button
                        type="button"
                        className="indicateurs__bouton-effacer-selection"
                        onClick={() => setSelectionIndicateurs(new Set())}
                      >
                        Effacer la sélection
                      </button>
                    </div>
                  </div>
                  {chargementTableau && <p>Chargement des dossiers…</p>}
                  {erreurTableau && <p role="alert">{erreurTableau}</p>}
                  {!chargementTableau && !erreurTableau && (
                    <TableauDossiersSelectionnes
                      dossiers={dossiersSelectionnes}
                      libellePoste={libellePoste}
                      libelleIndicateur={libelleIndicateur}
                      varianteIndicateur={varianteIndicateur}
                      varianteStatut={varianteStatut}
                      estIndicateurPoste={estIndicateurPoste}
                      libelleDateCle={libelleDateCle}
                      varianteDateCle={varianteDateCle}
                      ordreCanoniqueIndicateurs={ORDRE_CANONIQUE_INDICATEURS}
                    />
                  )}
                </section>
                </ErrorBoundary>
              </aside>
            )}
            </div>
          </>
        )}
      </div>
    </PageBackOffice>
  );
}
