import { useEffect, useMemo, useState } from 'react';
import { obtenirDisponibilitesFormateur } from '../../services/rendezvousService';
import { dateDuJourParis } from './dateDuJourParis';
import './CalendrierHebdomadaireDisponibilite.css';

// Remplace CalendrierDisponibiliteFormateur.jsx (calendrier mensuel, aide visuelle basée sur Neon
// uniquement) dans ModalePlanificationTest.jsx — audit 2026-08-26, décision utilisateur : la
// planification s'appuie désormais sur le calendrier Outlook réel (formation@accecit.com /
// tertiaire2@accecit.com selon le rôle), donc le calendrier de sélection doit refléter la
// disponibilité RÉELLEMENT occupée sur Outlook, pas seulement ce qui a déjà été écrit dans Neon.
// CalendrierDisponibiliteFormateur.jsx reste inchangé et continue d'être utilisé ailleurs
// (PanneauHistoriqueRendezvous.jsx) — ce nouveau composant est spécifique à cette modale.

const JOURS_SEMAINE = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
// Dimanche = dernier jour de JOURS_SEMAINE (index 6, lundi-first comme le reste de ce projet, voir
// CalendrierDisponibiliteFormateur.jsx).
const INDEX_DIMANCHE = 6;

// Horaires ouvrés (décision utilisateur, 2026-08-26) : 8h-19h, lundi-samedi — 19h est une borne
// EXCLUSIVE (dernier créneau sélectionnable 18h45, même convention que dateFin exclusive ailleurs
// dans ce projet). Dimanche reste affiché (voir JOURS_SEMAINE) mais entièrement désactivé : les
// quelques rendez-vous du dimanche déjà présents dans les données réelles restent valides tels
// quels, simplement non recréables depuis ce calendrier (cas limite accepté).
const HEURE_DEBUT = 8;
const HEURE_FIN = 19;
// Même granularité que MINUTES_DISPONIBLES (ModalePlanificationTest.jsx, confirmé à l'audit du
// 2026-08-26) — un seul endroit si cette granularité change un jour serait préférable, mais ce
// fichier n'exporte pas encore cette constante séparément (voir Modularité, CLAUDE.md conventions
// du projet : dupliqué plutôt que partagé pour ce volume).
const PAS_MINUTES = 15;

// Repli affiché dans le bloc quand l'événement Outlook n'a pas de subject exploitable (événement
// privé, ou champ jamais renseigné) — un bloc occupé ne doit jamais rester vide/illisible.
const LIBELLE_OCCUPATION_PAR_DEFAUT = 'Occupé';

const CRENEAUX_HORAIRES = [];
for (let heure = HEURE_DEBUT; heure < HEURE_FIN; heure += 1) {
  for (let minute = 0; minute < 60; minute += PAS_MINUTES) {
    CRENEAUX_HORAIRES.push({ heure: String(heure).padStart(2, '0'), minute: String(minute).padStart(2, '0') });
  }
}

function pad(nombre) {
  return String(nombre).padStart(2, '0');
}

function formatDateJour(annee, moisIndex, jour) {
  return `${annee}-${pad(moisIndex + 1)}-${pad(jour)}`;
}

// `nombreJours` positif ou négatif — construit une Date locale à partir des composants y/m/d de
// `dateIso` (jamais new Date(dateIso) directement, qui l'interpréterait en UTC) puis laisse Date
// gérer les débordements de mois/année (même patron que moisSuivant/moisPrecedent,
// CalendrierDisponibiliteFormateur.jsx).
function ajouterJours(dateIso, nombreJours) {
  const [annee, mois, jour] = dateIso.split('-').map(Number);
  const date = new Date(annee, mois - 1, jour + nombreJours);
  return formatDateJour(date.getFullYear(), date.getMonth(), date.getDate());
}

