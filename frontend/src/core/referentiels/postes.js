// Postes proposés aux candidats, par secteur — référentiel unique du front (le serveur a le sien,
// backend/src/core/dossier/postesConstantes.js). Les demandes DPAE ont leur propre liste.
export const POSTES_BUREAU = ['nettoyage', 'vitrerie', 'machiniste', 'chef_equipe', 'autres'];
export const POSTES_HOTEL = ['femme_valet_chambre', 'cafetier', 'equipier', 'gouvernant'];

export const LIBELLES_POSTE = {
  nettoyage: 'Nettoyage',
  vitrerie: 'Vitrerie',
  machiniste: 'Machiniste',
  chef_equipe: "Chef d'équipe",
  autres: 'Autres',
  femme_valet_chambre: 'Femme/Valet de chambre',
  cafetier: 'Cafétier(ère)',
  equipier: 'Équipier(ère)',
  gouvernant: 'Gouvernant(e)',
};

// Code inconnu (ancien poste, saisie hors liste) : affiché tel quel plutôt que masqué.
export function libellePoste(code) {
  return LIBELLES_POSTE[code] ?? code;
}
