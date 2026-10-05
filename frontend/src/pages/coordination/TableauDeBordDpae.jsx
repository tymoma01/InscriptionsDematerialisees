import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell } from 'recharts';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import StatutBadge from '../../core/workflow/StatutBadge';
import { useParametreURL } from '../../core/filtres/useParametreURL';
import { listerSuiviDemandes, obtenirTableauDeBordDpae } from '../../services/dpaeService';
import { useFiltresListeDpae } from '../../core/dpae/FiltresListeDpae';
import TableauDemandesDpae from '../../core/dpae/TableauDemandesDpae';
import {
  demandesDeLIndicateur,
  indicateursCliquables,
  libellePeriode,
  libellePoste,
  listeComplete,
} from '../../core/dpae/indicateursTableauDeBordDpae';
import '../tableauDeBord/Indicateurs.css';
import './TableauDeBordDpae.css';
import { STATUTS_DPAE, libelleStatutDpae, varianteStatutDpae } from '../../core/dpae/statutsDpae';

// « Tableau de bord DPAE » (onglet RH > Tableau de bord DPAE, 2026-09-30). Indicateurs calculés côté
// serveur (GET /api/dpae/tableau-de-bord, en base, heure de Paris) ; cette page ne fait qu'afficher.
// Style et graphiques du « Tableau de bord » existant (Indicateurs.css : filtres, tuiles, blocs
// graphiques ; mêmes composants recharts), réutilisés tels quels plutôt que redessinés.
// Filtres persistés dans l'URL (useParametreURL), appliqués à tout le tableau par le serveur.

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

// Libellé, couleur de badge/tuile et couleur de graphique des statuts : source unique
// core/dpae/statutsDpae.js. Libellés de poste et de période, indicateurs cliquables (clic -> liste
// des demandes concernées) : core/dpae/indicateursTableauDeBordDpae.js.
const COULEUR_BARRE = '#2e2013';
const COULEUR_BARRE_ACTIVE = '#c98a0b';
const COULEURS_REPARTITION = ['#2e2013', '#c98a0b', '#4a3aa7', '#0ca30c', '#9ca3af'];

// Colonnes `date` (premier/dernier jour) : même conversion que la fiche (instant ISO relu dans le
// fuseau du poste), jamais un découpage de chaîne qui afficherait la veille.
const formaterJour = (valeur) => (valeur ? FORMAT_DATE.format(new Date(valeur)) : '—');

function formaterDelai(heures) {
  if (heures === null || heures === undefined) return '—';
  if (heures < 1) return `${Math.round(heures * 60)} min`;
  if (heures < 24) return `${Math.round(heures)} h`;
  const jours = Math.floor(heures / 24);
  const reste = Math.round(heures - jours * 24);
  return reste > 0 ? `${jours} j ${reste} h` : `${jours} j`;
}

// Défilement jusqu'au titre d'une liste, visible en haut de l'écran SOUS la barre de navigation
// (collante, sous l'en-tête fixe ; sa hauteur varie avec le nombre d'onglets, d'où une mesure à
// chaque appel plutôt qu'une constante). Immédiat si l'utilisateur a demandé à réduire les
// animations (prefers-reduced-motion), en douceur sinon.
function defilerJusquA(element) {
  if (!element) return;
  const barre = document.querySelector('.barre-navigation');
  const basBarre = barre ? (parseFloat(getComputedStyle(barre).top) || 0) + barre.offsetHeight : 0;
  const haut = element.getBoundingClientRect().top + window.scrollY - basBarre - 12;
  const animationsReduites = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: Math.max(haut, 0), behavior: animationsReduites ? 'auto' : 'smooth' });
}

function libelleSites(demande) {
  const sites = demande.sites_affectation ?? [];
  return sites.length ? sites.map((site) => `${site.nom} (${site.initiales})`).join(', ') : 'Non référencé';
}

