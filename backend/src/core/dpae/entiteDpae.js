// Entité (Hôtellerie / Tertiaire) d'une demande DPAE et périmètre de chaque rôle. Une demande est
// « Tertiaire » quand sa division l'est ; toute autre (Hôtellerie, « autre », ancienne demande sans
// division) relève de l'Hôtellerie. Le périmètre d'un rôle vient de rbac.js (ENTITE_DPAE_PAR_ROLE) ; un
// rôle sans entité (Admin) voit et traite les deux.

const { ENTITES, ENTITE_DPAE_PAR_ROLE, PLANNING_PAR_ENTITE } = require('../auth/rbac');

const DIVISION_TERTIAIRE = 'tertiaire';

const LIBELLE_ENTITE = Object.freeze({ [ENTITES.HOTELLERIE]: 'Hôtellerie', [ENTITES.TERTIAIRE]: 'Tertiaire' });

// Qui traite les demandes de chaque entité, pour le message de refus.
const TRAITEMENT_PAR_ENTITE = Object.freeze({
  [ENTITES.HOTELLERIE]: 'Planning Hôtellerie et la RH',
  [ENTITES.TERTIAIRE]: 'Planning Tertiaire',
});

function entiteDeLaDivision(division) {
  return division === DIVISION_TERTIAIRE ? ENTITES.TERTIAIRE : ENTITES.HOTELLERIE;
}

function entiteDeLaDemande(demande) {
  return entiteDeLaDivision(demande?.division);
}

// Entité à laquelle le rôle est limité, ou null (aucune limite).
function entiteDuRole(roleCode) {
  return ENTITE_DPAE_PAR_ROLE[roleCode] ?? null;
}

function demandeDansLePerimetre(roleCode, demande) {
  const entiteRole = entiteDuRole(roleCode);
  return entiteRole === null || entiteRole === entiteDeLaDemande(demande);
}

// Message clair du refus d'accès à une demande d'une autre entité ; null si l'accès est dans le périmètre.
function messageRefusEntite(roleCode, demande) {
  if (demandeDansLePerimetre(roleCode, demande)) return null;
  const entite = entiteDeLaDemande(demande);
  return `Cette demande concerne l'entité ${LIBELLE_ENTITE[entite]} : elle est traitée par le ${TRAITEMENT_PAR_ENTITE[entite]}.`;
}

// Rôle qui traite les demandes d'une entité en plus de la RH : sert à choisir les destinataires des
// notifications « Planning ».
function roleDePlanningDeLEntite(entite) {
  return PLANNING_PAR_ENTITE[entite];
}

module.exports = {
  DIVISION_TERTIAIRE,
  entiteDeLaDivision,
  entiteDeLaDemande,
  entiteDuRole,
  demandeDansLePerimetre,
  messageRefusEntite,
  roleDePlanningDeLEntite,
};
