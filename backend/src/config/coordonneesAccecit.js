// Coordonnées ACCECIT (pied de page des PDF DPAE, core/dpae/pdfDemandeDpae.js) — COPIE de
// frontend/src/core/backOffice/coordonneesAccecit.js, source des pieds de page de l'application.
// Les deux applications sont construites séparément (le backend ne reçoit que backend/src, voir
// backend/Dockerfile), aucun fichier ne peut être partagé — toute modification doit être reportée
// dans les deux fichiers. Spécifique à ACCECIT (voir Modularité, CLAUDE.md).
const COORDONNEES_ACCECIT = Object.freeze({
  nom: 'ACCECIT',
  adresse: '47 avenue Paul Vaillant Couturier, 94250 Gentilly',
  telephone: '01 56 56 69 56',
  siteWeb: 'www.accecit.com',
});

module.exports = { COORDONNEES_ACCECIT };
