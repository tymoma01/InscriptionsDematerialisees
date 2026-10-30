// Lecture d'un seul champ sur une photo prise de près (bouton « Scanner ») : mêmes contrôles que la
// lecture de la photo entière (IBAN modulo 97, BIC de la zone SEPA, dates vraisemblables), appliqués
// au type du champ. Jamais de valeur devinée : null si rien ne se contrôle.
import { formaterIban } from './iban';
import { analyserBic, analyserRib } from './rib';
import { analyserDate } from './verso';

export const NATURES_CHAMP = ['numero', 'delivree_le', 'expire_le', 'iban', 'bic'];

/** Premier mot contenant un chiffre, de 5 à 30 lettres et chiffres ; sinon tout le texte recollé. */
function numero(texteReconnu) {
  const texte = texteReconnu.toUpperCase();
  const mots = texte.split(/[^A-Z0-9]+/).filter((mot) => /^[A-Z0-9]{5,30}$/.test(mot) && /\d/.test(mot));
  if (mots.length === 1) return mots[0];
  const recolle = texte.replace(/[^A-Z0-9]/g, '');
  return /^[A-Z0-9]{5,30}$/.test(recolle) && /\d/.test(recolle) ? recolle : null;
}

/** Valeur du champ lue dans le texte reconnu, au format de saisie du champ, ou null. */
export function extraireChamp(nature, texteReconnu) {
  switch (nature) {
    case 'numero':
      return numero(texteReconnu);
    case 'delivree_le':
    case 'expire_le':
      return analyserDate(texteReconnu, nature);
    case 'iban': {
      const { iban } = analyserRib(texteReconnu);
      return iban ? formaterIban(iban) : null;
    }
    case 'bic':
      return analyserBic(texteReconnu);
    default:
      return null;
  }
}
