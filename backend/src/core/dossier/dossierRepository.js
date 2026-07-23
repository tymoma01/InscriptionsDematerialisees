// Accès données pour candidats/dossiers/données de bloc — uniquement des requêtes,
// aucune règle métier ici (orchestrée par dossierService.js).

async function insererCandidat(
  trx,
  {
    entiteId,
    civilite,
    nom,
    nomNaissance,
    lieuNaissance,
    nationalite,
    prenom,
    dateNaissance,
    situationFamiliale,
    nirChiffre,
    nirIv,
    nirHash,
    email,
  }
) {
  const [candidat] = await trx('candidats')
    .insert({
      entite_id: entiteId,
      civilite,
      nom,
      nom_naissance: nomNaissance,
      lieu_naissance: lieuNaissance,
      nationalite,
      prenom,
      date_naissance: dateNaissance,
      situation_familiale: situationFamiliale,
      nir: nirChiffre,
      nir_iv: nirIv,
      nir_hash: nirHash,
      email,
    })
    .returning('id');
  return candidat.id;
}

// Vérification d'unicité à l'inscription (voir dossierService.inscrireCandidat) : nirHash est un
// HMAC-SHA256 déterministe (core/securite/nirCipher.js), jamais le NIR en clair ni sa version
// chiffrée AES-256-GCM (non déterministe, une recherche par égalité dessus ne trouverait rien).
function trouverCandidatParNirHash(trx, entiteId, nirHash) {
  return trx('candidats').where({ entite_id: entiteId, nir_hash: nirHash }).first();
}

function trouverCandidatParEmail(trx, entiteId, email) {
  return trx('candidats').where({ entite_id: entiteId, email }).first();
}

function trouverStatutInitial(trx, entiteId) {
  return trx('statuts').where({ entite_id: entiteId, est_initial: true }).first();
}

async function creerDossier(trx, { candidatId, entiteId, statutId }) {
  const [dossier] = await trx('dossiers')
    .insert({ candidat_id: candidatId, entite_id: entiteId, statut_id: statutId })
    .returning('id');
  return dossier.id;
}

// Utilisé pour vérifier qu'un dossierId venant de l'URL (ex : routes pièces justificatives)
// appartient bien à l'entité résolue par entiteContext pour la requête en cours, avant toute
// lecture/écriture le concernant — voir pieceJustificativeService.js.
function trouverDossierParId(trx, entiteId, dossierId) {
  return trx('dossiers').where({ id: dossierId, entite_id: entiteId }).first();
}

// Même filtre IDOR que trouverDossierParId, avec en plus le code du statut courant — utilisé
// quand une action doit être refusée selon le statut du dossier (voir
// pieceJustificativeService.uploaderPieceJustificative), pour éviter une seconde requête
// séparée juste pour résoudre statut_id en code.
function trouverDossierAvecStatutParId(trx, entiteId, dossierId) {
  return trx('dossiers')
    .join('statuts', 'statuts.id', 'dossiers.statut_id')
    .where({ 'dossiers.id': dossierId, 'dossiers.entite_id': entiteId })
    .select('dossiers.*', 'statuts.code as statut_code', 'statuts.libelle as statut_libelle')
    .first();
}

function enregistrerDonneesBloc(trx, { dossierId, blocCode, donnees }) {
  return trx('dossier_donnees_formulaire').insert({
    dossier_id: dossierId,
    bloc_code: blocCode,
    donnees: JSON.stringify(donnees),
  });
}

// La charte (texte + hash) est propre à chaque entité — une seule ligne active à la fois
// (contrainte d'unicité posée par la migration 024).
function trouverCharteActive(trx, entiteId) {
  return trx('chartes').where({ entite_id: entiteId, actif: true }).first();
}

function trouverStatutParCode(trx, entiteId, code) {
  return trx('statuts').where({ entite_id: entiteId, code }).first();
}

