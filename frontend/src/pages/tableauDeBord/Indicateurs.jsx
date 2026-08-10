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
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import { obtenirIndicateursKpi, listerDossiersParIndicateurs } from '../../services/statistiqueService';
import TableauDossiersSelectionnes from './TableauDossiersSelectionnes';
import './Indicateurs.css';

// Même mapping (nettoyé des résidus workflow v3/hérité) que TableauDeBordAccueil.jsx/
// Backoffice.jsx — dupliqué plutôt que partagé (voir CLAUDE.md conventions du projet), sert ici
// à la colonne "Statut" du tableau consolidé (voir plus bas, TableauDossiersSelectionnes).
const VARIANTE_PAR_CODE_STATUT_ACCECIT = {
  nouveau: 'neutre',
  en_attente_pieces: 'attente',
  en_attente_verification: 'attente',
  test_planifie: 'bleu',
  test_non_realise: 'alerte',
  invalide: 'echec',
  valide_envoi_formation: 'succes',
  valide_pret_embauche: 'vert-clair',
};
function varianteStatut(code) {
  return VARIANTE_PAR_CODE_STATUT_ACCECIT[code] ?? 'neutre';
}

// Codes des indicateurs cliquables des cartes/camemberts (statiques — la répartition par poste,
// dynamique, a son propre préfixe 'poste:<code>', voir libelleIndicateur/varianteIndicateur plus
// bas) — mêmes 9 codes que backend/src/core/statistiques/statistiquesService.js
// (CODES_INDICATEURS_STATIQUES), dupliqué plutôt que partagé (voir plus haut).
// Libellés pensés pour rester compréhensibles isolément, sans dépendre du statut affiché juste à
// côté (colonne "Indicateurs" de TableauDossiersSelectionnes.jsx) — un badge peut désormais rester
// visible même quand il est redondant avec ce statut (décision Option A, 2026-08-10 : plus de
// filtrage de redondance, voir TableauDossiersSelectionnes.jsx). `conversion` : "Converti" plutôt
// que "Taux de validation" (repris tel quel de la tuile agrégée, confirmé 2026-08-10) — un dossier
// individuel n'a pas "un taux", ce badge signale son appartenance au numérateur du taux de
// conversion de la période (voir listerDossiersConvertis, statistiquesRepository.js).
// `delai_inscription_test`/`delai_test_verdict` : libellés laissés inchangés (confirmé) — jamais
// ambigus vis-à-vis du statut affiché à côté, contrairement aux indicateurs renommés ci-dessus.
const LIBELLES_INDICATEURS = {
  inscrits: 'Inscrit',
  envoyes_en_test: 'Test envoyé',
  conversion: 'Converti',
  delai_inscription_test: 'Délai inscription → test',
  delai_test_verdict: 'Délai test → verdict',
  verdict_valide: 'Test réussi',
  verdict_invalide: 'Test échoué',
  orientation_envoi_formation: 'Orienté formation',
  orientation_pret_embauche: 'Orienté embauche',
  // Barre "Non spécifié" du graphique de répartition par poste — code statique (pas 'poste:<code>',
  // voir PREFIXE_POSTE/libelleIndicateur plus bas) : "aucun poste renseigné" n'est pas un poste.
  poste_non_specifie: 'Poste non spécifié',
};
// Variantes de badge (StatutBadge) par indicateur — regroupées par famille visuelle : succès/échec
// alignés sur les couleurs déjà utilisées pour les statuts de dossier équivalents (vert pour un
// verdict/orientation positif, rouge pour un verdict négatif), le reste réparti sur les variantes
// restantes pour rester distinguable d'un coup d'œil dans la colonne "Indicateurs" du tableau.
const VARIANTE_PAR_INDICATEUR = {
  inscrits: 'neutre',
  envoyes_en_test: 'bleu',
  conversion: 'dore',
  delai_inscription_test: 'attente',
  delai_test_verdict: 'attente',
  verdict_valide: 'succes',
  verdict_invalide: 'echec',
  orientation_envoi_formation: 'violet',
  orientation_pret_embauche: 'vert-clair',
  // Même variante que les barres 'poste:<code>' (voir varianteIndicateur plus bas) : reste dans
  // la même famille visuelle "répartition par poste" que les autres barres du même graphique.
  poste_non_specifie: 'dore',
};
const PREFIXE_POSTE = 'poste:';