// Liste cliquable (priorités, déclarations tardives, anticipation) : chaque ligne ouvre la fiche de
// la demande. `sansStatut` : badge de statut masqué quand toute la liste a le même statut.
function ListeDemandes({ demandes, colonneDate, libelleDate, vide, marquer, sansStatut = false }) {
  const navigate = useNavigate();
  if (demandes.length === 0) return <p className="tableau-bord-dpae__liste-vide">{vide}</p>;
  return (
    <ul className="tableau-bord-dpae__liste">
      {demandes.map((demande) => (
        <li key={demande.id}>
          <button type="button" className="tableau-bord-dpae__ligne" onClick={() => navigate(`/rh/dpae/${demande.id}`)}>
            <span className="tableau-bord-dpae__salarie">
              {demande.salarie_nom} {demande.salarie_prenom}
            </span>
            <span className="tableau-bord-dpae__sites">{libelleSites(demande)}</span>
            <span className="tableau-bord-dpae__date">
              {libelleDate} {formaterJour(demande[colonneDate])}
            </span>
            {marquer?.(demande)}
            {!sansStatut && <StatutBadge libelle={libelleStatutDpae(demande.statut)} variante={varianteStatutDpae(demande.statut)} />}
          </button>
        </li>
      ))}
    </ul>
  );
}

// Tuile d'indicateur. Avec onClick : bouton (main au survol, info-bulle « Voir les demandes »,
// état actif tant que sa liste est affichée). Sans : simple affichage (taux, délais, part).
function Tuile({ valeur, libelle, precision, variante = 'neutre', onClick, actif = false }) {
  const classes = `indicateurs__tuile indicateurs__tuile--${variante} tableau-bord-dpae__tuile${
    onClick ? ' tableau-bord-dpae__tuile--cliquable' : ''
  }${actif ? ' indicateurs__tuile--active' : ''}`;
  const contenu = (
    <>
      <span className="indicateurs__tuile-valeur">{valeur}</span>
      <span className="indicateurs__tuile-libelle">{libelle}</span>
      {precision && <span className="indicateurs__tuile-precision">{precision}</span>}
    </>
  );
  if (!onClick) return <div className={classes}>{contenu}</div>;
  return (
    <button type="button" className={classes} onClick={onClick} title="Voir les demandes" aria-pressed={actif}>
      {contenu}
    </button>
  );
}

// Info-bulle des graphiques : valeur(s) survolée(s) et rappel que l'élément est cliquable.
function InfoBulleGraphique({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tableau-bord-dpae__infobulle">
      {label && <strong>{label}</strong>}
      {payload.map((entree) => (
        <span key={entree.dataKey ?? entree.name}>
          {entree.name} : {entree.value}
        </span>
      ))}
      <em>Voir les demandes</em>
    </div>
  );
}

