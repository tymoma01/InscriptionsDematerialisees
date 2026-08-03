// Catalogue des postes ACCECIT, propre à cette entité (voir Modularité, CLAUDE.md) — extrait de
// dossierService.js pour être réutilisé par le module statistiques
// (core/statistiques/statistiquesRepository.js) : le filtre "entité" du tableau de bord KPI
// (Hôtellerie/Tertiaire) se déduit du préfixe de poste, jamais d'une jointure sur `entites`
// (une seule ligne "accecit" en base — voir audit KPI Dashboard).
const TYPES_POSTE = ['bureau', 'hotel'];
const POSTES_BUREAU = ['nettoyage', 'vitrerie', 'machiniste', 'chef_equipe', 'autres'];
const POSTES_HOTEL = ['femme_valet_chambre', 'cafetier', 'equipier', 'gouvernant'];

module.exports = { TYPES_POSTE, POSTES_BUREAU, POSTES_HOTEL };
