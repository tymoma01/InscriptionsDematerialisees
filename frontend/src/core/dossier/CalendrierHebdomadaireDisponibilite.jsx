import { Fragment, useEffect, useMemo, useState } from 'react';
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

  const estOccupe = (jourIso, heure, minute) => {
    const instant = versInstant(jourIso, heure, minute);
    return evenements.some((evenement) => instant >= new Date(evenement.debut).getTime() && instant < new Date(evenement.fin).getTime());
  };

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

            {CRENEAUX_HORAIRES.map(({ heure, minute }) => (
              <Fragment key={`${heure}:${minute}`}>
                <div className="calendrier-hebdo__heure-label">{minute === '00' ? `${heure}:00` : ''}</div>
                {joursAffiches.map((jourIso, indexJour) => {
                  const dimanche = indexJour === INDEX_DIMANCHE;
                  const passe = versInstant(jourIso, heure, minute) < Date.now();
                  const occupe = !dimanche && !passe && estOccupe(jourIso, heure, minute);
                  const selectionne = jourIso === dateSelectionnee && heure === heureSelectionnee && minute === minuteSelectionnee;
                  const desactive = dimanche || passe || occupe || chargement;

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
                      aria-label={`${JOURS_SEMAINE[indexJour]} ${libelleJour(jourIso)} à ${heure}h${minute}`}
                      title={occupe ? 'Déjà occupé sur le calendrier Outlook' : undefined}
                      onClick={() => onSelectionnerCreneau(jourIso, heure, minute)}
                    />
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