// donnees : [{ cle, libelle, valeur }] — cle : indicateur cliquable (indicateursTableauDeBordDpae.js).
function Camembert({ titre, donnees, cleActive, onChoisir }) {
  const nonVides = donnees.filter((d) => d.valeur > 0);
  return (
    <section className="indicateurs__graphique indicateurs__graphique--camembert">
      <h2>{titre}</h2>
      {nonVides.length === 0 ? (
        <p className="indicateurs__vide">Aucune donnée sur la période.</p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          {/* Marge haute : l'étiquette de la plus grande part (placée au-dessus du disque) n'est plus
              rognée. */}
          <PieChart margin={{ top: 18, bottom: 4 }}>
            <Pie
              data={nonVides}
              dataKey="valeur"
              nameKey="libelle"
              outerRadius={70}
              label={({ value }) => value}
              onClick={(_, index) => onChoisir(nonVides[index].cle)}
            >
              {nonVides.map((d, index) => (
                <Cell
                  key={d.libelle}
                  fill={COULEURS_REPARTITION[index % COULEURS_REPARTITION.length]}
                  cursor="pointer"
                  stroke={d.cle === cleActive ? COULEUR_BARRE_ACTIVE : '#ffffff'}
                  strokeWidth={d.cle === cleActive ? 4 : 1}
                />
              ))}
            </Pie>
            <Tooltip content={<InfoBulleGraphique />} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}

// Barres horizontales (sites, postes, demandeurs) : libellés longs lisibles en tablette. Chaque barre
// est cliquable (donnees : [{ cle, libelle, valeur }]).
function Barres({ titre, donnees, cleActive, onChoisir }) {
  return (
    <section className="indicateurs__graphique">
      <h2>{titre}</h2>
      {donnees.length === 0 ? (
        <p className="indicateurs__vide">Aucune donnée sur la période.</p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(120, donnees.length * 34 + 30)}>
          <BarChart data={donnees} layout="vertical" margin={{ left: 8, right: 24 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" allowDecimals={false} />
            <YAxis type="category" dataKey="libelle" width={170} tick={{ fontSize: 12 }} />
            <Tooltip content={<InfoBulleGraphique />} cursor={{ fill: 'rgba(122, 90, 52, 0.08)' }} />
            <Bar dataKey="valeur" name="Demandes" fill={COULEUR_BARRE} cursor="pointer" onClick={(_, index) => onChoisir(donnees[index].cle)}>
              {donnees.map((d) => (
                <Cell key={d.cle} fill={d.cle === cleActive ? COULEUR_BARRE_ACTIVE : COULEUR_BARRE} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}

export default function TableauDeBordDpae() {
  const [debut, setDebut] = useParametreURL('debut', '');
  const [fin, setFin] = useParametreURL('fin', '');
  const [siteId, setSiteId] = useParametreURL('site', '');
  const [typeContrat, setTypeContrat] = useParametreURL('contrat', '');
  const [statut, setStatut] = useParametreURL('statut', '');

  const [donnees, setDonnees] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);

  useEffect(() => {
    let annule = false;
    setChargement(true);
    setErreur(null);
    obtenirTableauDeBordDpae({ debut, fin, siteId, typeContrat, statut })
      .then((valeur) => {
        if (!annule) setDonnees(valeur);
      })
      .catch((erreurRequete) => {
        if (!annule) setErreur(erreurRequete.response?.data?.erreur ?? 'Impossible de charger le tableau de bord DPAE.');
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, [debut, fin, siteId, typeContrat, statut]);

  const reinitialiser = () => {
    setDebut('');
    setFin('');
    setSiteId('');
    setTypeContrat('');
    setStatut('');
  };

  const t = donnees;
  // Demandes distinctes (une demande dans les deux listes compte une fois), calculé côté serveur.
  const nombrePriorites = t ? t.priorite.nombre : 0;

  // --- Clic sur un indicateur -> « Demandes concernées » (2026-10-02) --------------------------------
  // `selection` : CLÉ de l'indicateur (indicateursTableauDeBordDpae.js), pas sa liste : quand les
  // filtres changent, la liste est relue dans les nouvelles données (filtres de période compris).
  const [selection, setSelection] = useState(null);
  // Cartes « Dans les 7 jours » / « Dans les 15 jours » : filtrent la liste des fins de CDD.
  const [filtreFinsCdd, setFiltreFinsCdd] = useState(null);
  // Liste complète des demandes de l'entité (GET /dpae/suivi, « toutes »), rechargée une fois par
  // chargement du tableau de bord : les demandes d'un indicateur y sont prises par identifiant.
  const [suivi, setSuivi] = useState({ demandes: null, pour: null, erreur: null });
  // Défilement demandé après un clic : { cible, jeton } (jeton : relance même sur la même cible).
  const [defilement, setDefilement] = useState(null);
  const refTitreSelection = useRef(null);
  const refTitreFinsCdd = useRef(null);

  const indicateurs = useMemo(() => indicateursCliquables(t), [t]);
  const indicateurActif = selection ? (indicateurs.get(selection) ?? null) : null;
  const demandesSelection = useMemo(
    () => (indicateurActif && suivi.demandes ? demandesDeLIndicateur(indicateurActif, suivi.demandes) : []),
    [indicateurActif, suivi.demandes],
  );
  // Même tableau que les listes DPAE (TableauDemandesDpae.jsx) : colonnes, pastilles, tri par défaut.
  const etatSelection = useFiltresListeDpae(demandesSelection);

  useEffect(() => {
    if (!indicateurActif || suivi.pour === t) return undefined;
    let annule = false;
    listerSuiviDemandes('toutes')
      .then((demandes) => {
        if (!annule) setSuivi({ demandes, pour: t, erreur: null });
      })
      .catch(() => {
        if (!annule) setSuivi({ demandes: null, pour: t, erreur: 'Impossible de récupérer les demandes.' });
      });
    return () => {
      annule = true;
    };
  }, [indicateurActif, t, suivi.pour]);

  useEffect(() => {
    if (!defilement) return;
    defilerJusquA(defilement.cible === 'finsCdd' ? refTitreFinsCdd.current : refTitreSelection.current);
  }, [defilement]);

  // Recliquer sur l'indicateur affiché le masque ; sinon, sa liste remplace la précédente (recherche,
  // filtres et tri de colonne remis à zéro) et la page défile jusqu'à elle.
  const choisirIndicateur = (cle) => {
    if (!indicateurs.has(cle)) return;
    if (cle === selection) {
      setSelection(null);
      return;
    }
    setSelection(cle);
    etatSelection.effacer();
    setDefilement({ cible: 'selection', jeton: Date.now() });
  };
  const choisirFinsCdd = (filtre) => {
    setFiltreFinsCdd((actuel) => (actuel === filtre ? null : filtre));
    setDefilement({ cible: 'finsCdd', jeton: Date.now() });
  };
  const proprietesTuile = (cle) => ({ onClick: () => choisirIndicateur(cle), actif: selection === cle });
  const finsCddAffichees = t
    ? filtreFinsCdd === '7'
      ? t.anticipation.demandes.filter((demande) => demande.sous_7_jours)
      : t.anticipation.demandes
    : [];

  return (
    <PageBackOffice>
      <div className="indicateurs tableau-bord-dpae">
        <header className="indicateurs__entete">
          <div className="indicateurs__titre-bloc">
            <h1>Tableau de bord DPAE</h1>
          </div>
          <EnTeteBackOffice />
        </header>

        {/* Filtres appliqués à TOUT le tableau (calcul serveur). Période : dates de création, heure de
            Paris ; par défaut les 30 derniers jours (dates résolues renvoyées par le serveur). */}
        <div className="indicateurs__filtres tableau-bord-dpae__filtres">
          <label className="indicateurs__filtre">
            <span>Du</span>
            <input type="date" value={debut || t?.filtres.debut || ''} onChange={(e) => setDebut(e.target.value)} />
          </label>
          <label className="indicateurs__filtre">
            <span>Au</span>
            <input type="date" value={fin || t?.filtres.fin || ''} onChange={(e) => setFin(e.target.value)} />
          </label>
          <label className="indicateurs__filtre">
            <span>Site</span>
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              <option value="">Tous</option>
              {(t?.optionsSites ?? []).map((site) => (
                <option key={site.id} value={String(site.id)}>
                  {site.nom} ({site.initiales})
                </option>
              ))}
              <option value="non_reference">Non référencé</option>
            </select>
          </label>
          <label className="indicateurs__filtre">
            <span>Contrat</span>
            <select value={typeContrat} onChange={(e) => setTypeContrat(e.target.value)}>
              <option value="">Tous</option>
              <option value="cdd">CDD</option>
              <option value="cdi">CDI</option>
            </select>
          </label>
          <label className="indicateurs__filtre">
            <span>Statut</span>
            <select value={statut} onChange={(e) => setStatut(e.target.value)}>
              <option value="">Tous</option>
              {STATUTS_DPAE.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.libelle}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="tableau-bord-dpae__reinitialiser" onClick={reinitialiser}>
            Réinitialiser
          </button>
        </div>

        {erreur && <p role="alert">{erreur}</p>}
        {chargement && !t && <p>Chargement…</p>}

        {t && (
          <div className={`tableau-bord-dpae__contenu${chargement ? ' tableau-bord-dpae__contenu--chargement' : ''}`}>
            {/* 1. À traiter en priorité — en tête, encadré mis en évidence. UNIQUEMENT des demandes sur
                lesquelles la RH doit encore agir (À traiter / En attente) ; les validations tardives
                sont un indicateur de suivi, bloc « Déclarations tardives » plus bas (2026-09-30). */}
            <section className="tableau-bord-dpae__priorite" aria-labelledby="titre-priorite">
              <h2 id="titre-priorite">
                À traiter en priorité <span className="tableau-bord-dpae__compteur">{nombrePriorites}</span>
              </h2>
              <div className="tableau-bord-dpae__colonnes-priorite">
                <div>
                  <h3>Premier jour aujourd&rsquo;hui ou demain ({t.priorite.premierJourProche.length})</h3>
                  <ListeDemandes demandes={t.priorite.premierJourProche} colonneDate="date_debut" libelleDate="1er jour" vide="Aucune demande à traiter pour aujourd’hui ou demain." />
                </div>
                <div>
                  <h3>À traiter depuis plus de 24 h ({t.priorite.aTraiterPlus24h.length})</h3>
                  <ListeDemandes demandes={t.priorite.aTraiterPlus24h} colonneDate="date_creation" libelleDate="Envoyée le" vide="Aucune demande à traiter depuis plus de 24 h." />
                </div>
              </div>
            </section>

            {/* 2. Activité */}
            <h2 className="tableau-bord-dpae__section">Activité</h2>
            <div className="indicateurs__tuiles">
              <Tuile valeur={t.activite.total} libelle="Demandes" variante="neutre" {...proprietesTuile('total')} />
              {STATUTS_DPAE.map((s) => (
                <Tuile
                  key={s.code}
                  valeur={t.activite.parStatut[s.code] ?? 0}
                  libelle={s.libellePluriel}
                  variante={s.variante}
                  {...proprietesTuile(`statut:${s.code}`)}
                />
              ))}
              <Tuile
                valeur={t.activite.tauxRejet === null ? '—' : `${Math.round(t.activite.tauxRejet * 100)} %`}
                libelle="Taux de rejet"
                precision="sur les demandes traitées"
                variante="echec-fort"
              />
              <Tuile valeur={formaterDelai(t.activite.delaiMoyenHeures)} libelle="Délai moyen" precision={`envoi → décision (${t.activite.nombreTraitees} traitées)`} variante="bleu" />
              <Tuile valeur={formaterDelai(t.activite.delaiMedianHeures)} libelle="Délai médian" precision="envoi → décision" variante="bleu" />
            </div>
            <section className="indicateurs__graphique tableau-bord-dpae__evolution">
              <h2>Évolution {t.granularite === 'mois' ? 'par mois' : 'par semaine'}</h2>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={t.activite.evolution.map((p) => ({ ...p, libelle: libellePeriode(p.periode, t.granularite) }))}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="libelle" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip content={<InfoBulleGraphique />} cursor={{ fill: 'rgba(122, 90, 52, 0.08)' }} />
                  <Legend />
                  {/* Chaque segment (période x statut) est cliquable. */}
                  {STATUTS_DPAE.map((s) => (
                    <Bar
                      key={s.code}
                      dataKey={s.code}
                      name={s.libelle}
                      stackId="statut"
                      fill={s.couleurGraphique}
                      cursor="pointer"
                      onClick={(_, index) => choisirIndicateur(`evolution:${t.activite.evolution[index].periode}:${s.code}`)}
                    >
                      {t.activite.evolution.map((periode) => {
                        const actif = selection === `evolution:${periode.periode}:${s.code}`;
                        return <Cell key={periode.periode} stroke={actif ? COULEUR_BARRE : undefined} strokeWidth={actif ? 3 : 0} />;
                      })}
                    </Bar>
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </section>

            {/* Déclarations tardives — indicateur de suivi, pas une alerte : couleurs
                neutres, seul le retard est marqué en orange clair. */}
            <h2 className="tableau-bord-dpae__section">Déclarations tardives</h2>
            <div className="indicateurs__tuiles">
              <Tuile
                valeur={t.declarationsTardives.nombre}
                libelle="Validées après leur 1er jour"
                precision="sur la période filtrée"
                variante="neutre"
                {...proprietesTuile('tardives')}
              />
              <Tuile
                valeur={t.declarationsTardives.part === null ? '—' : `${Math.round(t.declarationsTardives.part * 100)} %`}
                libelle="Part des demandes validées"
                precision={`${t.declarationsTardives.nombre} sur ${t.declarationsTardives.nombreValidees} validée(s)`}
                variante="neutre"
              />
            </div>
            <section className="indicateurs__graphique">
              <h2>Demandes validées après leur premier jour</h2>
              <ListeDemandes
                demandes={t.declarationsTardives.demandes}
                colonneDate="date_debut"
                libelleDate="1er jour"
                vide="Aucune déclaration tardive sur la période."
                sansStatut
                marquer={(demande) => (
                  <>
                    <span className="tableau-bord-dpae__date">Validée le {formaterJour(demande.date_traitement)}</span>
                    <span className="tableau-bord-dpae__retard">
                      +{demande.retard_jours} jour{demande.retard_jours > 1 ? 's' : ''}
                    </span>
                  </>
                )}
              />
            </section>

            {/* 3. Répartition */}
            <h2 className="tableau-bord-dpae__section">Répartition</h2>
            <div className="tableau-bord-dpae__grille">
              <Camembert
                titre="CDD / CDI"
                cleActive={selection}
                onChoisir={choisirIndicateur}
                donnees={[
                  { cle: 'contrat:cdd', libelle: 'CDD', valeur: t.repartition.contrats.cdd },
                  { cle: 'contrat:cdi', libelle: 'CDI', valeur: t.repartition.contrats.cdi },
                  { cle: 'contrat:non_renseigne', libelle: 'Non renseigné', valeur: t.repartition.contrats.non_renseigne ?? 0 },
                ]}
              />
              <Camembert
                titre="Raison des CDD"
                cleActive={selection}
                onChoisir={choisirIndicateur}
                donnees={[
                  { cle: 'motif:remplacement_absent', libelle: 'Remplacement', valeur: t.repartition.motifsCdd.remplacement_absent },
                  { cle: 'motif:surcroit_activite', libelle: 'Surcroît d’activité', valeur: t.repartition.motifsCdd.surcroit_activite },
                  { cle: 'motif:non_renseigne', libelle: 'Non renseignée', valeur: t.repartition.motifsCdd.non_renseigne ?? 0 },
                ]}
              />
              <Camembert
                titre="Nouveaux salariés / déjà venus"
                cleActive={selection}
                onChoisir={choisirIndicateur}
                donnees={[
                  { cle: 'emploi:nouveaux', libelle: 'Nouveaux salariés', valeur: t.repartition.nouveauxSalaries },
                  { cle: 'emploi:deja', libelle: 'Déjà travaillé chez nous', valeur: t.repartition.dejaTravailleChezNous },
                ]}
              />
              <Barres
                titre="Top 10 des sites d’affectation"
                cleActive={selection}
                onChoisir={choisirIndicateur}
                donnees={[
                  ...t.repartition.sites.map((site) => ({ cle: `site:${site.id}`, libelle: `${site.nom} (${site.initiales})`, valeur: site.nombre })),
                  ...(t.repartition.nonReferencees > 0
                    ? [{ cle: 'site:non_reference', libelle: 'Non référencé', valeur: t.repartition.nonReferencees }]
                    : []),
                ]}
              />
              <Barres
                titre="Par poste"
                cleActive={selection}
                onChoisir={choisirIndicateur}
                donnees={t.repartition.postes.map((p) => ({ cle: `poste:${p.poste ?? 'non_renseigne'}`, libelle: libellePoste(p.poste), valeur: p.nombre }))}
              />
              <Barres
                titre="Par demandeur"
                cleActive={selection}
                onChoisir={choisirIndicateur}
                donnees={t.repartition.demandeurs.map((d) => ({ cle: `demandeur:${d.id}`, libelle: `${d.prenom} ${d.nom}`, valeur: d.nombre }))}
              />
            </div>

            {/* 4. Anticipation */}
            <h2 className="tableau-bord-dpae__section">CDD arrivant à échéance</h2>
            {/* Les deux cartes filtrent la liste ci-dessous (pas de section « Demandes concernées »). */}
            <div className="indicateurs__tuiles">
              <Tuile
                valeur={t.anticipation.sous7Jours}
                libelle="Dans les 7 jours"
                variante="echec"
                onClick={() => choisirFinsCdd('7')}
                actif={filtreFinsCdd === '7'}
              />
              <Tuile
                valeur={t.anticipation.sous15Jours}
                libelle="Dans les 15 jours"
                variante="attente"
                onClick={() => choisirFinsCdd('15')}
                actif={filtreFinsCdd === '15'}
              />
            </div>
            <section className="indicateurs__graphique">
              <h2 ref={refTitreFinsCdd} className="tableau-bord-dpae__titre-liste">
                CDD dont le dernier jour tombe dans les {filtreFinsCdd === '7' ? 7 : 15} prochains jours ({finsCddAffichees.length})
              </h2>
              <ListeDemandes
                demandes={finsCddAffichees}
                colonneDate="date_fin"
                libelleDate="Dernier jour"
                vide={`Aucun CDD ne se termine dans les ${filtreFinsCdd === '7' ? 7 : 15} prochains jours.`}
                marquer={(demande) => (demande.sous_7_jours ? <span className="tableau-bord-dpae__alerte">≤ 7 jours</span> : null)}
              />
            </section>

            {/* « Demandes concernées » — n'apparaît qu'après un clic sur un indicateur. Tableau des listes
                DPAE (TableauDemandesDpae.jsx), demandes prises par identifiant : exactement celles
                comptées par l'indicateur, filtres du tableau de bord compris. */}
            {indicateurActif && (
              <section className="indicateurs__graphique tableau-bord-dpae__selection" aria-labelledby="titre-demandes-concernees">
                <div className="tableau-bord-dpae__selection-entete">
                  <h2 id="titre-demandes-concernees" ref={refTitreSelection} className="tableau-bord-dpae__titre-liste">
                    Demandes concernées : {indicateurActif.libelle} ({indicateurActif.nombre})
                  </h2>
                  <button type="button" className="tableau-bord-dpae__effacer" onClick={() => setSelection(null)}>
                    Effacer
                  </button>
                </div>
                {suivi.erreur && <p role="alert">{suivi.erreur}</p>}
                {!suivi.erreur && suivi.pour !== t && <p>Chargement…</p>}
                {!suivi.erreur && suivi.pour === t && indicateurActif.nombre === 0 && (
                  <p className="tableau-bord-dpae__liste-vide">Aucune demande.</p>
                )}
                {!suivi.erreur && suivi.pour === t && indicateurActif.nombre > 0 && (
                  <>
                    {!listeComplete(indicateurActif, suivi.demandes) && (
                      <p role="alert">Certaines demandes n’ont pas pu être affichées : rechargez la page.</p>
                    )}
                    <TableauDemandesDpae etatFiltres={etatSelection} />
                  </>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </PageBackOffice>
  );
}
