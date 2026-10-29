// Même contrôle que le serveur (backend/src/core/dossier/informationsPiecesService.js) : clé ISO 13616 (modulo 97).
export function compacterIban(saisie) {
  return saisie.replace(/\s+/g, '').toUpperCase();
}

export function ibanValide(saisie) {
  const iban = compacterIban(saisie);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;

  const chiffres = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (lettre) => String(lettre.charCodeAt(0) - 55));
  return BigInt(chiffres) % 97n === 1n;
}

/** Affichage par blocs de 4, comme sur un RIB. */
export function formaterIban(saisie) {
  return compacterIban(saisie)
    .replace(/(.{4})/g, '$1 ')
    .trim();
}
