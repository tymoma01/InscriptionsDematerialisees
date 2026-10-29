// Nom de la banque déduit de l'IBAN et du BIC (déjà contrôlés, lus sur le RIB ou saisis), plutôt que lu
// sur la photo : sur un RIB, le nom est le plus souvent un logo, illisible par l'OCR et sans clé de
// contrôle. Jamais de nom deviné : une banque inconnue n'affiche rien.
import { BANQUES_PAR_BIC, BANQUES_PAR_CODE } from './banques-bce';

// BIC à 8 caractères des réseaux dont chaque caisse ou agence a son propre BIC à 11 (AGRIFRPP882…),
// et des banques absentes de la liste de la BCE (néobanques, établissements de paiement). Sources :
// liste de la BCE et liste de Meilleurtaux (mars 2025) ; ne rien y ajouter sans source.
const BANQUES_PAR_BIC8 = {
  AFRIFRPP: 'BOA-France',
  AGRIFRPP: 'Crédit Agricole',
  AGRIMQMX: 'Crédit Agricole Martinique-Guyane',
  AGRIRERX: 'Crédit Agricole Réunion',
  AXABFRPP: 'AXA Banque',
  BCDMFRPP: 'Banque Chaabi du Maroc',
  BCMAFRPP: 'Attijariwafa Bank',
  BFBKFRP1: 'BforBank',
  BMCEFRPP: 'BMCE Bank International',
  BNPAFRPP: 'BNP Paribas',
  BNPAGFGX: 'BNP Paribas Guyane',
  BNPARERX: 'BNP Paribas Réunion',
  BOUSFRPP: 'BoursoBank',
  BPSMFRPP: 'Banque BCP',
  BREDFRPP: 'BRED Banque Populaire',
  BSPFFRPP: 'Banque Palatine',
  BUNQNL2A: 'bunq',
  CCBPFRPP: 'Banque Populaire',
  CCFRFRPP: 'HSBC France',
  CCOPFRPP: 'Crédit Coopératif',
  CEPAFRPP: 'Caisse d’Épargne',
  CFFIFR2L: 'Cofidis',
  CGDIFRPP: 'Caixa Geral de Depósitos',
  CMBRFR2B: 'Crédit Mutuel Arkéa',
  CMCIFR21: 'Crédit Mutuel / CIC',
  CMCIFRPP: 'CIC',
  CRLYFRPP: 'LCL',
  FPELFR21: 'Nickel',
  FTELFRPP: 'Orange Bank',
  FTNOFRP1: 'Fortuneo',
  GPBAFRPP: 'Groupama Banque',
  INGBFRPP: 'ING',
  LCLPFRP1: 'LCL Banque privée',
  NORDFRPP: 'Crédit du Nord',
  NTSBDEBB: 'N26',
  PSSTFRPP: 'La Banque Postale',
  REVODEB2: 'Revolut',
  REVOESM2: 'Revolut',
  REVOIE23: 'Revolut',
  REVOITM2: 'Revolut',
  REVOPTP2: 'Revolut',
  SOGEFRPP: 'Société Générale',
};

const compacter = (valeur) =>
  String(valeur ?? '')
    .replace(/\s+/g, '')
    .toUpperCase();

/**
 * Nom de la banque, ou null si elle est inconnue : d'abord par le code banque d'un IBAN français (la
 * caisse régionale comprise), puis par le BIC complet, enfin par ses 8 premiers caractères.
 */
export function nomBanque({ iban, bic } = {}) {
  const ibanCompact = compacter(iban);
  const code = /^FR\d{2}(\d{5})/.exec(ibanCompact)?.[1];
  if (code && BANQUES_PAR_CODE[code]) return BANQUES_PAR_CODE[code];

  const bicCompact = compacter(bic);
  if (!/^[A-Z0-9]{8}(?:[A-Z0-9]{3})?$/.test(bicCompact)) return null;
  return BANQUES_PAR_BIC[bicCompact.padEnd(11, 'X')] ?? BANQUES_PAR_BIC8[bicCompact.slice(0, 8)] ?? null;
}
