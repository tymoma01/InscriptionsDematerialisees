// Dates imprimées au verso de l'ancienne carte d'identité (sans bande MRZ de ce côté) : « Carte
// valable jusqu'au : 26.12.2034 », « délivrée le : 27.12.2019 ». Sans clé de contrôle, une date
// n'est retenue que si elle est vraisemblable, et le candidat la confirme.

// L'OCR lit les séparateurs en points, espaces ou rien : « 26.12.2034 », « 26 12 2034 », « 26.12. 2034 ».
const DATE = /(\d{2})\s*[.,/-]?\s*(\d{2})\s*[.,/-]?\s*((?:19|20)\d{2})/g;
const UNE_DATE = new RegExp(DATE.source);
const EXPIRATION = /valable|jusqu/i;
const DELIVRANCE = /d[ée]livr|livr[ée]e/i;

// Première carte plastifiée : 1988 ; validité de 10 ou 15 ans.
const PREMIERE_DELIVRANCE = '1988-01-01';
const VALIDITE_MAX_ANS = 20;

/** JJ, MM, AAAA → AAAA-MM-JJ, ou null si la date n'existe pas (31.02…). */
function iso(jj, mm, aaaa) {
  const date = new Date(Date.UTC(Number(aaaa), Number(mm) - 1, Number(jj)));
  const resultat = `${aaaa}-${mm}-${jj}`;
  return date.toISOString().slice(0, 10) === resultat ? resultat : null;
}

/** Dates de la ligne, null pour une date lue mais impossible. */
const dates = (ligne) => [...ligne.matchAll(DATE)].map(([, jj, mm, aaaa]) => iso(jj, mm, aaaa));

/**
 * Première date de la ligne au libellé cherché, ou de la suivante si elle n'en a pas (libellé et date
 * parfois séparés par l'OCR) et ne porte pas l'autre libellé.
 */
function dateApres(lignes, libelle) {
  const index = lignes.findIndex((l) => libelle.test(l));
  if (index === -1) return null;
  const [date = null] = dates(lignes[index]);
  if (date !== null || UNE_DATE.test(lignes[index])) return date;
  const suivante = lignes[index + 1] ?? '';
  return EXPIRATION.test(suivante) || DELIVRANCE.test(suivante) ? null : (dates(suivante)[0] ?? null);
}

const ajouterAns = (dateIso, ans) => `${Number(dateIso.slice(0, 4)) + ans}${dateIso.slice(4)}`;

/**
 * { expire_le, delivree_le } lus dans le texte reconnu, chacun null s'il manque ou n'est pas
 * vraisemblable ; null si aucun n'est lu. Libellés illisibles : le verso ne porte que ces deux dates,
 * la plus ancienne est la délivrance.
 */
export function analyserVerso(texteReconnu, aujourdhui = new Date().toISOString().slice(0, 10)) {
  const lignes = texteReconnu.split('\n').filter((l) => l.trim());
  let expiration = dateApres(lignes, EXPIRATION);
  let delivrance = dateApres(lignes, DELIVRANCE);
  if (!expiration && !delivrance) {
    const toutes = [...new Set(dates(texteReconnu).filter(Boolean))].sort();
    if (toutes.length === 2) [delivrance, expiration] = toutes;
  }

  if (delivrance && (delivrance < PREMIERE_DELIVRANCE || delivrance > aujourdhui)) delivrance = null;
  if (expiration && expiration <= PREMIERE_DELIVRANCE) expiration = null;
  // L'une des deux est mal lue, sans qu'on sache laquelle : aucune n'est retenue.
  if (delivrance && expiration && (expiration <= delivrance || expiration > ajouterAns(delivrance, VALIDITE_MAX_ANS))) {
    return null;
  }
  return expiration || delivrance ? { expire_le: expiration, delivree_le: delivrance } : null;
}

/**
 * Date d'une photo prise de près sur ce seul champ (« 26.12.2034 »), au même contrôle de
 * vraisemblance que le verso ; null si elle est absente, impossible ou ambiguë (plusieurs dates).
 */
export function analyserDate(texteReconnu, nature, aujourdhui = new Date().toISOString().slice(0, 10)) {
  const lues = [...new Set(dates(texteReconnu))];
  if (lues.length !== 1 || lues[0] === null) return null;
  const [date] = lues;
  if (nature === 'delivree_le') return date >= PREMIERE_DELIVRANCE && date <= aujourdhui ? date : null;
  return date > PREMIERE_DELIVRANCE ? date : null;
}
