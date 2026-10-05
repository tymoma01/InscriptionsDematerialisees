// Statuts des demandes DPAE et transitions autorisées — SOURCE UNIQUE côté serveur : le service
// (demandeDpaeService.js), les routes (dpae.routes.js) et le tableau de bord (tableauDeBordDpae*.js)
// s'appuient tous sur ce module, aucune liste de statuts n'est recopiée ailleurs. Miroir côté
// front : frontend/src/core/dpae/statutsDpae.js (les deux doivent rester alignés ; la contrainte
// CHECK de la migration 077 fige les mêmes codes en base).
//
// Module spécifique à ACCECIT, hors moteur de workflow des dossiers (voir demandeDpaeService.js) :
// les transitions vivent ici, pas dans un switch/case éparpillé.

const STATUT_ENVOYEE = 'envoyee';
const STATUT_EN_ATTENTE = 'en_attente';
const STATUT_VALIDEE = 'validee';
const STATUT_REJETEE = 'rejetee';

// Ordre = ordre du cycle de vie. La valeur technique 'envoyee' est affichée « À traiter ».
const STATUTS_DPAE = Object.freeze([
  Object.freeze({ code: STATUT_ENVOYEE, libelle: 'À traiter' }),
  Object.freeze({ code: STATUT_EN_ATTENTE, libelle: 'En attente' }),
  Object.freeze({ code: STATUT_VALIDEE, libelle: 'Validée' }),
  Object.freeze({ code: STATUT_REJETEE, libelle: 'Rejetée' }),
]);

const CODES_STATUTS_DPAE = Object.freeze(STATUTS_DPAE.map((statut) => statut.code));

// Statut d'une demande à sa création (pas de brouillon).
const STATUT_INITIAL = STATUT_ENVOYEE;

const ACTION_METTRE_EN_ATTENTE = 'mettre_en_attente';
const ACTION_VALIDER = 'valider';
const ACTION_REJETER = 'rejeter';

// Table des transitions autorisées (aucune autre) : action, statut de départ, statut d'arrivée et
// permission requise (clé de core/auth/permissions.js). Une même action a la même permission quel
// que soit son statut de départ (vérifié au chargement ci-dessous).
const TRANSITIONS = Object.freeze(
  [
    { action: ACTION_METTRE_EN_ATTENTE, de: STATUT_ENVOYEE, vers: STATUT_EN_ATTENTE, permission: 'dpaeTraitementRh' },
    { action: ACTION_VALIDER, de: STATUT_ENVOYEE, vers: STATUT_VALIDEE, permission: 'dpaeTraitementRh' },
    { action: ACTION_VALIDER, de: STATUT_EN_ATTENTE, vers: STATUT_VALIDEE, permission: 'dpaeTraitementRh' },
    { action: ACTION_REJETER, de: STATUT_ENVOYEE, vers: STATUT_REJETEE, permission: 'dpaeTraitementRh' },
    { action: ACTION_REJETER, de: STATUT_EN_ATTENTE, vers: STATUT_REJETEE, permission: 'dpaeTraitementRh' },
  ].map((transition) => Object.freeze(transition)),
);

// Statuts depuis lesquels une transition est encore possible (demande sans décision finale) —
// déduits de la table, jamais saisis à la main.
const STATUTS_A_DECIDER = Object.freeze(CODES_STATUTS_DPAE.filter((code) => TRANSITIONS.some((transition) => transition.de === code)));

function trouverTransition(action, statutDepart) {
  return TRANSITIONS.find((transition) => transition.action === action && transition.de === statutDepart);
}

// Permission requise pour une action (garde des routes). Exception au chargement si l'action est
// inconnue ou si ses transitions n'ont pas toutes la même permission.
function permissionPourAction(action) {
  const permissions = new Set(TRANSITIONS.filter((transition) => transition.action === action).map((transition) => transition.permission));
  if (permissions.size !== 1) throw new Error(`Action DPAE « ${action} » : permission absente ou ambiguë.`);
  return [...permissions][0];
}

for (const transition of TRANSITIONS) permissionPourAction(transition.action);

// Liste SQL « 'a', 'b' » de codes de statut, pour les agrégats du tableau de bord. Les codes viennent
// uniquement de ce module (jamais d'une saisie) : aucune injection possible.
function listeSql(codes) {
  return codes.map((code) => `'${code}'`).join(', ');
}

module.exports = {
  STATUT_ENVOYEE,
  STATUT_EN_ATTENTE,
  STATUT_VALIDEE,
  STATUT_REJETEE,
  STATUT_INITIAL,
  STATUTS_DPAE,
  CODES_STATUTS_DPAE,
  STATUTS_A_DECIDER,
  ACTION_METTRE_EN_ATTENTE,
  ACTION_VALIDER,
  ACTION_REJETER,
  TRANSITIONS,
  trouverTransition,
  permissionPourAction,
  listeSql,
};
