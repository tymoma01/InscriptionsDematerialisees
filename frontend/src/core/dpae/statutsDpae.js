// Statuts des demandes DPAE (module spécifique à ACCECIT, voir backend/src/core/dpae/
// demandeDpaeService.js) — SOURCE UNIQUE côté front du libellé et de la couleur de chaque statut
// (2026-09-30, demande utilisateur : « une couleur par statut, définie une seule fois »), réutilisée
// par la file RH (pastilles de filtre + badges), la fiche, la liste de suivi et le tableau de bord.
// `variante` : variante de StatutBadge / des tuiles / des pastilles de filtre, couleurs
// --statut-<variante>-* de styles/variables.css. `couleurGraphique` : même famille de teinte, pour
// les graphiques (recharts attend une couleur, pas une classe). Ordre = ordre d'affichage.
// La valeur technique 'envoyee' est affichée « À traiter » partout.
export const STATUTS_DPAE = [
  { code: 'envoyee', libelle: 'À traiter', libellePluriel: 'À traiter', variante: 'attente', couleurGraphique: '#c98a0b' },
  { code: 'en_attente', libelle: 'En attente', libellePluriel: 'En attente', variante: 'bleu-gris', couleurGraphique: '#5f7a96' },
  { code: 'validee', libelle: 'Validée', libellePluriel: 'Validées', variante: 'succes', couleurGraphique: '#0ca30c' },
  { code: 'rejetee', libelle: 'Rejetée', libellePluriel: 'Rejetées', variante: 'echec', couleurGraphique: '#d03b3b' },
];

const PAR_CODE = Object.fromEntries(STATUTS_DPAE.map((statut) => [statut.code, statut]));

// Code inconnu (statut ajouté côté serveur sans mise à jour ici) : code brut, badge neutre.
export const libelleStatutDpae = (code) => PAR_CODE[code]?.libelle ?? code;
export const varianteStatutDpae = (code) => PAR_CODE[code]?.variante ?? 'neutre';