// Catalogue des postes ACCECIT — même valeurs que backend/src/core/dossier/postesConstantes.js,
// dupliqué plutôt que partagé entre front et back (pas de mécanisme de partage de code entre les
// deux dans ce projet, voir les autres pages back-office : Planification.jsx/Backoffice.jsx
// dupliquent déjà leur propre LIBELLES_POSTE_PAR_CODE_ACCECIT).
const POSTES_BUREAU = ['nettoyage', 'vitrerie', 'machiniste', 'chef_equipe', 'autres'];
const POSTES_HOTEL = ['femme_valet_chambre', 'cafetier', 'equipier', 'gouvernant'];

// Libellés des postes — même mapping que Planification.jsx/Backoffice.jsx.
const LIBELLES_POSTE_PAR_CODE_ACCECIT = {
  nettoyage: 'Nettoyage',
  vitrerie: 'Vitrerie',
  machiniste: 'Machiniste',
  chef_equipe: "Chef d'équipe",
  autres: 'Autres',
  femme_valet_chambre: 'Femme/Valet de chambre',
  cafetier: 'Cafétier(ère)',
  equipier: 'Équipier(ère)',
  gouvernant: 'Gouvernant(e)',
};
function libellePoste(code) {
  if (code === null) return 'Non spécifié';
  return LIBELLES_POSTE_PAR_CODE_ACCECIT[code] ?? code;
}

// Libellé de l'option par défaut (value="") du filtre "Poste" — purement affichage, le
// comportement de filtrage reste inchangé (poste vide = aucun filtre poste, scope = l'entité déjà
// sélectionnée via typePoste, voir posteEffectif plus bas). Reflète l'entité choisie dans le
// filtre "Entité" juste au-dessus pour éviter l'ambiguïté "tous les postes" alors qu'un filtre
// Hôtellerie/Tertiaire est déjà actif.
function libelleOptionTousLesPostes(typePosteFiltre) {
  if (typePosteFiltre === 'hotel') return 'Tous les postes Hôtellerie';
  if (typePosteFiltre === 'bureau') return 'Tous les postes Tertiaire';
  return 'Tous les postes';
}

// Un code 'poste:<code>' se traduit via libellePoste ci-dessus (même libellé que la colonne
// "Poste"/le graphique de répartition) plutôt que d'être dupliqué dans LIBELLES_INDICATEURS.
function libelleIndicateur(code) {
  if (code.startsWith(PREFIXE_POSTE)) return libellePoste(code.slice(PREFIXE_POSTE.length));
  return LIBELLES_INDICATEURS[code] ?? code;
}
function varianteIndicateur(code) {
  if (code.startsWith(PREFIXE_POSTE)) return 'dore';
  return VARIANTE_PAR_INDICATEUR[code] ?? 'neutre';
}
// Distingue les deux natures de code portées par `dossier.indicateurs` (voir
// TableauDossiersSelectionnes.jsx, colonne "Indicateurs") : un poste ('poste:<code>' ou
// 'poste_non_specifie', issus du graphique de répartition) n'est pas un indicateur de pilotage au
// même titre que "Inscrits"/"Test réussi"/... — mélangés sans distinction dans la même colonne,
// ils prêtaient à confusion. Pas de renommage de colonne pour autant ("Indicateurs et postes"
// ferait doublon avec la colonne "Poste" déjà présente, décision utilisateur) : seul le style du
// badge (puce grise façon colonne "Poste", voir TableauDossiersSelectionnes.jsx) distingue les
// deux, regroupés séparément dans la même cellule.
function estIndicateurPoste(code) {
  return code.startsWith(PREFIXE_POSTE) || code === 'poste_non_specifie';
}

