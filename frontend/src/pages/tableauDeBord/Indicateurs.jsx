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
const LIBELLES_INDICATEURS = {
  inscrits: 'Inscrits',
  envoyes_en_test: 'Envoyés en test',
  conversion: 'Taux de validation',
  delai_inscription_test: 'Délai inscription → test',
  delai_test_verdict: 'Délai test → verdict',
  verdict_valide: 'Test réussi',
  verdict_invalide: 'Test raté',
  orientation_envoi_formation: 'Envoi en formation',
  orientation_pret_embauche: 'Prêt à l’embauche',
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

// Palette dérivée de la charte back-office (--couleur-back-office, --couleur-back-office-dore,
// --statut-bleu/vert/violet-texte, voir styles/variables.css) — recharts ne lit pas les variables
// CSS dans ses props `fill`, valeurs recopiées ici en dur (seul point du projet à le faire, voir
// commentaire ci-dessous sur cette limite).
const COULEURS_GRAPHIQUE = ['#2e2013', '#7a5a34', '#1a4d8f', '#1e7e34', '#92620a', '#6b21a8', '#a8420c'];

const FORMAT_POURCENTAGE = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 });

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

  // Même raisonnement pour un segment de répartition par poste sélectionné ('poste:<code>') :
  // si le typePoste filtré ne propose plus ce poste, sa sélection n'a plus de sens (le segment
  // correspondant a d'ailleurs disparu du graphique).
  useEffect(() => {
    setSelectionIndicateurs((precedent) => {
      let modifie = false;
      const suivant = new Set(precedent);
      for (const code of suivant) {
        if (code.startsWith(PREFIXE_POSTE) && !postesDisponibles.includes(code.slice(PREFIXE_POSTE.length))) {
          suivant.delete(code);
          modifie = true;
        }
      }
      return modifie ? suivant : precedent;
    });
  }, [postesDisponibles]);

  useEffect(() => {
    let annule = false;
    setChargement(true);
    setErreur(null);
    obtenirIndicateursKpi({
      dateDebut: periode.dateDebut,
      dateFin: periode.dateFin,
      typePoste: typePoste || undefined,
      poste: poste || undefined,
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
  }, [periode, typePoste, poste]);

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
      poste: poste || undefined,
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
  }, [selectionIndicateurs, periode, typePoste, poste]);

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
  // haut) — absent uniquement pour "Non spécifié" (posteCode null, voir plus bas) : cette
  // catégorie n'a pas d'indicateur "poste:" valide, donc pas cliquable.
  const donneesVerdicts = indicateurs
    ? [
        { nom: 'Réussis', total: indicateurs.verdicts.valide, code: 'verdict_valide' },
        { nom: 'Ratés', total: indicateurs.verdicts.invalide, code: 'verdict_invalide' },
      ]
    : [];

  const donneesOrientations = indicateurs
    ? [
        { nom: 'Envoi en formation', total: indicateurs.orientations.envoi_formation, code: 'orientation_envoi_formation' },
        { nom: 'Prêt à l’embauche', total: indicateurs.orientations.pret_embauche, code: 'orientation_pret_embauche' },
      ]
    : [];

  const donneesRepartitionPoste = indicateurs
    ? indicateurs.repartitionParPoste.parEvaluation.map((ligne) => ({
        nom: libellePoste(ligne.posteCode),
        total: ligne.nbEvaluations,
        code: ligne.posteCode ? `${PREFIXE_POSTE}${ligne.posteCode}` : null,
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
              <option value="">Tous les postes</option>
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
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie data={donneesVerdicts} dataKey="total" nameKey="nom" outerRadius={90} label>
                        {donneesVerdicts.map((entree, index) => (
                          // Segment cliquable (voir basculerIndicateur) : opacité réduite pour les
                          // segments non sélectionnés dès qu'AU MOINS UN segment (toutes cartes/
                          // graphiques confondus) est sélectionné, contour renforcé sur les
                          // segments actifs — même logique de mise en évidence que les tuiles
                          // ci-dessus (classe --active), adaptée aux props recharts (pas de
                          // className sur <Cell>).
                          <Cell
                            key={entree.nom}
                            fill={COULEURS_GRAPHIQUE[index % COULEURS_GRAPHIQUE.length]}
                            cursor="pointer"
                            opacity={selectionIndicateurs.size === 0 || selectionIndicateurs.has(entree.code) ? 1 : 0.35}
                            stroke={selectionIndicateurs.has(entree.code) ? '#1a1a1a' : undefined}
                            strokeWidth={selectionIndicateurs.has(entree.code) ? 2 : undefined}
                            onClick={() => basculerIndicateur(entree.code)}
                          />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </section>

              <section className="indicateurs__graphique">
                <h2>Formation vs prêt à l’embauche</h2>
                {donneesOrientations.every((entree) => entree.total === 0) ? (
                  <p className="indicateurs__vide">Aucune orientation sur la période.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie data={donneesOrientations} dataKey="total" nameKey="nom" outerRadius={90} label>
                        {donneesOrientations.map((entree, index) => (
                          <Cell
                            key={entree.nom}
                            fill={COULEURS_GRAPHIQUE[index % COULEURS_GRAPHIQUE.length]}
                            cursor="pointer"
                            opacity={selectionIndicateurs.size === 0 || selectionIndicateurs.has(entree.code) ? 1 : 0.35}
                            stroke={selectionIndicateurs.has(entree.code) ? '#1a1a1a' : undefined}
                            strokeWidth={selectionIndicateurs.has(entree.code) ? 2 : undefined}
                            onClick={() => basculerIndicateur(entree.code)}
                          />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
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
                          son propre indicateur 'poste:<code>', sauf "Non spécifié" (code null,
                          voir donneesRepartitionPoste) — pas cliquable, curseur par défaut, jamais
                          estompée par la sélection des autres. */}
                      <Bar dataKey="total" fill="#2e2013">
                        {donneesRepartitionPoste.map((entree) => (
                          <Cell
                            key={entree.nom}
                            cursor={entree.code ? 'pointer' : 'default'}
                            opacity={
                              !entree.code || selectionIndicateurs.size === 0 || selectionIndicateurs.has(entree.code)
                                ? 1
                                : 0.35
                            }
                            stroke={entree.code && selectionIndicateurs.has(entree.code) ? '#1a1a1a' : undefined}
                            strokeWidth={entree.code && selectionIndicateurs.has(entree.code) ? 2 : undefined}
                            onClick={() => entree.code && basculerIndicateur(entree.code)}
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
