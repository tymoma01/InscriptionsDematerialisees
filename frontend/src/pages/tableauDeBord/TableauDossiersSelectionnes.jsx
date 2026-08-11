import { Link } from 'react-router-dom';
import StatutBadge from '../../core/workflow/StatutBadge';
import './TableauDossiersSelectionnes.css';

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

const UN_JOUR_MS = 24 * 60 * 60 * 1000;

function trouverDateCle(dossier, code) {
  return dossier.datesCles.find((d) => d.code === code)?.date ?? null;
}

// Différence en jours CALENDAIRES (pas en temps écoulé) entre deux dates ISO — 0 si même jour
// civil, même si moins de 24h séparent les deux horodatages (ex. inscription 23h50 -> test
// planifié 00h10 le lendemain = 1 jour calendaire, pas 0 malgré 20 minutes d'écart réelles).
// Bornes ramenées à minuit (fuseau du navigateur, cohérent avec FORMAT_DATE ci-dessus) avant de
// différencier, plutôt qu'un simple `Math.round(ms / UN_JOUR_MS)` sur les horodatages bruts.
function joursCalendairesEntre(dateDebut, dateFin) {
  const debut = new Date(dateDebut);
  const fin = new Date(dateFin);
  const debutMinuit = new Date(debut.getFullYear(), debut.getMonth(), debut.getDate());
  const finMinuit = new Date(fin.getFullYear(), fin.getMonth(), fin.getDate());
  return Math.round((finMinuit - debutMinuit) / UN_JOUR_MS);
}

// "Délai inscription → test"/"Délai test → verdict" : les deux SEULS codes alignés entre les
// colonnes "Indicateurs" et "Dates clés" (décision utilisateur, 2026-08-11) — badge (libellé seul)
// dans "Indicateurs" à la même hauteur que sa valeur ("X J", sans libellé répété) dans "Dates
// clés". Tous les autres badges (Inscrit, Mis en test, Retenu, Verdict, Orientation) gardent
// leur ordre/position actuels dans "Indicateurs" (celui de `dossier.indicateurs`, piloté par
// l'ordre de sélection des tuiles côté Indicateurs.jsx) SANS tentative d'alignement avec "Dates
// clés" — seul construireColonnesAlignees ci-dessous s'occupe des deux codes de délai.
const [CODE_DELAI_INSCRIPTION_TEST, CODE_DELAI_TEST_VERDICT] = ['delai_inscription_test', 'delai_test_verdict'];