// Une palette dédiée par graphique (couleurs fixes, PAR CLÉ — jamais par position/index) plutôt
// que la teinte unique cyclée sur les 3 graphiques d'avant : plus agréable à l'œil (chaque
// graphique a sa propre identité visuelle) et surtout stable — colorier par index (voir
// l'ancienne COULEURS_GRAPHIQUE[index % ...]) repeint tous les segments suivants dès qu'un filtre
// change le nombre de postes affichés, ce qui fait "sauter" des couleurs déjà mémorisées par
// l'agent d'un chargement à l'autre. recharts ne lit pas les variables CSS dans ses props `fill`,
// valeurs recopiées ici en dur (seul point du projet à le faire).
//
// Couleurs choisies et validées avec le script de la skill dataviz (six checks : bande de
// luminosité, plancher de chroma, séparation daltonisme, plancher vision normale, contraste) —
// jamais au jugé. "Réussis/Ratés" reprend la palette de statut dédiée (vert succès / rouge
// critique, jamais réutilisée comme simple série) plutôt que la palette catégorielle : c'est
// exactement le cas d'usage d'un statut binaire réussite/échec, pas une simple identité.
const COULEURS_VERDICT = { verdict_valide: '#0ca30c', verdict_invalide: '#d03b3b' };

// "Formation vs prêt à l'embauche" : deux issues positives, pas un statut bon/mauvais — palette
// catégorielle (identité), pas la palette de statut. Violet + vert, cohérent avec les variantes de
// badge déjà choisies pour ces mêmes indicateurs (voir VARIANTE_PAR_INDICATEUR : 'violet'/
// 'vert-clair') sans reprendre le vert de "Réussis" ci-dessus (nuance différente : #008300 vs
// #0ca30c) pour ne pas laisser croire aux deux graphiques qu'ils mesurent la même chose.
const COULEURS_ORIENTATION = { orientation_envoi_formation: '#4a3aa7', orientation_pret_embauche: '#008300' };

// Répartition par poste : une couleur par CODE de poste (stable même si un filtre réduit le
// nombre de barres affichées), 8 teintes validées ensemble (voir script) + une 9e (cyan) ajoutée
// et revalidée pour couvrir les 9 postes ACCECIT (5 bureau + 4 hôtel) sans repli sur "Autre" —
// point à revisiter si l'entité en configure davantage un jour. "Non spécifié" (aucun poste
// renseigné sur l'évaluation) volontairement HORS de cette palette catégorielle : un gris neutre
// signale "pas de donnée", jamais confondu avec un vrai poste.
const COULEURS_POSTE = {
  nettoyage: '#2a78d6',
  vitrerie: '#eb6834',
  machiniste: '#1baf7a',
  chef_equipe: '#eda100',
  autres: '#e87ba4',
  femme_valet_chambre: '#008300',
  cafetier: '#4a3aa7',
  equipier: '#e34948',
  gouvernant: '#0891b2',
};
const COULEUR_POSTE_NON_SPECIFIE = '#9ca3af';

const FORMAT_POURCENTAGE = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 });

