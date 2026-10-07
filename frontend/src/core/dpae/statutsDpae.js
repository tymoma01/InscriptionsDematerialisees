// Statuts des demandes DPAE (module spécifique à ACCECIT, voir backend/src/core/dpae/
// demandeDpaeService.js) — SOURCE UNIQUE côté front du libellé et de la couleur de chaque statut
// (2026-09-30, demande utilisateur : « une couleur par statut, définie une seule fois »), réutilisée
// par la file RH (pastilles de filtre + badges), la fiche, la liste de suivi et le tableau de bord.
// `variante` : variante de StatutBadge / des tuiles / des pastilles de filtre, couleurs
// --statut-<variante>-* de styles/variables.css. `couleurGraphique` : même famille de teinte, pour
// les graphiques (recharts attend une couleur, pas une classe). Ordre = ordre d'affichage.
// La valeur technique 'envoyee' est affichée « À traiter » partout.
export const STATUTS_DPAE = [
  { code: 'a_valider_planning', libelle: 'À valider par le Planning', libellePluriel: 'À valider par le Planning', variante: 'violet', couleurGraphique: '#7c3aad' },
  { code: 'renvoyee_inspecteur', libelle: 'Renvoyée à l\'inspecteur', libellePluriel: 'Renvoyées à l\'inspecteur', variante: 'alerte', couleurGraphique: '#c4561a' },
  { code: 'envoyee', libelle: 'À traiter', libellePluriel: 'À traiter', variante: 'attente', couleurGraphique: '#c98a0b' },
  { code: 'en_attente', libelle: 'En attente', libellePluriel: 'En attente', variante: 'bleu-gris', couleurGraphique: '#5f7a96' },
  { code: 'validee', libelle: 'Validée', libellePluriel: 'Validées', variante: 'succes', couleurGraphique: '#0ca30c' },
  { code: 'rejetee', libelle: 'Rejetée', libellePluriel: 'Rejetées', variante: 'echec', couleurGraphique: '#d03b3b' },
  // Statut final, gris : distinct des autres pastilles.
  { code: 'classee_sans_suite', libelle: 'Classée sans suite', libellePluriel: 'Classées sans suite', variante: 'neutre', couleurGraphique: '#8a919c' },
];

// Statut d'une demande à sa création quand elle part directement à la RH (file « À traiter » par
// défaut), miroir de STATUT_INITIAL côté serveur (backend/src/core/dpae/statutsDpae.js).
export const STATUT_INITIAL = 'envoyee';

// Statuts d'avant l'envoi à la RH (chez le Planning) : la RH ne les voit nulle part. Miroir de
// STATUTS_AVANT_RH côté serveur.
export const STATUTS_AVANT_RH = ['a_valider_planning', 'renvoyee_inspecteur'];

// Statuts proposés à un rôle : tous, sauf ceux d'avant la RH quand il n'a pas dpaeVoitFilePlanning
// (la RH). Le serveur reste seul juge.
export const statutsVisibles = (voitFilePlanning) =>
  voitFilePlanning ? STATUTS_DPAE : STATUTS_DPAE.filter((statut) => !STATUTS_AVANT_RH.includes(statut.code));

export const ACTION_METTRE_EN_ATTENTE = 'mettre_en_attente';
export const ACTION_VALIDER = 'valider';
export const ACTION_REJETER = 'rejeter';
export const ACTION_MODIFIER = 'modifier';
export const ACTION_TRANSMETTRE_RH = 'transmettre_rh';
export const ACTION_RENVOYER_INSPECTEUR = 'renvoyer_inspecteur';
export const ACTION_CLASSER_SANS_SUITE = 'classer_sans_suite';
export const ACTION_ENVOYER_AU_PLANNING = 'envoyer_au_planning';
export const ACTION_RETRANSMETTRE_RH = 'retransmettre_rh';
export const ACTION_REACTIVER = 'reactiver';

