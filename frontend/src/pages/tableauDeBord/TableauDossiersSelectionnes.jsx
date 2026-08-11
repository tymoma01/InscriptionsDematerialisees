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

const [CODE_DELAI_INSCRIPTION_TEST, CODE_DELAI_TEST_VERDICT] = ['delai_inscription_test', 'delai_test_verdict'];

// Codes de "Dates clés" (dossier.datesCles, toujours inscription/test_planifie?/orientation_*? —
// plus de "verdict_*", retiré le 2026-08-11 car redondant avec la colonne "Statut") dont le badge
// "Indicateurs" correspondant porte EXACTEMENT le même sens (même événement, juste vu depuis deux
// colonnes différentes) — sert à aligner ces lignes de date sur leur badge, au même titre que les
// deux délais ci-dessous : chaque ligne de "Dates clés" garde son libellé texte visible (retour en
// arrière du 2026-08-11 — un retrait tenté juste avant, en s'appuyant uniquement sur cet
// alignement, a été jugé moins lisible), mais l'alignement lui-même reste utile en soi : la même
// information lue à la même hauteur dans les deux colonnes, plutôt qu'à des hauteurs disjointes
// selon l'ordre de clic des tuiles. `orientation_envoi_formation`/`orientation_pret_embauche` ont
// déjà le même code des deux côtés (voir statistiquesService.listerDossiersParIndicateurs) —
// inutile de les lister ici en plus, CODE_DATE === CODE_BADGE pour ces deux-là, gérés par le filet
// `codeBadge ?? d.code` plus bas.
const CODE_BADGE_PAR_CODE_DATE = {
  inscription: 'inscrits',
  test_planifie: 'envoyes_en_test',
};

