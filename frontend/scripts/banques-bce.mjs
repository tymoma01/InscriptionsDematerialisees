// Génère src/core/pieceJustificative/ocr/banques-bce.js depuis la liste des établissements financiers de la BCE
// (institutions financières monétaires, mise à jour mensuelle) :
// https://www.ecb.europa.eu/stats/financial_corporations/list_of_financial_institutions/html/monthly_list-MID.en.html
// Télécharger le fichier « fi_mrr_csv_AAMMJJ.csv » (UTF-16, tabulations), puis :
//   node scripts/banques-bce.mjs chemin/vers/fi_mrr_csv_AAMMJJ.csv
// Seules les banques enregistrées en France sont gardées : le code banque d'un IBAN français est
// leur RIAD_CODE sans « FR ». Un BIC n'est retenu que s'il désigne un seul établissement.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const [source] = process.argv.slice(2);
if (!source) {
  console.error('Usage : node scripts/banques-bce.mjs <fi_mrr_csv_AAMMJJ.csv>');
  process.exit(1);
}

const [entete, ...lignes] = readFileSync(source, 'utf16le')
  .replace(/^\uFEFF/, '')
  .split(/\r?\n/)
  .filter(Boolean)
  .map((ligne) => ligne.split('\t'));
const colonne = Object.fromEntries(entete.map((nom, i) => [nom, i]));
const francaises = lignes.filter((l) => l[colonne.COUNTRY_OF_REGISTRATION] === 'FR');

const parCode = {};
const nomsParBic = {};
for (const l of francaises) {
  const nom = l[colonne.NAME].replace(/\s+/g, ' ').trim();
  const code = /^FR(\d{5})$/.exec(l[colonne.RIAD_CODE])?.[1];
  if (code) parCode[code] = nom;
  const bic = l[colonne.BIC].trim().toUpperCase();
  if (bic) (nomsParBic[bic] ??= new Set()).add(nom);
}
const parBic = Object.fromEntries(
  Object.entries(nomsParBic)
    .filter(([, noms]) => noms.size === 1)
    .map(([bic, noms]) => [bic, [...noms][0]]),
);

const trier = (objet) => Object.fromEntries(Object.entries(objet).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(
  new URL('../src/core/pieceJustificative/ocr/banques-bce.js', import.meta.url),
  `// Généré par scripts/banques-bce.mjs depuis ${basename(source)} (liste des établissements financiers
// de la BCE) : ne pas modifier à la main.

/** Banques françaises par code banque (caractères 5 à 9 d'un IBAN français). */
export const BANQUES_PAR_CODE = ${JSON.stringify(trier(parCode))};

/** Banques françaises par BIC à 11 caractères. */
export const BANQUES_PAR_BIC = ${JSON.stringify(trier(parBic))};
`,
);
console.log(`${Object.keys(parCode).length} codes banque, ${Object.keys(parBic).length} BIC`);
