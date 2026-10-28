// « Autre motif » : seul motif de désistement accompagné d'une précision libre (obligatoire,
// 200 caractères maximum — même règle côté serveur, rendezvousService.js).
export const CODE_MOTIF_AUTRE = 'autre';
export const PRECISION_MOTIF_LONGUEUR_MAX = 200;

// Motif d'un désistement tel qu'affiché : « Autre motif : <précision> » pour « Autre motif »,
// libellé du motif sinon.
export function libelleMotifRendezvous(rdv) {
  if (!rdv?.motif_libelle) return null;
  if (rdv.motif_code === CODE_MOTIF_AUTRE && rdv.motif_precision) {
    return `${rdv.motif_libelle} : ${rdv.motif_precision}`;
  }
  return rdv.motif_libelle;
}