// Construit, pour UN dossier, les deux colonnes ("Indicateurs" hors postes / "Dates clés") déjà
// alignées ligne à ligne pour les deux indicateurs de délai — structure de données commune lue par
// les DEUX colonnes au même index (décision utilisateur, 2026-08-11), pour ne plus dépendre d'un
// calcul indépendant de chaque côté : l'ordre des badges dans "Indicateurs" suit l'ordre de clic
// des tuiles (imprévisible), alors que "Dates clés" a un ordre chronologique fixe (inscription →
// test planifié → verdict) — les deux ne peuvent physiquement coïncider sans concertation.
//
// Principe : on parcourt les deux listes (badges non-poste, dates simples) EN PARALLÈLE, dans
// l'ordre chronologique des deux ancres de délai (inscription→test avant test→verdict — c'est
// l'ordre imposé par "Dates clés", fixe ; celui des badges peut différer selon les clics, cas rare
// laissé tel quel plutôt que de réordonner les badges — voir "Ne touche à aucun autre badge").
// Devant chaque ancre, on recopie tel quel tout ce qui la précède dans chaque colonne, puis on
// COMBLE l'écart de hauteur (nombre de lignes déjà posées) avec des lignes vides du côté le plus
// court, avant de poser l'ancre elle-même — qui tombe donc forcément à la même hauteur des deux
// côtés. Après la dernière ancre, le reste de chaque colonne est recopié tel quel, sans tentative
// d'alignement (item 4 : Verdict/Orientation ne sont pas concernés).
function construireColonnesAlignees(dossier, estIndicateurPoste) {
  const badges = dossier.indicateurs.filter(({ code }) => !estIndicateurPoste(code));
  const dates = dossier.datesCles; // dates simples uniquement, ordre chronologique fixe

  const indexTestPlanifie = dates.findIndex((d) => d.code === 'test_planifie');
  const indexVerdict = dates.findIndex((d) => d.code.startsWith('verdict_'));

  const ancres = [];
  const indexDelai1Badge = badges.findIndex((b) => b.code === CODE_DELAI_INSCRIPTION_TEST);
  if (indexDelai1Badge !== -1 && indexTestPlanifie !== -1) {
    ancres.push({
      code: CODE_DELAI_INSCRIPTION_TEST,
      indexBadge: indexDelai1Badge,
      indexDateInsertion: indexTestPlanifie + 1,
      jours: joursCalendairesEntre(trouverDateCle(dossier, 'inscription'), dates[indexTestPlanifie].date),
    });
  }
  const indexDelai2Badge = badges.findIndex((b) => b.code === CODE_DELAI_TEST_VERDICT);
  if (indexDelai2Badge !== -1 && indexVerdict !== -1 && dossier.dateDernierTestPlanifieAvantVerdict) {
    ancres.push({
      code: CODE_DELAI_TEST_VERDICT,
      indexBadge: indexDelai2Badge,
      indexDateInsertion: indexVerdict + 1,
      // dossier.dateDernierTestPlanifieAvantVerdict (PAS dates[indexTestPlanifie].date, la
      // PREMIÈRE planification) — correctif audit 2026-08-11 : la définition validée de ce délai
      // (statistiquesRepository.delaiTestVersVerdict/listerDelaiTestVersVerdict, seule source de
      // vérité pour la tuile ET sa liste de dossiers) mesure depuis la planification la PLUS
      // RÉCENTE avant le verdict, pas depuis la première — sinon un dossier reprogrammé après
      // échec/absence affiche un délai gonflé, sans rapport avec le délai réel entre la dernière
      // tentative et son issue (démontré sur les dossiers #74/#88 : 13 J/5 J affichés à tort au
      // lieu de ~0 J).
      jours: joursCalendairesEntre(dossier.dateDernierTestPlanifieAvantVerdict, dates[indexVerdict].date),
    });
  }
  // Ordre chronologique fixe (voir commentaire ci-dessus) — pas l'ordre des badges.
  ancres.sort((a, b) => a.indexDateInsertion - b.indexDateInsertion);

  const indicateurRows = [];
  const dateRows = [];
  let curseurBadge = 0;
  let curseurDate = 0;

  for (const ancre of ancres) {
    while (curseurBadge < ancre.indexBadge) {
      indicateurRows.push({ type: 'badge', code: badges[curseurBadge].code });
      curseurBadge += 1;
    }
    while (curseurDate < ancre.indexDateInsertion) {
      dateRows.push({ type: 'date', code: dates[curseurDate].code, date: dates[curseurDate].date });
      curseurDate += 1;
    }
    const ecart = indicateurRows.length - dateRows.length;
    if (ecart > 0) {
      for (let k = 0; k < ecart; k += 1) dateRows.push({ type: 'blank', code: `blank-date-${ancre.code}-${k}` });
    } else if (ecart < 0) {
      for (let k = 0; k < -ecart; k += 1) indicateurRows.push({ type: 'blank', code: `blank-badge-${ancre.code}-${k}` });
    }
    indicateurRows.push({ type: 'badge', code: ancre.code });
    dateRows.push({ type: 'delai-valeur', code: ancre.code, jours: ancre.jours });
    curseurBadge = ancre.indexBadge + 1;
    // curseurDate ne bouge pas : l'ancre s'insère AVANT dates[ancre.indexDateInsertion], qui reste
    // à consommer par le segment suivant (ou la boucle de fin ci-dessous).
  }
  while (curseurBadge < badges.length) {
    indicateurRows.push({ type: 'badge', code: badges[curseurBadge].code });
    curseurBadge += 1;
  }
  while (curseurDate < dates.length) {
    dateRows.push({ type: 'date', code: dates[curseurDate].code, date: dates[curseurDate].date });
    curseurDate += 1;
  }

  return { indicateurRows, dateRows };
}

