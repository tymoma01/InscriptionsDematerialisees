// Coordonnées ACCECIT affichées par l'application (pieds de page) — SOURCE UNIQUE côté frontend
// (2026-10-02, extraites de PiedDePageAccecit.jsx et PiedDePageFormulaire.jsx, où elles étaient
// écrites en dur). DUPLIQUÉES côté backend dans backend/src/config/coordonneesAccecit.js (pied de
// page des PDF DPAE) : les deux applications sont construites séparément (le backend ne reçoit que
// backend/src, voir backend/Dockerfile), aucun fichier ne peut être partagé — toute modification
// doit être reportée dans les deux fichiers. Spécifique à ACCECIT (voir Modularité, CLAUDE.md).
export const COORDONNEES_ACCECIT = Object.freeze({
  nom: 'ACCECIT',
  adresse: '47 avenue Paul Vaillant Couturier, 94250 Gentilly',
  telephone: '01 56 56 69 56',
  siteWeb: 'www.accecit.com',
});