// Transitions autorisées (action, statut de départ, statut d'arrivée) — MIROIR de la table du serveur
// (backend/src/core/dpae/statutsDpae.js), qui reste seule juge : ici elles ne servent qu'à décider
// quels boutons afficher. Les deux tables doivent rester alignées.
export const TRANSITIONS_DPAE = [
  { action: ACTION_METTRE_EN_ATTENTE, de: 'envoyee', vers: 'en_attente' },
  { action: ACTION_VALIDER, de: 'envoyee', vers: 'validee' },
  { action: ACTION_VALIDER, de: 'en_attente', vers: 'validee' },
  { action: ACTION_REJETER, de: 'envoyee', vers: 'rejetee' },
  { action: ACTION_REJETER, de: 'en_attente', vers: 'rejetee' },
  // Passage par le Planning.
  { action: ACTION_TRANSMETTRE_RH, de: 'a_valider_planning', vers: 'envoyee' },
  { action: ACTION_RENVOYER_INSPECTEUR, de: 'a_valider_planning', vers: 'renvoyee_inspecteur' },
  // Classement sans suite : depuis tout statut non décidé par la RH, jamais depuis un statut final.
  { action: ACTION_CLASSER_SANS_SUITE, de: 'a_valider_planning', vers: 'classee_sans_suite' },
  { action: ACTION_CLASSER_SANS_SUITE, de: 'renvoyee_inspecteur', vers: 'classee_sans_suite' },
  { action: ACTION_CLASSER_SANS_SUITE, de: 'envoyee', vers: 'classee_sans_suite' },
  { action: ACTION_CLASSER_SANS_SUITE, de: 'en_attente', vers: 'classee_sans_suite' },
  // Réactivation d'une demande classée sans suite (Admin) : SEULE transition sortante ; la destination dépend
  // du rôle qui l'avait classée (une ligne par destination possible).
  { action: ACTION_REACTIVER, de: 'classee_sans_suite', vers: 'renvoyee_inspecteur' },
  { action: ACTION_REACTIVER, de: 'classee_sans_suite', vers: 'a_valider_planning' },
  { action: ACTION_REACTIVER, de: 'classee_sans_suite', vers: 'envoyee' },
  { action: ACTION_REACTIVER, de: 'classee_sans_suite', vers: 'en_attente' },
  // Demande « En attente » renvoyée à la RH une fois complétée.
  { action: ACTION_RETRANSMETTRE_RH, de: 'en_attente', vers: 'envoyee' },
  // Renvoi de l'inspecteur au Planning, après correction : action explicite.
  { action: ACTION_ENVOYER_AU_PLANNING, de: 'renvoyee_inspecteur', vers: 'a_valider_planning' },
  // Modification par le demandeur : le statut ne change JAMAIS.
  { action: ACTION_MODIFIER, de: 'a_valider_planning', vers: 'a_valider_planning' },
  { action: ACTION_MODIFIER, de: 'renvoyee_inspecteur', vers: 'renvoyee_inspecteur' },
  { action: ACTION_MODIFIER, de: 'envoyee', vers: 'envoyee' },
  { action: ACTION_MODIFIER, de: 'en_attente', vers: 'en_attente' },
];

// Statuts depuis lesquels une transition est encore possible (demande sans décision finale), déduits
// de la table ci-dessus.
// La réactivation d'une demande classée sans suite n'en fait pas un statut « à décider ».
export const STATUTS_A_DECIDER = STATUTS_DPAE.map((statut) => statut.code).filter((code) =>
  TRANSITIONS_DPAE.some((transition) => transition.de === code && transition.action !== ACTION_REACTIVER),
);

export const transitionPossible = (action, statut) => TRANSITIONS_DPAE.some((transition) => transition.action === action && transition.de === statut);

const PAR_CODE = Object.fromEntries(STATUTS_DPAE.map((statut) => [statut.code, statut]));

// Code inconnu (statut ajouté côté serveur sans mise à jour ici) : code brut, badge neutre.
export const libelleStatutDpae = (code) => PAR_CODE[code]?.libelle ?? code;
export const varianteStatutDpae = (code) => PAR_CODE[code]?.variante ?? 'neutre';