// Tableau consolidé du dashboard KPI (Indicateurs.jsx) : une ligne par dossier satisfaisant TOUS
// les indicateurs sélectionnés à la fois (ET strict, voir
// statistiquesService.listerDossiersParIndicateurs — deux indicateurs mutuellement exclusifs, ex.
// "Test réussi" + "Test raté", donnent donc légitimement un tableau vide). Ce composant se
// contente d'afficher ce qu'il reçoit — la logique de filtrage vit entièrement côté back, aucune
// règle métier propre ici, même esprit que DossierList.jsx.
//
// Composant dédié plutôt qu'extension de DossierList (core/dossier/DossierList.jsx) : les
// colonnes diffèrent trop pour justifier d'alourdir un composant déjà utilisé tel quel par
// TableauDeBordAccueil.jsx/Backoffice.jsx (n° de dossier cliquable — absent de DossierList,
// qui n'affiche qu'un rang d'affichage —, badges d'indicateurs, dates clés du parcours plutôt
// qu'une seule "dernière mise à jour").
//
// `libelleIndicateur`/`varianteIndicateur`/`varianteStatut`/`estIndicateurPoste` : mêmes
// principes que `libellePoste`/`varianteStatut` dans DossierList.jsx — ce composant ne connaît
// aucun code métier propre à ACCECIT, uniquement des fonctions de traduction fournies par
// l'appelant.
//
// Pas de filtrage des badges "redondants" avec le statut de la ligne (essayé puis retiré,
// 2026-08-10) : la colonne affiche systématiquement tous les indicateurs sélectionnés qui
// s'appliquent au dossier — y compris quand un seul indicateur reste pertinent et qu'il est
// redondant avec le statut affiché à côté (voir décision Option A). Pas de risque de doublon
// visuel : `dossier.indicateurs` vient de `selectionIndicateurs`, un Set côté Indicateurs.jsx,
// donc déjà sans code dupliqué par construction.
export default function TableauDossiersSelectionnes({
  dossiers,
  libellePoste,
  libelleIndicateur,
  varianteIndicateur,
  varianteStatut,
  estIndicateurPoste,
  libelleDateCle,
  varianteDateCle,
}) {
  if (dossiers.length === 0) {
    return <p className="tableau-dossiers-selectionnes__vide">Aucun dossier pour cette sélection.</p>;
  }

  return (
    <div className="tableau-dossiers-selectionnes__scroll">
      <table className="tableau-dossiers-selectionnes">
        <thead>
          <tr>
            {/* Rang d'affichage (1, 2, 3...), pas dossier.id (déjà affiché juste après, voir
                "N° dossier") — même distinction et même patron que DossierList.jsx
                (.dossier-list__colonne-numero), sans la variante figée au défilement horizontal :
                ce tableau n'a pas de colonne figée (voir TableauDossiersSelectionnes.css). */}
            <th scope="col" className="tableau-dossiers-selectionnes__colonne-numero">
              N°
            </th>
            <th scope="col">N° dossier</th>
            <th scope="col">Candidat</th>
            <th scope="col">Poste</th>
            <th scope="col">Statut</th>
            <th scope="col">Indicateurs</th>
            <th scope="col">Dates clés</th>
          </tr>
        </thead>
        <tbody>
          {dossiers.map((dossier, index) => {
            // Calculée UNE fois par dossier, lue par les deux colonnes ci-dessous (Indicateurs
            // hors postes / Dates clés) au même index — voir construireColonnesAlignees plus haut.
            const { indicateurRows, dateRows } = construireColonnesAlignees(dossier, estIndicateurPoste);
            return (
              <tr key={dossier.id}>
                <td className="tableau-dossiers-selectionnes__colonne-numero">{index + 1}</td>
                <td>
                  <Link to={`/recruteur/dossiers/${dossier.id}/validation`}>#{dossier.id}</Link>
                </td>
                <td>
                  {dossier.candidat_prenom} {dossier.candidat_nom}
                </td>
                <td>
                  <div className="tableau-dossiers-selectionnes__postes">
                    {[...dossier.postesBureau, ...dossier.postesHotel].map((code) => (
                      <span key={code} className="tableau-dossiers-selectionnes__badge-poste">
                        {libellePoste(code)}
                      </span>
                    ))}
                  </div>
                </td>
                <td>
                  <StatutBadge libelle={dossier.statut_libelle} variante={varianteStatut(dossier.statut_code)} />
                </td>
                <td>
                  {/* Deux groupes visuellement distincts plutôt qu'une liste unique : un poste
                      ('poste:<code>'/'poste_non_specifie', issu du graphique de répartition) n'est
                      pas un indicateur de pilotage au même titre que "Inscrits"/"Test réussi"/... —
                      même style de puce grise que la colonne "Poste" (badge-poste, pas StatutBadge)
                      pour que le rapprochement visuel entre les deux colonnes soit immédiat.
                      `indicateurRows` (pas dossier.indicateurs directement) : mêmes badges dans le
                      même ordre, ENTRECOUPÉS de lignes vides là où construireColonnesAlignees a dû
                      compenser pour que "Délai inscription → test"/"Délai test → verdict" tombent à
                      la même hauteur que leur valeur dans "Dates clés" (voir la colonne suivante) —
                      aucun autre badge n'est concerné (item 4, décision utilisateur 2026-08-11). */}
                  <div className="tableau-dossiers-selectionnes__indicateurs">
                    {indicateurRows.map((ligne) =>
                      ligne.type === 'blank' ? (
                        <span
                          key={ligne.code}
                          className="tableau-dossiers-selectionnes__indicateur-ligne tableau-dossiers-selectionnes__indicateur-ligne--vide"
                          aria-hidden="true"
                        />
                      ) : (
                        <span key={ligne.code} className="tableau-dossiers-selectionnes__indicateur-ligne">
                          <StatutBadge libelle={libelleIndicateur(ligne.code)} variante={varianteIndicateur(ligne.code)} />
                        </span>
                      ),
                    )}
                  </div>
                  {dossier.indicateurs.some(({ code }) => estIndicateurPoste(code)) && (
                    <div className="tableau-dossiers-selectionnes__postes tableau-dossiers-selectionnes__postes--indicateurs">
                      {dossier.indicateurs
                        .filter(({ code }) => estIndicateurPoste(code))
                        .map(({ code }) => (
                          <span key={code} className="tableau-dossiers-selectionnes__badge-poste">
                            {libelleIndicateur(code)}
                          </span>
                        ))}
                    </div>
                  )}
                </td>
                <td>
                  {/* Dates simples (inscription/test planifié/verdict/orientation) : toujours
                      affichées quelle que soit la sélection des tuiles KPI (décision utilisateur,
                      2026-08-11, inchangé). Valeurs de délai ("X J", SANS le libellé — déjà porté
                      par le badge de la colonne "Indicateurs" à la même hauteur, pas de répétition,
                      décision utilisateur 2026-08-11) : affichées seulement si leur tuile est
                      sélectionnée, à la même position verticale que leur badge — voir
                      `dateRows`/construireColonnesAlignees plus haut, qui insère aussi les lignes
                      vides nécessaires à cet alignement (aucun rapport avec les dates simples,
                      toujours complètes ici). */}
                  <ul className="tableau-dossiers-selectionnes__dates">
                    {dateRows.map((ligne) =>
                      ligne.type === 'blank' ? (
                        <li
                          key={ligne.code}
                          className="tableau-dossiers-selectionnes__date-ligne tableau-dossiers-selectionnes__date-ligne--vide"
                          aria-hidden="true"
                        />
                      ) : ligne.type === 'delai-valeur' ? (
                        <li
                          key={ligne.code}
                          className="tableau-dossiers-selectionnes__date-ligne tableau-dossiers-selectionnes__date-ligne--delai"
                        >
                          <span className="tableau-dossiers-selectionnes__date-valeur">{ligne.jours} J</span>
                        </li>
                      ) : (
                        <li
                          key={ligne.code}
                          className={`tableau-dossiers-selectionnes__date-ligne tableau-dossiers-selectionnes__date-ligne--${varianteDateCle(ligne.code)}`}
                        >
                          <span className="tableau-dossiers-selectionnes__date-libelle">{libelleDateCle(ligne.code)}</span>
                          <span className="tableau-dossiers-selectionnes__date-valeur">
                            {FORMAT_DATE.format(new Date(ligne.date))}
                          </span>
                        </li>
                      ),
                    )}
                  </ul>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
