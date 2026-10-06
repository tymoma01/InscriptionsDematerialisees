import { formaterHeure } from './formatsDpae.js';
import { STATUTS_A_DECIDER } from './statutsDpae.js';

// Urgence d'une demande DPAE (2026-10-02) — SOURCE UNIQUE du calcul, partagée par la liste RH
// (TraitementDpae.jsx), « Suivi des demandes DPAE » (SuiviDemandesDpae.jsx) et la fiche
// (DetailDemandeDpae.jsx), ainsi que par le tri par échéance de la liste RH. Calculée à
// l'affichage, jamais stockée. Module pur (aucune dépendance React), testé par urgenceDpae.test.js
// (npm test).
//
// Échéance : premier jour du salarié, à l'heure d'arrivée du jour 1 si elle est renseignée, sinon à
// 00h00 ce jour-là (heure du poste, comme l'affichage des dates). Délai = échéance - maintenant :
//   > 72 h          -> vert
//   48 h à 72 h     -> orange (72 h et 48 h incluses)
//   0 à moins de 48 h -> rouge (0 inclus : l'échéance n'est pas encore dépassée)
//   < 0             -> rouge « En retard » (premier jour dépassé)
// Seulement pour les demandes non décidées (« À valider par le Planning », « Renvoyée à l'inspecteur »,
// « À traiter », « En attente ») ; aucune pastille sans premier jour.

// Statuts avec pastille : ceux d'une demande encore sans décision (statutsDpae.js).
export const STATUTS_AVEC_URGENCE = STATUTS_A_DECIDER;

const MINUTE_MS = 60 * 1000;
const HEURE_MS = 60 * MINUTE_MS;
export const SEUIL_ORANGE_MS = 72 * HEURE_MS;
export const SEUIL_ROUGE_MS = 48 * HEURE_MS;

// Pastille (StatutBadge) par niveau — variantes pleines dédiées (StatutBadge.css, --urgence-* dans
// variables.css) : les variantes de statut 'alerte' et 'echec' sont trop proches pour distinguer
// orange et rouge. « En retard » : même rouge, la mention fait la différence.
const VARIANTE_PAR_NIVEAU = { vert: 'urgence-vert', orange: 'urgence-orange', rouge: 'urgence-rouge', retard: 'urgence-rouge' };

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

// Instant de l'échéance (Date), ou null si le premier jour n'est pas renseigné.
export function echeanceDemande(demande) {
  if (!demande?.date_debut) return null;
  const jour = new Date(demande.date_debut);
  if (Number.isNaN(jour.getTime())) return null;
  const heure = /^(\d{1,2}):(\d{2})/.exec(demande.heure_arrivee_j1 ?? '');
  const [heures, minutes] = heure ? [Number(heure[1]), Number(heure[2])] : [0, 0];
  return new Date(jour.getFullYear(), jour.getMonth(), jour.getDate(), heures, minutes);
}

// « 2 j 5 h 30 min » — parties nulles omises ; moins d'une minute : « moins d'une minute ».
export function formaterDuree(millisecondes) {
  const totalMinutes = Math.floor(Math.abs(millisecondes) / MINUTE_MS);
  const jours = Math.floor(totalMinutes / (24 * 60));
  const heures = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parties = [jours && `${jours} j`, heures && `${heures} h`, minutes && `${minutes} min`].filter(Boolean);
  return parties.length > 0 ? parties.join(' ') : "moins d'une minute";
}

// Nombre de jours calendaires entre aujourd'hui et le premier jour (« J-5 »).
function joursCalendaires(maintenant, echeance) {
  const jour = (date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((jour(echeance) - jour(maintenant)) / (24 * HEURE_MS));
}

// { niveau, variante, libelle, infoBulle, delaiMs } ou null (statut sans pastille, premier jour
// non renseigné).
export function calculerUrgence(demande, maintenant = new Date()) {
  if (!STATUTS_AVEC_URGENCE.includes(demande?.statut)) return null;
  const echeance = echeanceDemande(demande);
  if (!echeance) return null;

  const delaiMs = echeance.getTime() - maintenant.getTime();
  let niveau = 'vert';
  if (delaiMs < 0) niveau = 'retard';
  else if (delaiMs < SEUIL_ROUGE_MS) niveau = 'rouge';
  else if (delaiMs <= SEUIL_ORANGE_MS) niveau = 'orange';

  let libelle = 'En retard';
  if (niveau !== 'retard') {
    const jours = joursCalendaires(maintenant, echeance);
    libelle = jours <= 0 ? 'Jour J' : `J-${jours}`;
  }

  const heureArrivee = demande.heure_arrivee_j1 ? formaterHeure(demande.heure_arrivee_j1) : "00h00 (heure d'arrivée non renseignée)";
  const quand = `le ${FORMAT_DATE.format(echeance)} à ${heureArrivee}`;
  const infoBulle =
    niveau === 'retard'
      ? `En retard de ${formaterDuree(delaiMs)} : premier jour ${quand}`
      : `Premier jour dans ${formaterDuree(delaiMs)} : ${quand}`;

  return { niveau, variante: VARIANTE_PAR_NIVEAU[niveau], libelle, infoBulle, delaiMs };
}

// Tri par échéance croissante (la plus proche d'abord ; les demandes en retard, échéance déjà
// passée, se retrouvent donc tout en haut). Sans premier jour : en fin de liste. Tri stable : à
// échéance égale, l'ordre reçu du serveur est conservé. Ne modifie pas le tableau reçu.
export function trierParEcheance(demandes) {
  const cle = (demande) => echeanceDemande(demande)?.getTime() ?? Number.POSITIVE_INFINITY;
  return [...demandes].sort((a, b) => cle(a) - cle(b));
}
