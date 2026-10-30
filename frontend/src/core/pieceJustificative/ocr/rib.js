// Lecture de l'IBAN et du BIC dans le texte reconnu sur la photo d'un RIB. Mise en page libre d'une
// banque à l'autre : on cherche des suites au bon format, retenues seulement si elles se contrôlent
// (clé modulo 97 de l'IBAN, BIC du même pays que l'IBAN). Jamais de valeur devinée.
import { ibanValide } from './iban';

// Longueur de l'IBAN de chaque pays de la zone SEPA (registre ISO 13616) : un candidat d'un autre
// « pays » (deux lettres d'un mot du RIB) ou d'une autre longueur n'est pas testé, sans quoi la clé
// modulo 97 laisserait passer une suite quelconque une fois sur 97.
const LONGUEURS = {
  AD: 24,
  AT: 20,
  BE: 16,
  BG: 22,
  CH: 21,
  CY: 28,
  CZ: 24,
  DE: 22,
  DK: 18,
  EE: 20,
  ES: 24,
  FI: 18,
  FR: 27,
  GB: 22,
  GI: 23,
  GR: 27,
  HR: 21,
  HU: 28,
  IE: 22,
  IS: 26,
  IT: 27,
  LI: 21,
  LT: 20,
  LU: 20,
  LV: 21,
  MC: 27,
  MT: 31,
  NL: 18,
  NO: 15,
  PL: 28,
  PT: 25,
  RO: 24,
  SE: 24,
  SI: 19,
  SK: 24,
  SM: 27,
  VA: 22,
};

// Chiffres que l'OCR lit parfois comme des lettres (« 02 » lu « O2 »…).
const CHIFFRES = { O: '0', D: '0', Q: '0', I: '1', L: '1', Z: '2', S: '5', B: '8' };

// Positions [début, fin[ qui ne peuvent être que des chiffres : la clé de l'IBAN (3 et 4) partout ;
// pour un IBAN français (et monégasque, même structure), aussi le code banque, le code guichet et la
// clé RIB finale. Le numéro de compte, lui, peut contenir des lettres : jamais corrigé.
const POSITIONS_CHIFFRES = { FR: [[2, 14], [25, 27]], MC: [[2, 14], [25, 27]] };
const POSITIONS_CLE = [[2, 4]];

function corrigerChiffres(candidat) {
  const caracteres = [...candidat];
  for (const [debut, fin] of POSITIONS_CHIFFRES[candidat.slice(0, 2)] ?? POSITIONS_CLE) {
    for (let i = debut; i < Math.min(fin, caracteres.length); i++) caracteres[i] = CHIFFRES[caracteres[i]] ?? caracteres[i];
  }
  return caracteres.join('');
}

/** Premier IBAN valide du texte. Les blocs de 4 sont recollés : on teste chaque position. */
function iban(compact) {
  for (let i = 0; i < compact.length; i++) {
    const longueur = LONGUEURS[compact.slice(i, i + 2)];
    if (!longueur) continue;
    const candidat = corrigerChiffres(compact.slice(i, i + longueur));
    if (candidat.length === longueur && ibanValide(candidat)) return candidat;
  }
  return null;
}

const BIC = /^[A-Z]{4}([A-Z]{2})[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/;

// Code écrit lettre par lettre (« C E P A F R P P 7 5 1 », texte de certains PDF de banque) : 8 à
// 11 caractères isolés à la suite, recollés.
const recoller = (texte) => texte.replace(/\b[A-Z0-9](?: +[A-Z0-9]\b){7,10}/g, (suite) => suite.replace(/ /g, ''));

/** BIC du pays de l'IBAN : celui qui suit la mention « BIC » ou « SWIFT », sinon le seul mot au format. */
function bic(texteBrut, paysIban) {
  const texte = recoller(texteBrut);
  const duPays = (mot) => BIC.exec(mot)?.[1] === paysIban;
  const apresMention = [...texte.matchAll(/(?:BIC|SWIFT)[^A-Z0-9]*([A-Z0-9 ]{8,14})/g)]
    .map((m) => m[1].replace(/ /g, ''))
    .flatMap((suite) => [suite.slice(0, 11), suite.slice(0, 8)])
    .find(duPays);
  if (apresMention) return apresMention;
  const mots = [...new Set(texte.split(/[^A-Z0-9]+/).filter(duPays))];
  return mots.length === 1 ? mots[0] : null;
}

/** { iban, bic } lus sur le RIB, chacun null s'il n'a pas été trouvé ou ne se contrôle pas. */
export function analyserRib(texteReconnu) {
  const texte = texteReconnu.toUpperCase();
  const lu = iban(texte.replace(/[^A-Z0-9]/g, ''));
  return { iban: lu, bic: lu ? bic(texte, lu.slice(0, 2)) : null };
}
