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
import { obtenirIndicateursKpi } from '../../services/statistiqueService';
import './Indicateurs.css';

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

  const donneesVerdicts = indicateurs
    ? [
        { nom: 'Réussis', total: indicateurs.verdicts.valide },
        { nom: 'Ratés', total: indicateurs.verdicts.invalide },
      ]
    : [];

  const donneesOrientations = indicateurs
    ? [
        { nom: 'Envoi en formation', total: indicateurs.orientations.envoi_formation },
        { nom: 'Prêt à l’embauche', total: indicateurs.orientations.pret_embauche },
      ]
    : [];

  const donneesRepartitionPoste = indicateurs
    ? indicateurs.repartitionParPoste.parEvaluation.map((ligne) => ({
        nom: libellePoste(ligne.posteCode),
        total: ligne.nbEvaluations,
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
              <div className="indicateurs__tuile">
                <span className="indicateurs__tuile-valeur">{indicateurs.inscrits.total}</span>
                <span className="indicateurs__tuile-libelle">Inscrits</span>
              </div>
              <div className="indicateurs__tuile">
                <span className="indicateurs__tuile-valeur">{indicateurs.envoyesEnTest.total}</span>
                <span className="indicateurs__tuile-libelle">Envoyés en test</span>
              </div>
              <div className="indicateurs__tuile">
                <span className="indicateurs__tuile-valeur">
                  {indicateurs.conversion.taux !== null ? FORMAT_POURCENTAGE.format(indicateurs.conversion.taux) : '-'}
                </span>
                <span className="indicateurs__tuile-libelle">
                  Taux de validation ({indicateurs.conversion.numerateur}/{indicateurs.conversion.denominateur})
                </span>
              </div>
              <div className="indicateurs__tuile">
                <span className="indicateurs__tuile-valeur">
                  {indicateurs.delaisMoyens.inscriptionVersTestPlanifie.moyenneJours ?? '-'} j
                </span>
                <span className="indicateurs__tuile-libelle">Délai moyen inscription → test planifié</span>
              </div>
              <div className="indicateurs__tuile">
                <span className="indicateurs__tuile-valeur">
                  {indicateurs.delaisMoyens.testVersVerdict.moyenneJours ?? '-'} j
                </span>
                <span className="indicateurs__tuile-libelle">Délai moyen test → verdict</span>
              </div>
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
                          <Cell key={entree.nom} fill={COULEURS_GRAPHIQUE[index % COULEURS_GRAPHIQUE.length]} />
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
                          <Cell key={entree.nom} fill={COULEURS_GRAPHIQUE[index % COULEURS_GRAPHIQUE.length]} />
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
                      <Bar dataKey="total" fill="#2e2013" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </PageBackOffice>
  );
}
