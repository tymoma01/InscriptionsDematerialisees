import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell } from 'recharts';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import StatutBadge from '../../core/workflow/StatutBadge';
import { useParametreURL } from '../../core/filtres/useParametreURL';
import { obtenirTableauDeBordDpae } from '../../services/dpaeService';
import '../tableauDeBord/Indicateurs.css';
import './TableauDeBordDpae.css';
import { STATUTS_DPAE, libelleStatutDpae, varianteStatutDpae } from '../../core/dpae/statutsDpae';

// « Tableau de bord DPAE » (onglet RH > Tableau de bord DPAE, 2026-09-30). Indicateurs calculés côté
// serveur (GET /api/dpae/tableau-de-bord, en base, heure de Paris) ; cette page ne fait qu'afficher.
// Style et graphiques du « Tableau de bord » existant (Indicateurs.css : filtres, tuiles, blocs
// graphiques ; mêmes composants recharts), réutilisés tels quels plutôt que redessinés.
// Filtres persistés dans l'URL (useParametreURL), appliqués à tout le tableau par le serveur.

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const FORMAT_JOUR_COURT = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit' });
const FORMAT_MOIS = new Intl.DateTimeFormat('fr-FR', { month: 'short', year: 'numeric' });

// Libellé, couleur de badge/tuile et couleur de graphique des statuts : source unique
// core/dpae/statutsDpae.js (2026-09-30).
// Libellés de poste : mêmes que la fiche (dupliqués, convention du projet).
const LIBELLE_PAR_POSTE = {
  femme_valet_chambre: 'Femme/Valet de chambre',
  cafetier: 'Cafetier',
  equipier: 'Équipier',
  gouvernant: 'Gouvernant(e)',
  autre: 'Autre',
};
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

function libellePeriode(periode, granularite) {
  const date = new Date(`${periode}T12:00:00`);
  return granularite === 'mois' ? FORMAT_MOIS.format(date) : `sem. du ${FORMAT_JOUR_COURT.format(date)}`;
}

function libelleSites(demande) {
  const sites = demande.sites_affectation ?? [];
  return sites.length ? sites.map((site) => `${site.nom} (${site.initiales})`).join(', ') : 'Non référencé';
}