// Construit, pour UN dossier, les deux colonnes ("Indicateurs" hors postes / "Dates clés") déjà
// alignées ligne à ligne — structure de données commune lue par les DEUX colonnes au même index
// (décision utilisateur, 2026-08-11), pour ne plus dépendre d'un calcul indépendant de chaque
// côté : l'ordre des badges dans "Indicateurs" suit l'ordre de clic des tuiles (imprévisible),
// alors que "Dates clés" a un ordre chronologique fixe (inscription → test planifié → orientation)
// — les deux ne peuvent physiquement coïncider sans concertation.
//
// Deux natures d'"ancre", unifiées dans une seule liste triée par position chronologique
// (`positionDate`) puis traitées par la même boucle :
// - "existante" (Inscrit↔Inscription, Envoyé en test↔Test planifié, Orienté formation/embauche↔
//   Orientation) : la ligne de date existe déjà dans `dates`, on se contente de CONTRÔLER QUAND
//   elle est consommée pour qu'elle tombe à la hauteur de son badge — rien n'est inséré.
// - "délai" (les deux indicateurs de délai) : aucune ligne de date n'existe pour ce badge, une
//   valeur ("X J") est INSÉRÉE À la position choisie, sans consommer d'entrée de `dates`.
// Un badge dont le code n'a pas d'ancre (Retenu, Test réussi/échoué — plus de contrepartie datée
// depuis le retrait de "Verdict" — segments "Répartition par poste") reste affiché tel quel, sans
// ligne "Dates clés" dédiée ni tentative d'alignement (pas concerné par cette fonction).
// Devant chaque ancre, on recopie tel quel tout ce qui la précède dans chaque colonne, puis on
// COMBLE l'écart de hauteur (nombre de lignes déjà posées) avec des lignes vides du côté le plus
// court, avant de poser l'ancre elle-même — qui tombe donc forcément à la même hauteur des deux
// côtés. Après la dernière ancre, le reste de chaque colonne est recopié tel quel.
//
// "Dates clés" strictement calée sur la sélection des tuiles (décision utilisateur, 2026-08-12 —
// revient sur le "toujours tout l'historique" du 2026-08-11) : une ligne de `dates` dont le badge
// correspondant n'est PAS actuellement sélectionné n'est PLUS émise du tout (ni comme ancre, ni en
// repli) — seulement "consommée" silencieusement par le curseur pour ne pas décaler les ancres
// suivantes. `dates` (positions/dates brutes) reste néanmoins lu SANS filtrage préalable : les deux
// délais continuent de se positionner/calculer sur l'historique COMPLET du dossier (première
// planification, dernière planification avant verdict...), indépendamment de la sélection des
// tuiles "Inscrit"/"Envoyé en test"/"Orienté ..." — comportement déjà validé, à ne pas coupler à ce
// changement (voir estDateBadgeSelectionne, utilisée uniquement au moment d'ÉMETTRE une ligne, pas
// pour le calcul des positions/valeurs de délai).
function construireColonnesAlignees(dossier, estIndicateurPoste) {
  const badges = dossier.indicateurs.filter(({ code }) => !estIndicateurPoste(code));
  const dates = dossier.datesCles; // historique complet, non filtré (voir commentaire ci-dessus)

  function estDateBadgeSelectionne(d) {
    const codeBadge = CODE_BADGE_PAR_CODE_DATE[d.code] ?? d.code;
    return badges.some((b) => b.code === codeBadge);
  }

  const ancres = [];

  // Ancres "existante" : une par ligne de `dates`, si son badge correspondant est affiché.
  // `codeBadge` (rendu dans "Indicateurs") et `codeDate` (rendu/consommé dans "Dates clés")
  // gardés DISTINCTS : ce sont deux codes différents pour inscrits/inscription et envoyes_en_test/
  // test_planifie (seuls orientation_* partagent le même code des deux côtés).
  dates.forEach((d, indexDate) => {
    const codeBadge = CODE_BADGE_PAR_CODE_DATE[d.code] ?? d.code; // orientation_* : même code des 2 côtés
    const indexBadge = badges.findIndex((b) => b.code === codeBadge);
    if (indexBadge !== -1) {
      ancres.push({ codeBadge, codeDate: d.code, type: 'existante', indexBadge, positionDate: indexDate });
    }
  });

  // Ancre "délai inscription → test" : insérée juste après "Test planifié" (comme avant).
  const indexTestPlanifie = dates.findIndex((d) => d.code === 'test_planifie');
  const indexDelai1Badge = badges.findIndex((b) => b.code === CODE_DELAI_INSCRIPTION_TEST);
  if (indexDelai1Badge !== -1 && indexTestPlanifie !== -1) {
    ancres.push({
      codeBadge: CODE_DELAI_INSCRIPTION_TEST,
      codeDate: CODE_DELAI_INSCRIPTION_TEST,
      type: 'delai',
      indexBadge: indexDelai1Badge,
      positionDate: indexTestPlanifie + 1,
      jours: joursCalendairesEntre(trouverDateCle(dossier, 'inscription'), dates[indexTestPlanifie].date),
    });
  }

  // Ancre "délai test → verdict" : plus de ligne "Verdict" à laquelle s'accrocher (retirée) — en
  // fin de liste (`dates.length`, après "Orientation" si présente, sinon juste après "Test
  // planifié") : c'est de toute façon la dernière étape connue de "Dates clés" à ce stade du
  // parcours. Dates de calcul via les champs dédiés `dossier.dateDernierTestPlanifieAvantVerdict`/
  // `dossier.dateVerdict` (pas `dates[...]`, qui ne porte plus l'info verdict) — correctif audit
  // 2026-08-11 : la planification retenue est la PLUS RÉCENTE avant le verdict (définition
  // validée de statistiquesRepository.delaiTestVersVerdict), pas la première.
  const indexDelai2Badge = badges.findIndex((b) => b.code === CODE_DELAI_TEST_VERDICT);
  if (indexDelai2Badge !== -1 && dossier.dateDernierTestPlanifieAvantVerdict && dossier.dateVerdict) {
    ancres.push({
      codeBadge: CODE_DELAI_TEST_VERDICT,
      codeDate: CODE_DELAI_TEST_VERDICT,
      type: 'delai',
      indexBadge: indexDelai2Badge,
      positionDate: dates.length,
      jours: joursCalendairesEntre(dossier.dateDernierTestPlanifieAvantVerdict, dossier.dateVerdict),
    });
  }

  // Tri stable par position chronologique — à égalité (délai test→verdict sans orientation,
  // positionDate = dates.length pour lui ET pour un éventuel dernier élément "existante"), l'ordre
  // de construction ci-dessus (délai1 avant délai2, "existante" avant "délai") fait déjà foi.
  ancres.sort((a, b) => a.positionDate - b.positionDate);

  const indicateurRows = [];
  const dateRows = [];
  let curseurBadge = 0;
  let curseurDate = 0;

  for (const ancre of ancres) {
    while (curseurBadge < ancre.indexBadge) {
      indicateurRows.push({ type: 'badge', code: badges[curseurBadge].code });
      curseurBadge += 1;
    }
    while (curseurDate < ancre.positionDate) {
      // Ne pousse une ligne QUE si son badge est sélectionné (voir commentaire de la fonction) —
      // ne devrait normalement jamais se produire ici : toute date dont le badge est sélectionné a
      // déjà sa propre ancre, traitée à son tour par ce même for. Garde défensive plutôt qu'une
      // hypothèse silencieuse.
      if (estDateBadgeSelectionne(dates[curseurDate])) {
        dateRows.push({ type: 'date', code: dates[curseurDate].code, date: dates[curseurDate].date });
      }
      curseurDate += 1;
    }
    const ecart = indicateurRows.length - dateRows.length;
    if (ecart > 0) {
      for (let k = 0; k < ecart; k += 1) dateRows.push({ type: 'blank', code: `blank-date-${ancre.codeBadge}-${k}` });
    } else if (ecart < 0) {
      for (let k = 0; k < -ecart; k += 1) indicateurRows.push({ type: 'blank', code: `blank-badge-${ancre.codeBadge}-${k}` });
    }
    indicateurRows.push({ type: 'badge', code: ancre.codeBadge });
    if (ancre.type === 'delai') {
      dateRows.push({ type: 'delai-valeur', code: ancre.codeDate, jours: ancre.jours });
      // curseurDate ne bouge pas : l'ancre s'insère AVANT dates[ancre.positionDate] (ou en fin de
      // liste), qui reste à consommer par le segment suivant (ou la boucle de fin ci-dessous).
    } else {
      dateRows.push({ type: 'date', code: dates[ancre.positionDate].code, date: dates[ancre.positionDate].date });
      curseurDate = ancre.positionDate + 1; // celle-ci est bien consommée (ligne existante posée).
    }
    curseurBadge = ancre.indexBadge + 1;
  }
  while (curseurBadge < badges.length) {
    indicateurRows.push({ type: 'badge', code: badges[curseurBadge].code });
    curseurBadge += 1;
  }
  while (curseurDate < dates.length) {
    if (estDateBadgeSelectionne(dates[curseurDate])) {
      dateRows.push({ type: 'date', code: dates[curseurDate].code, date: dates[curseurDate].date });
    }
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
                  {/* Dates simples (inscription/test planifié/orientation — plus de "verdict_*",
                      redondant avec la colonne "Statut", retiré le 2026-08-11) : depuis le
                      2026-08-12, affichées SEULEMENT si leur tuile est sélectionnée, exactement
                      comme les badges de la colonne "Indicateurs" — revient sur le "toujours tout
                      l'historique" du 2026-08-11 (voir construireColonnesAlignees,
                      estDateBadgeSelectionne, ci-dessus). AVEC leur libellé texte (revenu le
                      2026-08-11, inchangé par ce nouveau changement). Valeurs de délai ("X J", sans
                      libellé — déjà porté par le badge "Indicateurs" à la même hauteur) : déjà
                      conditionnées à la sélection de leur propre tuile depuis un précédent
                      changement, non affectées ici — toujours à la même position verticale que
                      leur badge, voir `dateRows`/construireColonnesAlignees plus haut, qui insère
                      aussi les lignes vides nécessaires à cet alignement. */}
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
                          aria-label={libelleIndicateur(ligne.code)}
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