// Label directement lisible sur chaque part des deux camemberts ("Réussis vs ratés",
// "Formation vs prêt à l'embauche") — remplace le label par défaut de recharts (petit chiffre
// excentré + trait de rappel) par le total EN GROS suivi du pourcentage, centré à mi-rayon de la
// part, sans ligne de rappel (voir labelLine={false} sur les <Pie> plus bas) : à seulement 2
// parts par camembert, l'anneau est large, la valeur tient largement à l'intérieur. Le nom de la
// part n'est volontairement pas repris ici (déjà porté par la légende et le Tooltip au survol) —
// "Envoi en formation"/"Prêt à l'embauche" déborderait la part sur un partage très inégal.
// Fonction top-level (pas de dépendance au composant) : reçoit cx/cy/midAngle/rayons/percent/value
// directement de recharts (voir doc `label` en fonction), les calculs de position sont donc ceux
// de la lib, pas une estimation manuelle indépendante.
const RADIAN = Math.PI / 180;
function labelPartCamembert({ cx, cy, midAngle, innerRadius, outerRadius, percent, value }) {
  // Part à 0 masquée plutôt qu'un "0 (0%)" illisible collé au centre (angle nul) — reste visible
  // via la légende, qui liste toujours les deux parts indépendamment de leur valeur.
  if (!value) return null;
  const rayon = innerRadius + (outerRadius - innerRadius) * 0.62;
  const x = cx + rayon * Math.cos(-midAngle * RADIAN);
  const y = cy + rayon * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fill="#fff">
      <tspan x={x} dy="-0.35em" fontSize={18} fontWeight={700}>
        {value}
      </tspan>
      <tspan x={x} dy="1.3em" fontSize={12} fontWeight={500}>
        {`(${Math.round(percent * 100)}%)`}
      </tspan>
    </text>
  );
}

function formatDateISO(date) {
  return date.toISOString().slice(0, 10);
}

// Bornes par défaut à l'ouverture de l'écran : 30 derniers jours (bornes incluses) — pas de
// période "officielle" définie ailleurs dans le projet pour ce tableau de bord, juste une
// fenêtre de départ raisonnable, entièrement modifiable ensuite via les filtres.
function bornesParDefaut() {
  const fin = new Date();
  const debut = new Date();
  debut.setDate(debut.getDate() - 29);
  return { dateDebut: formatDateISO(debut), dateFin: formatDateISO(fin) };
}