// Liste cliquable (priorités, anticipation) : chaque ligne ouvre la fiche de la demande.
function ListeDemandes({ demandes, colonneDate, libelleDate, vide, marquer }) {
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
            <StatutBadge libelle={libelleStatutDpae(demande.statut)} variante={varianteStatutDpae(demande.statut)} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function Tuile({ valeur, libelle, precision, variante = 'neutre' }) {
  return (
    <div className={`indicateurs__tuile indicateurs__tuile--${variante} tableau-bord-dpae__tuile`}>
      <span className="indicateurs__tuile-valeur">{valeur}</span>
      <span className="indicateurs__tuile-libelle">{libelle}</span>
      {precision && <span className="indicateurs__tuile-precision">{precision}</span>}
    </div>
  );
}

function Camembert({ titre, donnees }) {
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
            <Pie data={nonVides} dataKey="valeur" nameKey="libelle" outerRadius={70} label={({ value }) => value}>
              {nonVides.map((d, index) => (
                <Cell key={d.libelle} fill={COULEURS_REPARTITION[index % COULEURS_REPARTITION.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}

// Barres horizontales (sites, postes, demandeurs) : libellés longs lisibles en tablette.
function Barres({ titre, donnees }) {
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
            <Tooltip />
            <Bar dataKey="valeur" name="Demandes" fill="#2e2013" />
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
  const nombrePriorites = t ? t.priorite.premierJourProche.length + t.priorite.aTraiterPlus24h.length + t.priorite.valideesEnRetard.length : 0;

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
            {/* 1. À traiter en priorité — en tête, encadré mis en évidence. */}
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
                <div>
                  <h3>Validées après leur premier jour ({t.priorite.valideesEnRetard.length})</h3>
                  <ListeDemandes demandes={t.priorite.valideesEnRetard} colonneDate="date_debut" libelleDate="1er jour" vide="Aucune validation en retard." />
                </div>
              </div>
            </section>

            {/* 2. Activité */}
            <h2 className="tableau-bord-dpae__section">Activité</h2>
            <div className="indicateurs__tuiles">
              <Tuile valeur={t.activite.total} libelle="Demandes" variante="neutre" />
              {STATUTS_DPAE.map((s) => (
                <Tuile key={s.code} valeur={t.activite.parStatut[s.code] ?? 0} libelle={s.libellePluriel} variante={s.variante} />
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
                  <Tooltip />
                  <Legend />
                  {STATUTS_DPAE.map((s) => (
                    <Bar key={s.code} dataKey={s.code} name={s.libelle} stackId="statut" fill={s.couleurGraphique} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </section>

            {/* 3. Répartition */}
            <h2 className="tableau-bord-dpae__section">Répartition</h2>
            <div className="tableau-bord-dpae__grille">
              <Camembert
                titre="CDD / CDI"
                donnees={[
                  { libelle: 'CDD', valeur: t.repartition.contrats.cdd },
                  { libelle: 'CDI', valeur: t.repartition.contrats.cdi },
                  { libelle: 'Non renseigné', valeur: t.repartition.contrats.non_renseigne ?? 0 },
                ]}
              />
              <Camembert
                titre="Raison des CDD"
                donnees={[
                  { libelle: 'Remplacement', valeur: t.repartition.motifsCdd.remplacement_absent },
                  { libelle: 'Surcroît d’activité', valeur: t.repartition.motifsCdd.surcroit_activite },
                  { libelle: 'Non renseignée', valeur: t.repartition.motifsCdd.non_renseigne ?? 0 },
                ]}
              />
              <Camembert
                titre="Nouveaux salariés / déjà venus"
                donnees={[
                  { libelle: 'Nouveaux salariés', valeur: t.repartition.nouveauxSalaries },
                  { libelle: 'Déjà travaillé chez nous', valeur: t.repartition.dejaTravailleChezNous },
                ]}
              />
              <Barres
                titre="Top 10 des sites d’affectation"
                donnees={[
                  ...t.repartition.sites.map((site) => ({ libelle: `${site.nom} (${site.initiales})`, valeur: site.nombre })),
                  ...(t.repartition.nonReferencees > 0 ? [{ libelle: 'Non référencé', valeur: t.repartition.nonReferencees }] : []),
                ]}
              />
              <Barres
                titre="Par poste"
                donnees={t.repartition.postes.map((p) => ({ libelle: p.poste ? (LIBELLE_PAR_POSTE[p.poste] ?? p.poste) : 'Non renseigné', valeur: p.nombre }))}
              />
              <Barres titre="Par demandeur" donnees={t.repartition.demandeurs.map((d) => ({ libelle: `${d.prenom} ${d.nom}`, valeur: d.nombre }))} />
            </div>

            {/* 4. Anticipation */}
            <h2 className="tableau-bord-dpae__section">Anticipation — fins de CDD</h2>
            <div className="indicateurs__tuiles">
              <Tuile valeur={t.anticipation.sous7Jours} libelle="Dans les 7 jours" variante="echec" />
              <Tuile valeur={t.anticipation.sous15Jours} libelle="Dans les 15 jours" variante="attente" />
            </div>
            <section className="indicateurs__graphique">
              <h2>CDD dont le dernier jour tombe dans les 15 prochains jours</h2>
              <ListeDemandes
                demandes={t.anticipation.demandes}
                colonneDate="date_fin"
                libelleDate="Dernier jour"
                vide="Aucun CDD ne se termine dans les 15 prochains jours."
                marquer={(demande) => (demande.sous_7_jours ? <span className="tableau-bord-dpae__alerte">≤ 7 jours</span> : null)}
              />
            </section>
          </div>
        )}
      </div>
    </PageBackOffice>
  );
}