// Lundi de la semaine contenant `dateIso` — getDay() renvoie 0 pour dimanche, d'où le décalage
// (jour + 6) % 7 pour obtenir un lundi-first (même calcul que CalendrierDisponibiliteFormateur.jsx
// pour le décalage du 1er du mois).
function lundiDeLaSemaine(dateIso) {
  const [annee, mois, jour] = dateIso.split('-').map(Number);
  const decalage = (new Date(annee, mois - 1, jour).getDay() + 6) % 7;
  return ajouterJours(dateIso, -decalage);
}

// Même construction que dateHeureChoisieIso (ModalePlanificationTest.jsx) : un datetime local SANS
// fuseau explicite, interprété par le navigateur dans son propre fuseau (Europe/Paris en usage
// normal, tablette d'accueil) — cohérent avec le reste du formulaire, jamais une conversion UTC
// indépendante qui décalerait l'heure affichée.
function versInstant(jourIso, heure, minute) {
  return new Date(`${jourIso}T${heure}:${minute}`).getTime();
}

const FORMAT_JOUR_MOIS = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit' });
const FORMAT_HEURE = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
function libelleJour(jourIso) {
  const [annee, mois, jour] = jourIso.split('-').map(Number);
  return FORMAT_JOUR_MOIS.format(new Date(annee, mois - 1, jour));
}