// Tableau de bord KPI back-office (CLAUDE.md, section Tableau de bord : "indicateurs de pilotage
// et filtres, alimenté par les statuts et les motifs collectés tout au long du parcours") —
// réservé à Recruteur/Admin côté serveur (voir backend/src/api/routes/statistiques.routes.js),
// aucune garde de route ici, même principe que le reste du back-office (voir App.jsx).
export default function Indicateurs() {
  const { utilisateur, chargement: chargementSession } = useSession();

  const [periode, setPeriode] = useState(bornesParDefaut);
  const [typePoste, setTypePoste] = useState(''); // '' = toutes (Hôtellerie + Tertiaire)
  const [poste, setPoste] = useState(''); // '' = tous les postes

  const [indicateurs, setIndicateurs] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);

  // Sélection multiple des cartes/segments cliqués (Set de codes, voir LIBELLES_INDICATEURS plus
  // haut) — état séparé de `indicateurs` ci-dessus (les agrégats affichés sur les cartes/
  // graphiques), qui reste la source de vérité des CHIFFRES ; celui-ci ne pilote que le tableau
  // consolidé sous les graphiques.
  const [selectionIndicateurs, setSelectionIndicateurs] = useState(() => new Set());
  const [dossiersSelectionnes, setDossiersSelectionnes] = useState([]);
  const [chargementTableau, setChargementTableau] = useState(false);
  const [erreurTableau, setErreurTableau] = useState(null);

  function basculerIndicateur(code) {
    setSelectionIndicateurs((precedent) => {
      const suivant = new Set(precedent);
      if (suivant.has(code)) suivant.delete(code);
      else suivant.add(code);
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

  if (chargementSession) {
    return (
      <PageBackOffice>
        <p>Chargement de la session…</p>
      </PageBackOffice>
    );
  }

  if (!utilisateur) {
    return (
      <PageBackOffice>
        <p role="alert">Vous devez être connecté pour accéder au tableau de bord des indicateurs.</p>
      </PageBackOffice>
    );
  }

  // `code` : indicateur associé à ce segment (voir LIBELLES_INDICATEURS/basculerIndicateur plus
  // haut) — toujours présent, y compris pour "Non spécifié" (posteCode null, code
  // 'poste_non_specifie' plutôt que le préfixe 'poste:<code>', voir plus bas : "aucun poste
  // renseigné" n'est pas un poste parmi POSTES_BUREAU/POSTES_HOTEL).
  const donneesVerdicts = indicateurs
    ? [
        { nom: 'Réussis', total: indicateurs.verdicts.valide, code: 'verdict_valide', fill: COULEURS_VERDICT.verdict_valide },
        { nom: 'Ratés', total: indicateurs.verdicts.invalide, code: 'verdict_invalide', fill: COULEURS_VERDICT.verdict_invalide },
      ]
    : [];

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
          <h1>Tableau de bord - Indicateurs</h1>
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
          <label className="indicateurs__filtre">
            <span>Entité</span>
            <select value={typePoste} onChange={(evenement) => setTypePoste(evenement.target.value)}>
              <option value="">Toutes (Hôtellerie + Tertiaire)</option>
              <option value="hotel">Hôtellerie</option>
              <option value="bureau">Tertiaire</option>
            </select>
          </label>
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

        {!chargement && !erreur && indicateurs && (
          <>
            <div className="indicateurs__tuiles">
              {/* Bouton plutôt qu'un <div> statique : sélection multiple des cartes (voir
                  basculerIndicateur plus haut), accessible au clavier sans rien ajouter. Chaque
                  carte reste indépendamment sélectionnable (pas un groupe radio) : rien n'empêche
                  de croiser "Inscrits" et "Envoyés en test" dans le tableau consolidé. */}
              <button
                type="button"
                className={`indicateurs__tuile${selectionIndicateurs.has('inscrits') ? ' indicateurs__tuile--active' : ''}`}
                aria-pressed={selectionIndicateurs.has('inscrits')}
                onClick={() => basculerIndicateur('inscrits')}
              >
                <span className="indicateurs__tuile-valeur">{indicateurs.inscrits.total}</span>
                <span className="indicateurs__tuile-libelle">Inscrits</span>
              </button>
              <button
                type="button"
                className={`indicateurs__tuile${selectionIndicateurs.has('envoyes_en_test') ? ' indicateurs__tuile--active' : ''}`}
                aria-pressed={selectionIndicateurs.has('envoyes_en_test')}
                onClick={() => basculerIndicateur('envoyes_en_test')}
              >
                <span className="indicateurs__tuile-valeur">{indicateurs.envoyesEnTest.total}</span>
                <span className="indicateurs__tuile-libelle">Envoyés en test</span>
              </button>
              <button
                type="button"
                className={`indicateurs__tuile${selectionIndicateurs.has('conversion') ? ' indicateurs__tuile--active' : ''}`}
                aria-pressed={selectionIndicateurs.has('conversion')}
                onClick={() => basculerIndicateur('conversion')}
              >
                <span className="indicateurs__tuile-valeur">
                  {indicateurs.conversion.taux !== null ? FORMAT_POURCENTAGE.format(indicateurs.conversion.taux) : '-'}
                </span>
                <span className="indicateurs__tuile-libelle">
                  Taux de validation ({indicateurs.conversion.numerateur}/{indicateurs.conversion.denominateur})
                </span>
              </button>
              <button
                type="button"
                className={`indicateurs__tuile${selectionIndicateurs.has('delai_inscription_test') ? ' indicateurs__tuile--active' : ''}`}
                aria-pressed={selectionIndicateurs.has('delai_inscription_test')}
                onClick={() => basculerIndicateur('delai_inscription_test')}
              >
                <span className="indicateurs__tuile-valeur">
                  {indicateurs.delaisMoyens.inscriptionVersTestPlanifie.moyenneJours ?? '-'} j
                </span>
                <span className="indicateurs__tuile-libelle">Délai moyen inscription → test planifié</span>
              </button>
              <button
                type="button"
                className={`indicateurs__tuile${selectionIndicateurs.has('delai_test_verdict') ? ' indicateurs__tuile--active' : ''}`}
                aria-pressed={selectionIndicateurs.has('delai_test_verdict')}
                onClick={() => basculerIndicateur('delai_test_verdict')}
              >
                <span className="indicateurs__tuile-valeur">
                  {indicateurs.delaisMoyens.testVersVerdict.moyenneJours ?? '-'} j
                </span>
                <span className="indicateurs__tuile-libelle">Délai moyen test → verdict</span>
              </button>
            </div>

            <div className="indicateurs__graphiques">
              <section className="indicateurs__graphique">
                <h2>Tests réussis vs ratés</h2>
                {donneesVerdicts.every((entree) => entree.total === 0) ? (
                  <p className="indicateurs__vide">Aucun verdict sur la période.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={380}>
                    <PieChart>
                      {/* cx décalé vers la droite du centre (pas 50%, ni le 38% initial — voir
                          historique) : avec la grille corrigée à deux colonnes fixes
                          (.indicateurs__graphiques, Indicateurs.css), ce cadre est maintenant
                          assez large pour qu'un centrage trop à gauche laisse un grand vide entre
                          le bord droit du camembert et la légende (align="right", voir
                          ci-dessous) — 45% rapproche les deux plutôt que de les laisser à leurs
                          extrémités respectives avec un vide entre les deux. outerRadius relevé à
                          "92%" (plus de hauteur disponible, voir height ci-dessus, et labels
                          désormais À L'INTÉRIEUR de la part — labelPartCamembert plus haut — donc
                          plus besoin de marge extérieure pour un label+ligne de rappel) : un
                          camembert plus grand comble aussi une partie de ce vide par lui-même. */}
                      <Pie
                        data={donneesVerdicts}
                        dataKey="total"
                        nameKey="nom"
                        cx="45%"
                        outerRadius="92%"
                        label={labelPartCamembert}
                        labelLine={false}
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
                      <Tooltip />
                      {/* Légende repositionnée à droite (verticale) plutôt qu'en dessous
                          (horizontale, comportement par défaut) : c'est ce qui laissait le vide
                          constaté de chaque côté du camembert — toute la largeur du cadre n'était
                          utilisée ni par le camembert (centré, taille fixe) ni par la légende
                          (une ligne compacte sous lui). */}
                      <Legend layout="vertical" align="right" verticalAlign="middle" />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </section>

              <section className="indicateurs__graphique">
                <h2>Formation vs prêt à l’embauche</h2>
                {donneesOrientations.every((entree) => entree.total === 0) ? (
                  <p className="indicateurs__vide">Aucune orientation sur la période.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={380}>
                    <PieChart>
                      {/* Même camembert que "Tests réussis vs ratés" ci-dessus — taille et style
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
                      <Tooltip />
                      <Legend layout="vertical" align="right" verticalAlign="middle" />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </section>

              <section className="indicateurs__graphique indicateurs__graphique--large">
                <h2>Répartition par poste (évaluations distinctes)</h2>
                {donneesRepartitionPoste.length === 0 ? (
                  <p className="indicateurs__vide">Aucune évaluation sur la période.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={donneesRepartitionPoste}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="nom" interval={0} angle={-20} textAnchor="end" height={80} />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
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
            </div>

            {/* Tableau consolidé : uniquement visible dès qu'au moins une carte/segment est
                sélectionné — en dessous des graphiques (pas un panneau superposé) pour garder la
                sélection visible pendant qu'on consulte le détail, voir l'audit préalable à cette
                fonctionnalité. */}
            {selectionIndicateurs.size > 0 && (
              <section className="indicateurs__tableau-consolide">
                <div className="indicateurs__tableau-consolide-entete">
                  <h2>Dossiers sélectionnés ({selectionIndicateurs.size} indicateur(s))</h2>
                  <button type="button" onClick={() => setSelectionIndicateurs(new Set())}>
                    Effacer la sélection
                  </button>
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
                  />
                )}
              </section>
            )}
          </>
        )}
      </div>
    </PageBackOffice>
  );
}