// Acteur attribué aux transitions de statut déclenchées automatiquement par le serveur, sans
// agent connecté (voir core/auth/rbac.js, ROLES.SYSTEME, et scripts/seedUtilisateurSysteme.js).
function trouverUtilisateurSysteme(trx, entiteId) {
  return trx('utilisateurs')
    .join('roles', 'roles.id', 'utilisateurs.role_id')
    .where({ 'utilisateurs.entite_id': entiteId, 'roles.code': 'systeme' })
    .select('utilisateurs.id')
    .first();
}

// Insertion dans historique_statuts uniquement : le trigger trg_sync_dossier_statut (migration
// 010) répercute automatiquement le nouveau statut sur dossiers.statut_id — ne jamais écrire
// dossiers.statut_id directement ici, ce serait dupliquer ce que fait déjà le trigger et risquer
// la divergence que ce dernier existe justement pour éliminer. motifId (nullable dès la création
// de la table, migration 010) reste optionnel : seules les transitions marquées
// `motif_requis` par la config (voir workflowEngine.js) en fournissent un.
function enregistrerChangementStatut(trx, { dossierId, statutId, utilisateurId, commentaire, motifId = null }) {
  return trx('historique_statuts').insert({
    dossier_id: dossierId,
    statut_id: statutId,
    utilisateur_id: utilisateurId,
    motif_id: motifId,
    commentaire,
  });
}

// Vue centralisée des dossiers (CLAUDE.md, besoins Accueil/Coordination) : jointure candidats +
// statuts pour éviter au front une résolution en plusieurs appels. statutCode reste optionnel —
// non fourni, la requête renvoie tous les dossiers de l'entité.
function listerDossiers(bd, entiteId, { statutCode } = {}) {
  const requete = bd('dossiers')
    .join('candidats', 'candidats.id', 'dossiers.candidat_id')
    .join('statuts', 'statuts.id', 'dossiers.statut_id')
    .where('dossiers.entite_id', entiteId)
    .select(
      'dossiers.id',
      'dossiers.date_creation',
      'dossiers.date_maj',
      'candidats.nom as candidat_nom',
      'candidats.prenom as candidat_prenom',
      'statuts.code as statut_code',
      'statuts.libelle as statut_libelle',
      'statuts.est_final as statut_est_final',
    )
    .orderBy('dossiers.date_maj', 'desc');

  if (statutCode) {
    requete.andWhere('statuts.code', statutCode);
  }

  return requete;
}

// Statuts configurés pour l'entité, dans l'ordre du workflow (colonne `ordre`) — sert à
// construire les filtres du tableau de bord sans coder de code de statut en dur côté front
// (voir Modularité, CLAUDE.md).
function listerStatuts(bd, entiteId) {
  return bd('statuts').where({ entite_id: entiteId }).orderBy('ordre', 'asc');
}

// signature_image est un bytea : le tracé doit déjà être un Buffer à ce stade (voir
// dossierService.js pour la conversion depuis le PNG base64 envoyé par le front).
// created_at n'est jamais fourni ici — colonne à defaultTo(now()) côté DB, jamais un
// timestamp client (voir CLAUDE.md, section signature électronique).
function enregistrerSignatureCharte(trx, { candidatId, charteId, signatureImage }) {
  return trx('signatures_charte').insert({
    candidat_id: candidatId,
    charte_id: charteId,
    signature_image: signatureImage,
  });
}

module.exports = {
  insererCandidat,
  trouverCandidatParNirHash,
  trouverCandidatParEmail,
  trouverStatutInitial,
  creerDossier,
  trouverDossierParId,
  trouverDossierAvecStatutParId,
  enregistrerDonneesBloc,
  trouverCharteActive,
  enregistrerSignatureCharte,
  trouverStatutParCode,
  trouverUtilisateurSysteme,
  enregistrerChangementStatut,
  listerDossiers,
  listerStatuts,
};