export default function CalendrierHebdomadaireDisponibilite({ formateurId, dateSelectionnee, heureSelectionnee, minuteSelectionnee, onSelectionnerCreneau }) {
  const [lundiAffiche, setLundiAffiche] = useState(() => lundiDeLaSemaine(dateDuJourParis()));
  const [evenements, setEvenements] = useState([]);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState(null);

  const joursAffiches = useMemo(
    () => Array.from({ length: 7 }, (_, index) => ajouterJours(lundiAffiche, index)),
    [lundiAffiche],
  );

  // Rechargé à chaque changement de semaine affichée OU de formateur/inspecteur sélectionné (voir
  // en-tête de fichier) — reflète toujours le calendrier Outlook RÉEL de la personne actuellement
  // choisie, jamais celui du groupe précédent si l'agent bascule Formateurs/Inspecteurs.
  useEffect(() => {
    if (!formateurId) {
      setEvenements([]);
      setErreur(null);
      return undefined;
    }
    let annule = false;
    setChargement(true);
    setErreur(null);
    const debut = new Date(`${lundiAffiche}T00:00:00`).toISOString();
    const fin = new Date(`${ajouterJours(lundiAffiche, 7)}T00:00:00`).toISOString();
    obtenirDisponibilitesFormateur({ formateurId: Number(formateurId), debut, fin })
      .then((valeur) => {
        if (!annule) setEvenements(valeur);
      })
      .catch((erreurRequete) => {
        if (!annule) {
          setErreur(
            erreurRequete.response?.data?.erreur ?? 'Impossible de récupérer les disponibilités Outlook de cette personne.',
          );
        }
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, [formateurId, lundiAffiche]);

  // Journée entière (ex. "CAFET BEGUM UDDIN FATEMA Report...") vs horaire — audit lisibilité
  // 2026-08-26 : un événement journée entière s'affichait avant répété sur chaque créneau de 15 min
  // de la journée (Outlook renvoie le même événement pour toute la plage horaire demandée). Séparés
  // ici une fois pour toutes : les événements journée entière vont dans le bandeau dédié
  // (calendrier-hebdo__bandeau-jour ci-dessous), les horaires seuls alimentent la grille de créneaux.
  const evenementsJourneeEntiere = useMemo(() => evenements.filter((evenement) => evenement.journeeEntiere), [evenements]);
  const evenementsHoraires = useMemo(() => evenements.filter((evenement) => !evenement.journeeEntiere), [evenements]);

  // Un événement occupe ce créneau si l'instant de DÉBUT du créneau tombe dans [debut, fin[ —
  // exactement le même calcul qu'avant l'audit lisibilité 2026-08-26 (teinte "occupé" du bouton,
  // aria-label). Peut renvoyer plusieurs événements (créneau avec occupations simultanées, voir
  // calculerBlocsJour ci-dessous pour leur affichage côte à côte).
  const trouverEvenementsOccupantCreneau = (jourIso, heure, minute) => {
    const instant = versInstant(jourIso, heure, minute);
    return evenementsHoraires.filter((evenement) => instant >= new Date(evenement.debut).getTime() && instant < new Date(evenement.fin).getTime());
  };

  // Un événement horaire recouvre le jour `jourIso` si un de ses créneaux affichés (CRENEAUX_HORAIRES)
  // en fait partie — réutilise EXACTEMENT le même prédicat que trouverEvenementsOccupantCreneau ci-
  // dessus (occupation par instant de début de créneau), pour que le bloc fusionné dessiné ci-dessous
  // corresponde toujours pile aux créneaux effectivement teintés "occupé", jamais un calcul de durée
  // séparé qui pourrait diverger (ex. arrondis différents sur un événement à cheval sur deux
  // créneaux).
  const calculerBlocEvenementJour = (evenement, jourIso) => {
    const indicesOccupes = [];
    CRENEAUX_HORAIRES.forEach(({ heure, minute }, indexCreneau) => {
      const instant = versInstant(jourIso, heure, minute);
      if (instant >= new Date(evenement.debut).getTime() && instant < new Date(evenement.fin).getTime()) {
        indicesOccupes.push(indexCreneau);
      }
    });
    if (indicesOccupes.length === 0) return null;
    // Un seul bloc couvrant du premier au dernier créneau occupé (+1, borne exclusive) — suffisant
    // ici puisque indicesOccupes est par construction une plage contiguë (le temps est linéaire et
    // CRENEAUX_HORAIRES est trié), jamais besoin de détecter plusieurs runs séparés pour un même
    // événement.
    return { evenement, creneauDebut: indicesOccupes[0], creneauFin: indicesOccupes[indicesOccupes.length - 1] + 1 };
  };

  // Un événement horaire recouvre `jourIso` si ses bornes [debut, fin[ chevauchent la plage
  // [00:00 jourIso, 00:00 lendemain[ EN HEURE LOCALE (Europe/Paris) — sert de pré-filtre à
  // blocsParJour ci-dessous, cohérent avec calculerBlocEvenementJour qui compare lui aussi des
  // instants locaux.
  const evenementRecouvreJour = (evenement, jourIso) => {
    const debutJour = versInstant(jourIso, '00', '00');
    const finJour = versInstant(ajouterJours(jourIso, 1), '00', '00');
    return new Date(evenement.debut).getTime() < finJour && new Date(evenement.fin).getTime() > debutJour;
  };

  // Un événement JOURNÉE ENTIÈRE recouvre `jourIso` si sa date civile de début (YYYY-MM-DD, lue
  // directement sur la chaîne ISO renvoyée par Graph, jamais via `new Date(...)` + fuseau local) est
  // `<= jourIso` et sa date civile de fin (bornée exclusive, même convention que dateFin ailleurs
  // dans ce projet) est `> jourIso`. Ne PAS réutiliser evenementRecouvreJour ci-dessus pour ce cas :
  // Graph renvoie un événement journée entière comme un minuit-à-minuit UTC « flottant » (ex.
  // 2026-08-28T00:00:00Z → 2026-08-29T00:00:00Z pour un événement d'UN SEUL jour, le 28/08) — un
  // recouvrement basé sur l'instant Europe/Paris (UTC+1/+2) ferait déborder ces 2h de décalage sur le
  // jour suivant et l'événement apparaîtrait à tort dans DEUX bandeaux (bug constaté à l'audit
  // lisibilité 2026-08-26 avec l'événement réel "FIN CT STEPHENSON CAMBON" sur tertiaire2@accecit.com,
  // affiché à la fois le 28/08 ET le 29/08 avant ce correctif).
  const evenementJourneeEntiereRecouvreJour = (evenement, jourIso) => {
    const dateCiviledeDebut = evenement.debut.slice(0, 10);
    const dateCivileDeFin = evenement.fin.slice(0, 10);
    return dateCiviledeDebut <= jourIso && jourIso < dateCivileDeFin;
  };

  // Un bloc par jour et par événement horaire distinct (voir calculerBlocEvenementJour), puis
  // affectation de colonnes par un algorithme glouton classique ("interval graph coloring") : la
  // colonne réutilisée est la première dont le dernier bloc placé se termine avant (ou au moment où)
  // celui-ci commence, sinon une nouvelle colonne est ouverte — répond au point 3 de l'audit lisibilité
  // 2026-08-26 (plusieurs événements simultanés affichés côte à côte, jamais l'un masquant l'autre).
  const blocsParJour = useMemo(() => {
    const parJour = new Map();
    joursAffiches.forEach((jourIso) => {
      const blocs = evenementsHoraires
        .filter((evenement) => evenementRecouvreJour(evenement, jourIso))
        .map((evenement) => calculerBlocEvenementJour(evenement, jourIso))
        .filter(Boolean)
        .sort((a, b) => a.creneauDebut - b.creneauDebut || a.creneauFin - b.creneauFin);

      const finColonnes = [];
      blocs.forEach((bloc) => {
        let colonne = finColonnes.findIndex((fin) => fin <= bloc.creneauDebut);
        if (colonne === -1) colonne = finColonnes.length;
        finColonnes[colonne] = bloc.creneauFin;
        bloc.colonne = colonne;
      });

      parJour.set(jourIso, { blocs, nombreColonnes: Math.max(finColonnes.length, 1) });
    });
    return parJour;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- evenementsHoraires est déjà une
    // dépendance stable via son propre useMemo([evenements]) ci-dessus.
  }, [joursAffiches, evenementsHoraires]);

  // Événements journée entière par jour couvert (voir evenementJourneeEntiereRecouvreJour) — un
  // événement multi-jours apparaît une fois dans le bandeau de CHAQUE jour qu'il couvre, jamais
  // fusionné entre colonnes de jours différents (contrairement à blocsParJour, ce bandeau n'a pas de
  // grille horaire à respecter).
  const journeeEntiereParJour = useMemo(() => {
    const parJour = new Map();
    joursAffiches.forEach((jourIso) => {
      parJour.set(
        jourIso,
        evenementsJourneeEntiere.filter((evenement) => evenementJourneeEntiereRecouvreJour(evenement, jourIso)),
      );
    });
    return parJour;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- même remarque que blocsParJour ci-dessus.
  }, [joursAffiches, evenementsJourneeEntiere]);

  // Index du créneau actuellement sélectionné dans CRENEAUX_HORAIRES — sert uniquement à faire
  // ressortir (léger contour bleu) le bloc Outlook qui recouvre la sélection en cours, pour que
  // l'agent voie que le créneau choisi tombe sur une occupation existante sans que le bloc n'efface
  // entièrement la couleur de sélection du bouton dessous (voir .calendrier-hebdo__evenement-bloc--
  // selectionne, CSS).
  const indexCreneauSelectionne = CRENEAUX_HORAIRES.findIndex(
    (creneau) => creneau.heure === heureSelectionnee && creneau.minute === minuteSelectionnee,
  );

  const libelleSemaine = `${libelleJour(joursAffiches[0])} au ${libelleJour(joursAffiches[6])}`;

  return (
    <div className="calendrier-hebdo">
      <div className="calendrier-hebdo__entete">
        <button type="button" onClick={() => setLundiAffiche(ajouterJours(lundiAffiche, -7))} aria-label="Semaine précédente">
          ‹
        </button>
        <div className="calendrier-hebdo__titre">
          <span>Semaine du {libelleSemaine}</span>
          {lundiAffiche !== lundiDeLaSemaine(dateDuJourParis()) && (
            <button
              type="button"
              className="calendrier-hebdo__aujourdhui"
              onClick={() => setLundiAffiche(lundiDeLaSemaine(dateDuJourParis()))}
            >
              Cette semaine
            </button>
          )}
        </div>
        <button type="button" onClick={() => setLundiAffiche(ajouterJours(lundiAffiche, 7))} aria-label="Semaine suivante">
          ›
        </button>
      </div>

      {!formateurId && <p className="calendrier-hebdo__statut">Sélectionnez un formateur/inspecteur pour voir ses disponibilités.</p>}
      {chargement && <p className="calendrier-hebdo__statut">Chargement des disponibilités Outlook…</p>}
      {erreur && <p className="calendrier-hebdo__statut" role="alert">{erreur}</p>}

      {formateurId && (
        <div className="calendrier-hebdo__grille-scroll">
          <div className="calendrier-hebdo__grille">
            <div className="calendrier-hebdo__coin" />
            {joursAffiches.map((jourIso, indexJour) => (
              <div
                key={jourIso}
                className={`calendrier-hebdo__entete-jour${indexJour === INDEX_DIMANCHE ? ' calendrier-hebdo__entete-jour--dimanche' : ''}`}
              >
                <span>{JOURS_SEMAINE[indexJour]}</span>
                <span className="calendrier-hebdo__entete-jour-date">{libelleJour(jourIso)}</span>
              </div>
            ))}

            {/* Bandeau "journée entière" (point 1 de l'audit lisibilité 2026-08-26) — une seule
                ligne au-dessus de la grille horaire, un événement de ce type n'y apparaît qu'une
                fois par jour qu'il couvre, jamais répété sur chaque créneau de 15 min en dessous.
                Ligne entière masquée quand aucun événement journée entière cette semaine, pour ne
                pas gaspiller de hauteur d'écran la majorité du temps. */}
            {evenementsJourneeEntiere.length > 0 && (
              <>
                <div className="calendrier-hebdo__bandeau-coin">Journée</div>
                {joursAffiches.map((jourIso) => (
                  <div key={`bandeau-${jourIso}`} className="calendrier-hebdo__bandeau-jour">
                    {journeeEntiereParJour.get(jourIso).map((evenement, indexEvenement) => (
                      <span
                        key={indexEvenement}
                        className="calendrier-hebdo__bandeau-evenement"
                        title={`${evenement.sujet || LIBELLE_OCCUPATION_PAR_DEFAUT} (journée entière)`}
                      >
                        {evenement.sujet || LIBELLE_OCCUPATION_PAR_DEFAUT}
                      </span>
                    ))}
                  </div>
                ))}
              </>
            )}

            <div className="calendrier-hebdo__colonne-heures">
              {CRENEAUX_HORAIRES.map(({ heure, minute }) => (
                <div key={`${heure}:${minute}`} className="calendrier-hebdo__heure-label">
                  {minute === '00' ? `${heure}:00` : ''}
                </div>
              ))}
            </div>

            {joursAffiches.map((jourIso, indexJour) => {
              const dimanche = indexJour === INDEX_DIMANCHE;
              const { blocs, nombreColonnes } = blocsParJour.get(jourIso);

              return (
                <div
                  key={jourIso}
                  className="calendrier-hebdo__colonne-jour"
                  // `grid-template-rows` explicite (pas seulement `grid-auto-rows` en CSS) —
                  // indispensable pour que `grid-row: 1 / -1` sur .calendrier-hebdo__evenements-
                  // overlay ci-dessous résolve correctement : `-1` ne compte que les lignes de la
                  // grille EXPLICITE, jamais les pistes implicites créées par l'auto-placement des
                  // boutons créneaux — sans cette ligne, l'overlay se retrouvait à hauteur 0 (bloc
                  // invisible, seule la teinte "occupé" du bouton dessous restait visible).
                  style={{ gridTemplateRows: `repeat(${CRENEAUX_HORAIRES.length}, 2rem)` }}
                >
                  {CRENEAUX_HORAIRES.map(({ heure, minute }) => {
                    const passe = versInstant(jourIso, heure, minute) < Date.now();
                    const evenementsOccupants = trouverEvenementsOccupantCreneau(jourIso, heure, minute);
                    const occupe = evenementsOccupants.length > 0;
                    const libelleOccupation = occupe
                      ? evenementsOccupants.map((evenement) => evenement.sujet || LIBELLE_OCCUPATION_PAR_DEFAUT).join(', ')
                      : null;
                    const selectionne = jourIso === dateSelectionnee && heure === heureSelectionnee && minute === minuteSelectionnee;
                    // Occupation Outlook : informative uniquement depuis l'audit 2026-08-26 (décision
                    // utilisateur) — un créneau occupé reste sélectionnable, l'agent choisit en
                    // connaissance de cause. Seules les dates/heures passées (et dimanche, hors
                    // horaires ouvrés) restent bloquées ici ; le garde-fou qui fait foi reste de toute
                    // façon compterRendezvousFormateurAuCreneau côté serveur à la confirmation.
                    const desactive = dimanche || passe || chargement;

                    return (
                      <button
                        type="button"
                        key={`${jourIso}-${heure}${minute}`}
                        className={[
                          'calendrier-hebdo__creneau',
                          dimanche ? 'calendrier-hebdo__creneau--dimanche' : '',
                          occupe ? 'calendrier-hebdo__creneau--occupe' : '',
                          selectionne ? 'calendrier-hebdo__creneau--selectionne' : '',
                        ]
                          .join(' ')
                          .trim()}
                        disabled={desactive}
                        aria-disabled={desactive}
                        aria-label={`${JOURS_SEMAINE[indexJour]} ${libelleJour(jourIso)} à ${heure}h${minute}${occupe ? ` (occupé : ${libelleOccupation})` : ''}`}
                        onClick={() => onSelectionnerCreneau(jourIso, heure, minute)}
                      />
                    );
                  })}

                  {/* Un bloc par événement horaire distinct, positionné sur sa vraie plage de
                      créneaux (points 2 et 3 de l'audit lisibilité 2026-08-26) — `pointer-events:
                      none` en cascade depuis .calendrier-hebdo__evenements-overlay (CSS) : le clic
                      doit toujours atteindre le bouton créneau dessous, jamais être intercepté par
                      un bloc qui ne couvre qu'une partie de la largeur de la colonne (occupations
                      simultanées côte à côte). */}
                  <div
                    className="calendrier-hebdo__evenements-overlay"
                    style={{ gridTemplateColumns: `repeat(${nombreColonnes}, 1fr)`, gridTemplateRows: `repeat(${CRENEAUX_HORAIRES.length}, 1fr)` }}
                  >
                    {blocs.map((bloc, indexBloc) => {
                      const selectionneDansBloc =
                        jourIso === dateSelectionnee &&
                        indexCreneauSelectionne >= bloc.creneauDebut &&
                        indexCreneauSelectionne < bloc.creneauFin;
                      const libelle = bloc.evenement.sujet || LIBELLE_OCCUPATION_PAR_DEFAUT;

                      return (
                        <div
                          key={indexBloc}
                          className={`calendrier-hebdo__evenement-bloc${selectionneDansBloc ? ' calendrier-hebdo__evenement-bloc--selectionne' : ''}`}
                          style={{
                            gridRow: `${bloc.creneauDebut + 1} / ${bloc.creneauFin + 1}`,
                            gridColumn: `${bloc.colonne + 1} / span 1`,
                          }}
                          title={`${libelle} (${FORMAT_HEURE.format(new Date(bloc.evenement.debut))}–${FORMAT_HEURE.format(new Date(bloc.evenement.fin))}) — reste sélectionnable`}
                        >
                          {libelle}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
