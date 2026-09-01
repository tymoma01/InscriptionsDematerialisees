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
// séparée juste pour résoudre statut_id en code. Join sur candidats en plus (nom/prénom) : sert
// à construire le segment "NOM_PRENOM" de l'arborescence SharePoint (voir azureOneDriveConnector,
// StorageConnector.upload) sans requête séparée — dossiers.date_creation (déjà dans dossiers.*)
// fournit l'année/le mois de cette même arborescence.
//
// Jointure gauche vers dossier_donnees_formulaire (bloc 'disponibilites') en plus, même patron que
// listerDossiers/listerRendezvousTest — sert à VerificationPieces.jsx/CaptureTablette.jsx pour
// transmettre les postes déclarés du dossier à la sélection de poste(s) testé(s) de
// ModalePlanificationTest.jsx (voir dossierService.obtenirDossier pour l'extraction). Les autres
// appelants de cette fonction (pieceJustificativeService.js, invitationTestService.js,
// relanceService.js) n'utilisent jamais ce champ : leftJoin sans impact pour eux, la ligne
// donnees_disponibilites brute reste simplement ignorée.
//
// candidat_civilite ajouté (audit 2026-08-28, sujet des événements Outlook formateur) : sert à
// rendezvousService.creerRendezvous pour distinguer FDC/VDC sur le poste combiné
// 'femme_valet_chambre' (aucun code poste distinct pour ce cas, voir postesConstantes.js — la
// civilité du candidat est le seul signal disponible).
function trouverDossierAvecStatutParId(trx, entiteId, dossierId) {
  return trx('dossiers')
    .join('statuts', 'statuts.id', 'dossiers.statut_id')
    .join('candidats', 'candidats.id', 'dossiers.candidat_id')
    .leftJoin('dossier_donnees_formulaire as bloc_disponibilites', function () {
      this.on('bloc_disponibilites.dossier_id', '=', 'dossiers.id').andOn(
        'bloc_disponibilites.bloc_code',
        '=',
        trx.raw('?', ['disponibilites']),
      );
    })
    .where({ 'dossiers.id': dossierId, 'dossiers.entite_id': entiteId })
    .select(
      'dossiers.*',
      'statuts.code as statut_code',
      'statuts.libelle as statut_libelle',
      'candidats.nom as candidat_nom',
      'candidats.prenom as candidat_prenom',
      'candidats.civilite as candidat_civilite',
      'bloc_disponibilites.donnees as donnees_disponibilites',
    )
    .first();
}

// Coordonnées saisies au bloc 'coordonnees' du formulaire d'inscription (JSONB, voir
// dossier_donnees_formulaire, migration 013) — pas de colonne dédiée telephone/email sur
// `candidats` (voir Modularité, CLAUDE.md : les champs d'un bloc restent dans le JSONB
// générique). Déplacée ici depuis rendezvousRepository.js (2026-07-30) : cette donnée est propre
// au dossier, pas au rendez-vous — utilisée aussi bien par rappelService.js (rappel de créneau)
// que par relanceService.js/invitationTestService.js (envoi réel email/SMS).
async function trouverCoordonneesCandidat(bd, dossierId) {
  const ligne = await bd('dossier_donnees_formulaire')
    .where({ dossier_id: dossierId, bloc_code: 'coordonnees' })
    .first();
  return ligne?.donnees ?? null;
}

function enregistrerDonneesBloc(trx, { dossierId, blocCode, donnees }) {
  return trx('dossier_donnees_formulaire').insert({
    dossier_id: dossierId,
    bloc_code: blocCode,
    donnees: JSON.stringify(donnees),
  });
}

// Upsert (pas un simple insert comme enregistrerDonneesBloc ci-dessus, réservé à l'inscription
// initiale) : sert à la correction d'une erreur de saisie sur un dossier déjà inscrit (bouton
// "Modifier", InformationsInscription.jsx/dossierService.modifierInscription) — le bloc existe
// déjà à ce stade dans presque tous les cas, mais un upsert reste correct même si une ligne
// venait à manquer (dossier ancien, bloc jamais enregistré). Contrainte unique(dossier_id,
// bloc_code) posée par la migration 013 : c'est elle qui rend onConflict().merge() possible ici.
// date_maj mise à jour explicitement (colonne dédiée, migration 013) plutôt que de dépendre du
// defaultTo(now()) qui ne joue que sur un INSERT initial, jamais sur la branche merge().
function mettreAJourDonneesBloc(trx, { dossierId, blocCode, donnees }) {
  return trx('dossier_donnees_formulaire')
    .insert({ dossier_id: dossierId, bloc_code: blocCode, donnees: JSON.stringify(donnees) })
    .onConflict(['dossier_id', 'bloc_code'])
    .merge({ donnees: JSON.stringify(donnees), date_maj: trx.fn.now() });
}

// Correction d'une erreur de saisie sur l'état civil (bouton "Modifier", voir
// mettreAJourDonneesBloc ci-dessus pour le même besoin côté blocs JSONB) — jamais nir/nir_iv/
// nir_hash ici : le NIR n'est ni exposé ni modifiable par cette voie (voir CLAUDE.md, Contraintes
// RGPD — dossierService.modifierInscription ne le lit même pas dans son schéma de validation).
function mettreAJourCandidat(trx, candidatId, { civilite, nom, nomNaissance, lieuNaissance, nationalite, prenom, dateNaissance, situationFamiliale, email }) {
  return trx('candidats').where({ id: candidatId }).update({
    civilite,
    nom,
    nom_naissance: nomNaissance,
    lieu_naissance: lieuNaissance,
    nationalite,
    prenom,
    date_naissance: dateNaissance,
    situation_familiale: situationFamiliale,
    email,
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

// Date d'embauche (migration 057, audit 2026-08-31) — écrite par embaucheService.marquerEmbauche
// dans la MÊME transaction que la transition de statut vers 'embauche' (voir son commentaire
// d'en-tête) : jamais appelée seule en dehors de ce flux.
function mettreAJourDateEmbauche(trx, { dossierId, dateEmbauche }) {
  return trx('dossiers').where({ id: dossierId }).update({ date_embauche: dateEmbauche });
}

// Vue centralisée des dossiers (CLAUDE.md, besoins Accueil/Coordination) : jointure candidats +
// statuts pour éviter au front une résolution en plusieurs appels. statutCode reste optionnel —
// non fourni, la requête renvoie tous les dossiers de l'entité.
//
// Jointure gauche vers dossier_donnees_formulaire (bloc 'disponibilites', JSONB, migration 013)
// pour exposer le(s) poste(s) recherché(s) sur la colonne "Poste" du tableau de bord (voir
// dossierService.listerDossiers pour l'extraction posteBureau/posteHotel) — même patron que
// evaluationRepository.listerRendezvousAEvaluer. LEFT JOIN : un dossier sans bloc disponibilites
// enregistré (nouveau, pas encore rempli) ne doit pas disparaître de la liste pour autant.
//
// Même patron pour le bloc 'coordonnees' (téléphone/email, colonnes du tableau de bord) : ces
// champs ne vivent pas sur `candidats` (voir Modularité, CLAUDE.md — candidats.email n'est qu'une
// dénormalisation technique pour la contrainte UNIQUE, voir migration 032 ; il n'existe d'ailleurs
// pas de colonne candidats.telephone), la source d'affichage reste le JSONB du bloc.
function listerDossiers(bd, entiteId, { statutCode } = {}) {
  const requete = bd('dossiers')
    .join('candidats', 'candidats.id', 'dossiers.candidat_id')
    .join('statuts', 'statuts.id', 'dossiers.statut_id')
    .leftJoin('dossier_donnees_formulaire as bloc_disponibilites', function () {
      this.on('bloc_disponibilites.dossier_id', '=', 'dossiers.id').andOn(
        'bloc_disponibilites.bloc_code',
        '=',
        bd.raw('?', ['disponibilites']),
      );
    })
    .leftJoin('dossier_donnees_formulaire as bloc_coordonnees', function () {
      this.on('bloc_coordonnees.dossier_id', '=', 'dossiers.id').andOn(
        'bloc_coordonnees.bloc_code',
        '=',
        bd.raw('?', ['coordonnees']),
      );
    })
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
      'bloc_disponibilites.donnees as donnees_disponibilites',
      'bloc_coordonnees.donnees as donnees_coordonnees',
    )
    .orderBy('dossiers.date_maj', 'desc');

  if (statutCode) {
    requete.andWhere('statuts.code', statutCode);
  }

  return requete;
}

// Les 3 issues possibles d'un dossier ayant atteint valide_envoi_formation (audit 2026-08-28,
// écran "Suivi des formations") — propre à ACCECIT (voir Modularité, CLAUDE.md), donc ici plutôt
// que dans un paramètre générique : "En attente"/"Formation validée"/"Formation non validée"/
// "Tous" (front, FiltresStatut.jsx) filtrent CLIENT-side sur ce sous-ensemble déjà connu à
// l'avance, jamais un 4e statut qui n'aurait pas de sens sur cette page.
const STATUTS_SUIVI_FORMATION = ['valide_envoi_formation', 'valide_pret_embauche', 'formation_non_validee'];

// Tout dossier ayant un jour atteint valide_envoi_formation, quel que soit son statut COURANT
// PARMI LES 3 ISSUES ci-dessus (pas seulement tant qu'il y est encore) — sert à l'écran "Suivi des
// formations" (dossiers.routes.js GET /suivi-formation) à garder un dossier déjà traité
// (Formation validée/non validée) consultable, au lieu de disparaître de la liste une fois la
// décision prise (audit 2026-08-28, point 1). Un dossier repassé par replanifier_test depuis
// valide_envoi_formation (retour à test_planifie, voir workflow.config.json ACCECIT) sort de cette
// liste tant qu'il n'a pas de nouveau atteint l'une des 3 issues — scope volontairement restreint
// à ces 3-là, pas "n'importe quel statut du moment qu'il a un jour touché valide_envoi_formation".
//
// date_entree_statut = MAX(historique_statuts.date_changement) où le statut de CETTE ligne
// d'historique est valide_envoi_formation (PAS dossiers.date_maj, qui peut avoir bougé pour une
// tout autre raison depuis, ex. une note ajoutée) — "date d'envoi en formation", toujours la même
// donnée quel que soit le statut COURANT affiché (En attente/Validée/Non validée). MAX plutôt que
// MIN : un dossier peut repasser plusieurs fois par valide_envoi_formation, seule la date de
// l'entrée la plus récente a un sens ici. Même patron de sous-requête que listerDossiersParIds
// plus bas (dates_test_planifie).
//
// formateur_nom/formateur_prenom = formateur/inspecteur de la DERNIÈRE évaluation soumise pour ce
// dossier (evaluations.formateur_id, LATERAL JOIN trié par date_evaluation DESC — même technique
// que statistiquesRepository.delaiTestVersVerdict) — PAS rendezvous.formateur_id du rendez-vous le
// plus récent par date_heure : un rendez-vous peut exister sans avoir jamais été évalué
// (replanifié/annulé après coup), evaluations.formateur_id reste le seul lien fiable vers "qui a
// RÉELLEMENT fait passer le test" (audit 2026-08-28, point 2 — "même donnée que Suivi des tests"
// concerne la donnée affichée, pas la source exacte : Suivi des tests affiche une ligne par
// rendez-vous, cette page une ligne par dossier avec plusieurs rendez-vous possibles, la
// désambiguïsation "lequel compte" n'existe donc que de ce côté-ci).
//
// donnees_disponibilites (posteBureau/posteHotel déclarés à l'inscription) exposé pour la
// recherche "poste" (point 3) — même source et même LEFT JOIN que listerDossiers ci-dessus, pas
// rendezvous.postes_selectionnes (retenus pour un rendez-vous précis, absent de cette liste
// dossier-level).
function listerSuiviFormation(bd, entiteId) {
  return bd('dossiers')
    .join('candidats', 'candidats.id', 'dossiers.candidat_id')
    .join('statuts', 'statuts.id', 'dossiers.statut_id')
    .leftJoin(
      bd('historique_statuts')
        .join('statuts as statuts_formation', 'statuts_formation.id', 'historique_statuts.statut_id')
        .where('statuts_formation.code', 'valide_envoi_formation')
        .groupBy('historique_statuts.dossier_id')
        .select(
          'historique_statuts.dossier_id',
          bd.raw('MAX(historique_statuts.date_changement) as date_entree_statut'),
        )
        .as('dates_entree_formation'),
      'dates_entree_formation.dossier_id',
      'dossiers.id',
    )
    .leftJoin('dossier_donnees_formulaire as bloc_disponibilites', function () {
      this.on('bloc_disponibilites.dossier_id', '=', 'dossiers.id').andOn(
        'bloc_disponibilites.bloc_code',
        '=',
        bd.raw('?', ['disponibilites']),
      );
    })
    .joinRaw(
      `LEFT JOIN LATERAL (
         SELECT e.formateur_id
         FROM evaluations e
         WHERE e.dossier_id = dossiers.id
         ORDER BY e.date_evaluation DESC
         LIMIT 1
       ) AS derniere_evaluation ON true`,
    )
    .leftJoin('utilisateurs as formateur_test', 'formateur_test.id', 'derniere_evaluation.formateur_id')
    .where('dossiers.entite_id', entiteId)
    .whereIn('statuts.code', STATUTS_SUIVI_FORMATION)
    // Un dossier n'apparaît que s'il a bien atteint valide_envoi_formation un jour (sinon
    // dates_entree_formation.dossier_id est NULL, LEFT JOIN sans correspondance) — exclut
    // notamment tout dossier bureau arrivé à valide_pret_embauche directement depuis test_realise,
    // jamais passé par la formation (voir evaluationEngine.js, valider_envoi_formation n'a pas
    // d'équivalent bureau).
    .whereNotNull('dates_entree_formation.dossier_id')
    .select(
      'dossiers.id',
      'candidats.nom as candidat_nom',
      'candidats.prenom as candidat_prenom',
      'statuts.code as statut_code',
      'statuts.libelle as statut_libelle',
      'dates_entree_formation.date_entree_statut',
      'formateur_test.nom as formateur_nom',
      'formateur_test.prenom as formateur_prenom',
      'bloc_disponibilites.donnees as donnees_disponibilites',
    )
    .orderBy('dates_entree_formation.date_entree_statut', 'desc');
}

// Historique de formation D'UN dossier précis (audit 2026-08-28, onglet "Formation" de la fiche
// dossier) — distinct de listerSuiviFormation ci-dessus (liste TOUS les dossiers, statut courant
// seulement) : ici, TOUTES les lignes historique_statuts liées à valide_envoi_formation et ses
// deux issues (valide_pret_embauche/formation_non_validee), du plus ANCIEN au plus récent —
// l'appelant (dossierService.listerHistoriqueFormation) reconstitue les "envois en formation" en
// associant chaque entrée valide_envoi_formation à sa sortie éventuelle, la ligne suivante dans cet
// ordre chronologique. Plusieurs lignes valide_envoi_formation sont possibles pour un même dossier
// (confirmé sur le workflow réel : replanifier_test repart de valide_envoi_formation vers
// test_planifie, voir workflow.config.json ACCECIT — un dossier peut donc être renvoyé en
// formation plusieurs fois avant une décision définitive). Scopé par entiteId via la jointure
// dossiers (même garde IDOR que le reste du projet) ; jointure utilisateurs/roles (jamais LEFT,
// historique_statuts.utilisateur_id est NOT NULL, migration 010) pour "qui a effectué l'action".
function listerHistoriqueFormation(bd, entiteId, dossierId) {
  return bd('historique_statuts')
    .join('dossiers', 'dossiers.id', 'historique_statuts.dossier_id')
    .join('statuts', 'statuts.id', 'historique_statuts.statut_id')
    .join('utilisateurs', 'utilisateurs.id', 'historique_statuts.utilisateur_id')
    .join('roles', 'roles.id', 'utilisateurs.role_id')
    .where({ 'dossiers.id': dossierId, 'dossiers.entite_id': entiteId })
    .whereIn('statuts.code', ['valide_envoi_formation', 'valide_pret_embauche', 'formation_non_validee'])
    .select(
      'historique_statuts.commentaire',
      'historique_statuts.date_changement',
      'statuts.code as statut_code',
      'statuts.libelle as statut_libelle',
      'utilisateurs.nom as utilisateur_nom',
      'utilisateurs.prenom as utilisateur_prenom',
      'roles.libelle as role_libelle',
    )
    .orderBy('historique_statuts.date_changement', 'asc');
}

// Statuts configurés pour l'entité, dans l'ordre du workflow (colonne `ordre`) — sert à
// construire les filtres du tableau de bord sans coder de code de statut en dur côté front
// (voir Modularité, CLAUDE.md).
function listerStatuts(bd, entiteId) {
  return bd('statuts').where({ entite_id: entiteId }).orderBy('ordre', 'asc');
}

// Résumé minimal (id + nom/prénom candidat) pour une liste de dossiers, scopé à l'entité — sert
// à nommer les sous-dossiers de l'archive ZIP groupée (audit 2026-08-24, actions groupées "Dossiers
// candidats", voir dossiers.routes.js GET /pieces/export-zip-groupe) : contrairement à
// listerDossiersParIds (statistiques KPI, nombreuses jointures pour les indicateurs), ce module n'a
// besoin d'aucune autre colonne — requête volontairement séparée plutôt que de réutiliser cette
// fonction plus lourde pour un simple besoin d'affichage de nom. whereIn('dossiers.entite_id', ...)
// jamais utilisé seul comme filtre IDOR : entite_id fait partie du WHERE composite ci-dessous, un
// dossierId d'une autre entité est donc silencieusement absent du résultat plutôt que de lever une
// erreur — à l'appelant de constater l'absence (voir la route, qui traite un id manquant comme un
// échec par dossier, pas un blocage de tout l'export).
function listerResumesParIds(bd, entiteId, dossierIds) {
  if (dossierIds.length === 0) return Promise.resolve([]);
  return bd('dossiers')
    .join('candidats', 'candidats.id', 'dossiers.candidat_id')
    .where('dossiers.entite_id', entiteId)
    .whereIn('dossiers.id', dossierIds)
    .select('dossiers.id', 'candidats.nom as candidat_nom', 'candidats.prenom as candidat_prenom');
}

// Rafraîchissement automatique du back-office par polling (audit 2026-08-24) : `journal_audit`
// est déjà écrit par la quasi-totalité des points de mutation du parcours dossier (transitions,
// rendez-vous, pièces, notes, et désormais la création — voir candidats.routes.js), MAX(date_action)
// scopé à l'entité sert donc de signal unique "quelque chose a changé" sans avoir à interroger
// une colonne de mise à jour différente par table (rendezvous/pieces_justificatives/notes_dossier
// n'en ont d'ailleurs pas d'homogène). Index dédié : migration 052
// (idx_journal_audit_entite_date_action), sans quoi ce MAX scanne toute la table à chaque appel
// (30-60s par onglet actif, voir useRafraichissementAuto.js côté front). null si l'entité n'a
// encore aucune ligne journal_audit (entité neuve) — au consommateur (dossierService) de décider
// comment l'exposer, pas cette fonction.
function obtenirDerniereModification(bd, entiteId) {
  return bd('journal_audit').where({ entite_id: entiteId }).max('date_action as derniereModification').first();
}

// Même select/jointures que listerDossiers ci-dessus, mais filtré par une liste d'ids précise
// plutôt qu'un statut — sert au tableau consolidé du dashboard KPI (voir
// statistiquesService.listerDossiersParIndicateurs) : les indicateurs KPI (historique_statuts,
// evaluations...) déterminent QUELS dossiers afficher, cette fonction se contente ensuite de
// récupérer leurs informations d'affichage (candidat, poste, statut courant), exactement comme
// listerDossiers le fait pour un statut donné. []  en entrée renvoie [] sans requête (whereIn([])
// est valide en SQL mais inutile de solliciter la base pour un résultat déjà connu).
//
// date_test_planifie/date_verdict/verdict_resultat_global/verdict_orientation : dates clés du
// dossier (colonne "Dates clés" du tableau consolidé, voir TableauDossiersSelectionnes.jsx) —
// TOUJOURS calculées, indépendamment des indicateurs sélectionnés par l'utilisateur et de la
// période filtrée sur l'écran (contrairement à statistiquesRepository.listerEnvoyesEnTest/
// listerVerdicts, qui bornent par date_cle pour déterminer QUELS dossiers afficher) : une fois
// qu'un dossier fait partie du résultat, sa colonne "Dates clés" doit refléter son historique réel
// complet, pas seulement ce qui tombe dans la période KPI en cours.
// date_test_planifie reste MIN() : première planification, cohérent avec le délai
// "inscription → test" (voir plus bas). date_verdict est en revanche MAX() depuis le correctif du
// 2026-09-02 (audit dashboard, dossier #88, décision utilisateur : "c'est la DERNIÈRE évaluation qui
// fait foi partout") — la PREMIÈRE évaluation (MIN, avant ce correctif) pouvait ne plus correspondre
// au verdict réellement affiché par le badge "Indicateurs" (statistiquesRepository.listerVerdicts,
// lui aussi corrigé pour ne retenir que la dernière évaluation) : un dossier retesté avec succès
// après un premier échec affichait encore la date ET le résultat de l'échec initial en "Dates clés",
// alors que son badge affichait "Test réussi" — colonne vide au final, aucune ligne `datesCles` ne
// portait le code `verdict_valide` attendu par l'alignement (voir construireColonnesAlignees,
// TableauDossiersSelectionnes.jsx). NULL si aucune évaluation n'existe encore — laissé tel quel,
// c'est justement ce qui permet au front de n'afficher que les lignes pertinentes (pas de date
// vide/placeholder, voir statistiquesService.listerDossiersParIndicateurs).
//
// evaluation_verdict : deuxième jointure sur `evaluations`, cette fois pour récupérer
// resultat_global/orientation de LA évaluation dont la date correspond exactement à date_verdict
// (jointure sur dossier_id + date_evaluation, pas un second MIN/GROUP BY) — nécessaires pour
// colorer la ligne "Verdict" en vert/rouge et ajouter la ligne "Orientation" quand applicable
// (voir statistiquesService.listerDossiersParIndicateurs). orientation est NULL quand
// resultat_global = 'invalide' (colonne nullable, voir migration 036) : pas de ligne "Orientation"
// dans ce cas, géré côté service.
//
// derniere_planification.date_derniere_planification_avant_verdict : correctif audit 2026-08-11 —
// sert UNIQUEMENT au calcul du délai "test → verdict" affiché dans "Dates clés"
// (TableauDossiersSelectionnes.jsx, construireColonnesAlignees), PAS à `date_test_planifie`
// ci-dessus (qui reste la PREMIÈRE planification — correct tel quel pour la ligne "Test planifié"
// et pour le délai "inscription → test", voir statistiquesRepository.listerDelaiInscriptionVers
// TestPlanifie, qui utilise aussi la première occurrence). Avant ce correctif, le délai
// "test → verdict" par dossier appariait MIN(test_planifie) (première planification) avec
// MIN(evaluations.date_evaluation) (première évaluation) — incohérent avec la définition validée
// de cet indicateur (statistiquesRepository.delaiTestVersVerdict/listerDelaiTestVersVerdict, seule
// source de vérité pour la tuile ET sa liste de dossiers), qui apparie chaque verdict à la
// planification la PLUS RÉCENTE qui le précède, via JOIN LATERAL — nécessaire pour bien gérer les
// reprogrammations après échec/absence (démontré sur les dossiers #74/#88, tous deux reprogrammés
// plusieurs fois : l'ancien calcul affichait 13 J/5 J au lieu de ~0 J). Reproduit ici EXACTEMENT le
// même JOIN LATERAL, mais borné par `dates_verdict.date_verdict` (déjà calculé ci-dessus) plutôt
// que par une transition historique_statuts distincte : les deux coïncident au sein d'une même
// transaction Postgres (`now()` figé pour toute la transaction — évaluation et transition de
// statut sont insérées ensemble par evaluationEngine), vérifié bit à bit sur les dossiers #74/#88.
// LEFT JOIN LATERAL (pas INNER) : un dossier sans verdict encore (date_verdict NULL) doit rester
// dans le résultat, simplement sans ligne de délai "test → verdict" (filtré côté front, voir
// TableauDossiersSelectionnes.jsx). Conséquence du correctif du 2026-09-02 ci-dessus (date_verdict
// passé de MIN à MAX) : cette borne suit désormais la DERNIÈRE évaluation, pas la première — sans
// effet sur la tuile/agrégat "délai test → verdict" elle-même (statistiquesRepository.
// delaiTestVersVerdict, entièrement indépendante de `evaluations`), seulement sur cette ligne de
// détail par dossier, aujourd'hui inatteignable depuis l'écran (plus de tuile pour sélectionner
// `delai_test_verdict`, voir Indicateurs.jsx).
// Date d'ENTRÉE dans un statut donné (MAX(historique_statuts.date_changement) pour ce code) —
// même calcul que listerSuiviFormation.dates_entree_formation plus haut, généralisé à un code
// arbitraire pour les 4 nouvelles cartes "Effectifs par statut" (audit tableau de bord 2026-08-31,
// décision utilisateur : "option simple", ce LEFT JOIN dédié par statut suivi, PAS un mécanisme
// dynamique unique — resterait disproportionné pour seulement 4 codes). MAX (pas MIN) : cohérent
// avec dates_entree_formation, la dernière entrée dans ce statut a plus de sens qu'une première
// entrée si le dossier y est repassé plusieurs fois (ex. replanifier_test depuis valide_pret_embauche
// puis re-validation). Sous-requête aliasée `dates_<statutCode>`, colonne `date_entree_<statutCode>`
// — nom prévisible, retrouvé tel quel dans le .select() de listerDossiersParIds ci-dessous.
function joindreDateEntreeStatut(requete, bd, statutCode) {
  const colonne = `date_entree_${statutCode}`;
  return requete.leftJoin(
    bd('historique_statuts')
      .join(`statuts as statuts_${statutCode}`, `statuts_${statutCode}.id`, 'historique_statuts.statut_id')
      .where(`statuts_${statutCode}.code`, statutCode)
      .groupBy('historique_statuts.dossier_id')
      .select('historique_statuts.dossier_id', bd.raw(`MAX(historique_statuts.date_changement) as ${colonne}`))
      .as(`dates_${statutCode}`),
    `dates_${statutCode}.dossier_id`,
    'dossiers.id',
  );
}

function listerDossiersParIds(bd, entiteId, dossierIds) {
  if (dossierIds.length === 0) return Promise.resolve([]);
  const requete = bd('dossiers')
    .join('candidats', 'candidats.id', 'dossiers.candidat_id')
    .join('statuts', 'statuts.id', 'dossiers.statut_id')
    .leftJoin('dossier_donnees_formulaire as bloc_disponibilites', function () {
      this.on('bloc_disponibilites.dossier_id', '=', 'dossiers.id').andOn(
        'bloc_disponibilites.bloc_code',
        '=',
        bd.raw('?', ['disponibilites']),
      );
    })
    .leftJoin(
      bd('historique_statuts')
        .join('statuts as statuts_test_planifie', 'statuts_test_planifie.id', 'historique_statuts.statut_id')
        .where('statuts_test_planifie.code', 'test_planifie')
        .groupBy('historique_statuts.dossier_id')
        .select(
          'historique_statuts.dossier_id',
          bd.raw('MIN(historique_statuts.date_changement) as date_test_planifie'),
        )
        .as('dates_test_planifie'),
      'dates_test_planifie.dossier_id',
      'dossiers.id',
    );

  // 4 nouvelles cartes "Effectifs par statut" (audit 2026-08-31) — une jointure par statut suivi,
  // voir joindreDateEntreeStatut ci-dessus.
  joindreDateEntreeStatut(requete, bd, 'test_realise');
  joindreDateEntreeStatut(requete, bd, 'valide_pret_embauche');
  joindreDateEntreeStatut(requete, bd, 'formation_non_validee');
  joindreDateEntreeStatut(requete, bd, 'embauche');
  // Carte "Délai moyen Test → Formation" (audit tableau de bord 2026-08-31, point #5, corrigé le
  // 2026-09-01) — ancre de DÉPART du délai formation pour la colonne "Dates clés" (voir
  // statistiquesService.listerDossiersParIndicateurs, dateEntreeFormation).
  joindreDateEntreeStatut(requete, bd, 'valide_envoi_formation');

  return requete
    .leftJoin(
      bd('evaluations')
        .groupBy('evaluations.dossier_id')
        .select('evaluations.dossier_id', bd.raw('MAX(evaluations.date_evaluation) as date_verdict'))
        .as('dates_verdict'),
      'dates_verdict.dossier_id',
      'dossiers.id',
    )
    .leftJoin('evaluations as evaluation_verdict', function () {
      this.on('evaluation_verdict.dossier_id', '=', 'dossiers.id').andOn(
        'evaluation_verdict.date_evaluation',
        '=',
        'dates_verdict.date_verdict',
      );
    })
    // Même patron que statistiquesRepository.delaiTestVersVerdict (JOIN LATERAL, dernière
    // planification AVANT le verdict) — voir commentaire ci-dessus.
    .joinRaw(
      `LEFT JOIN LATERAL (
         SELECT hs.date_changement AS date_derniere_planification_avant_verdict
         FROM historique_statuts hs
         JOIN statuts s ON s.id = hs.statut_id
         WHERE hs.dossier_id = dossiers.id
           AND s.code = 'test_planifie'
           AND hs.date_changement < dates_verdict.date_verdict
         ORDER BY hs.date_changement DESC
         LIMIT 1
       ) AS derniere_planification ON true`,
    )
    // Carte "Délai moyen Test → Formation" (audit tableau de bord 2026-08-31, point #5, corrigé le
    // 2026-09-01, puis le 2026-09-02) — ancre de SORTIE, LATERAL vers la ligne IMMÉDIATEMENT
    // SUIVANTE après l'entrée en formation retenue (dates_valide_envoi_formation, jointure MAX
    // posée par joindreDateEntreeStatut ci-dessus), retenue seulement si CETTE ligne est bien
    // valide_pret_embauche/formation_non_validee — même correctif et même raison que
    // statistiquesRepository.delaiFormation (voir son commentaire) : avant le 2026-09-02, ce LATERAL
    // cherchait la PROCHAINE occurrence du bon type, peu importe ce qui s'intercalait entre l'entrée
    // et elle, pouvant apparier l'entrée retenue à la sortie d'une boucle de formation ULTÉRIEURE
    // (via un retour en test, replanifier_test) si l'entrée retenue elle-même n'aboutit à rien.
    // COALESCE des deux MAX indépendants dates_valide_pret_embauche/dates_formation_non_validee
    // (déjà présentes plus bas pour les cartes "Effectifs par statut") toujours écarté pour la même
    // raison qu'avant : sur un dossier repassé plusieurs fois par la formation, ces deux MAX ne sont
    // pas nécessairement en phase avec l'entrée retenue (elle aussi un MAX), pouvant produire une
    // paire chronologiquement incohérente (sortie antérieure à l'entrée) — même risque déjà écarté
    // pour date_verdict/date_derniere_planification_avant_verdict ci-dessus via ce même patron
    // LATERAL. `code` sélectionné en plus de `date_changement` : filtré dans le SELECT final (CASE),
    // pas dans le WHERE de la sous-requête — LEFT JOIN LATERAL doit continuer à matcher (ON true)
    // même quand la ligne suivante n'est pas une sortie valide, pour que sortie_formation.code reste
    // lisible et distinguable d'une absence totale de ligne suivante.
    .joinRaw(
      `LEFT JOIN LATERAL (
         SELECT hs.date_changement, s.code
         FROM historique_statuts hs
         JOIN statuts s ON s.id = hs.statut_id
         WHERE hs.dossier_id = dossiers.id
           AND hs.date_changement > dates_valide_envoi_formation.date_entree_valide_envoi_formation
         ORDER BY hs.date_changement ASC
         LIMIT 1
       ) AS sortie_formation ON true`,
    )
    // Colonne "Dates clés" pour une sélection "Répartition par poste" (audit 2026-09-02, décision
    // utilisateur) — un poste est un ATTRIBUT du dossier, pas un événement daté du parcours (voir
    // TableauDossiersSelectionnes.construireColonnesAlignees, qui exclut déjà les codes 'poste:*'
    // de son alignement ligne à ligne), donc aucune des ancres existantes ne s'applique. Repli sur
    // la date d'ENTRÉE dans le statut COURANT du dossier — même calcul EXACT que les cartes
    // "Effectifs par statut" (joindreDateEntreeStatut, MAX(historique_statuts.date_changement)),
    // mais GÉNÉRIQUE (corrélé à `dossiers.statut_id`, pas un code fixe en dur) puisque le statut
    // courant diffère d'un dossier à l'autre dans une même liste de résultats — joindreDateEntreeStatut
    // ne convient pas ici (elle prend un code statique en paramètre).
    .joinRaw(
      `LEFT JOIN LATERAL (
         SELECT MAX(hs.date_changement) AS date_entree_statut_courant
         FROM historique_statuts hs
         WHERE hs.dossier_id = dossiers.id
           AND hs.statut_id = dossiers.statut_id
       ) AS entree_statut_courant ON true`,
    )
    .where('dossiers.entite_id', entiteId)
    .whereIn('dossiers.id', dossierIds)
    .select(
      'dossiers.id',
      'dossiers.date_creation',
      'dossiers.date_maj',
      'candidats.nom as candidat_nom',
      'candidats.prenom as candidat_prenom',
      'statuts.code as statut_code',
      'statuts.libelle as statut_libelle',
      'statuts.est_final as statut_est_final',
      'bloc_disponibilites.donnees as donnees_disponibilites',
      'dates_test_planifie.date_test_planifie',
      'entree_statut_courant.date_entree_statut_courant',
      // 4 nouvelles cartes "Effectifs par statut" (audit 2026-08-31) — voir joindreDateEntreeStatut
      // plus haut (sous-requête `dates_<code>`, colonne `date_entree_<code>`).
      'dates_test_realise.date_entree_test_realise',
      'dates_valide_pret_embauche.date_entree_valide_pret_embauche',
      'dates_formation_non_validee.date_entree_formation_non_validee',
      'dates_embauche.date_entree_embauche',
      // Carte "Délai moyen Test → Formation" (audit tableau de bord 2026-08-31, point #5, corrigé le
      // 2026-09-01) — voir joindreDateEntreeStatut(requete, bd, 'valide_envoi_formation') et le
      // LEFT JOIN LATERAL sortie_formation plus haut.
      'dates_valide_envoi_formation.date_entree_valide_envoi_formation',
      // CASE plutôt qu'une colonne directe (voir commentaire du LEFT JOIN LATERAL sortie_formation
      // plus haut) : NULL si la ligne immédiatement suivante n'est pas une sortie valide (boucle
      // interrompue) ou s'il n'y a aucune ligne suivante (boucle encore ouverte) — les deux cas
      // bloquent déjà l'affichage du delta côté front (TableauDossiersSelectionnes.jsx), sans
      // distinction nécessaire entre eux à ce niveau.
      bd.raw(`
        CASE WHEN sortie_formation.code IN ('valide_pret_embauche', 'formation_non_validee')
          THEN sortie_formation.date_changement
        END as date_sortie_formation
      `),
      'dates_verdict.date_verdict',
      'evaluation_verdict.resultat_global as verdict_resultat_global',
      // Orientation EFFECTIVE, pas evaluation_verdict.orientation seule — règle générale (audit
      // 2026-08-12, dossiers #89/#74) : evaluations.orientation reste TOUJOURS NULL pour une
      // évaluation soumise par le rôle Inspecteur, par conception (voir evaluationEngine.js.
      // enregistrerEvaluation — "le bureau n'a pas de notion de formation, son seul verdict
      // positif correspond exactement à ce que [valide_pret_embauche] porte déjà"). Un dossier au
      // statut COURANT valide_pret_embauche (déjà joint ci-dessus, `statuts.code`) sans orientation
      // enregistrée est donc déduit "pret_embauche" — jamais "envoi_formation" par déduction, ce
      // statut n'existant que pour la filière Formateur, qui renseigne toujours orientation
      // explicitement. Même règle EXACTE que statistiquesRepository.ORIENTATION_EFFECTIVE_SQL
      // (dupliquée, pas partagée entre les deux modules — même convention que le reste du projet),
      // pour que le badge "Indicateurs"/la ligne "Dates clés" du tableau détaillé restent cohérents
      // avec le camembert "Formation vs prêt à l'embauche" qu'ils accompagnent.
      bd.raw(`
        COALESCE(
          evaluation_verdict.orientation,
          CASE WHEN statuts.code = 'valide_pret_embauche' THEN 'pret_embauche' END
        ) as verdict_orientation
      `),
      'derniere_planification.date_derniere_planification_avant_verdict',
    );
}

// Informations saisies par le candidat à l'inscription, réunies pour la section repliable
// "Informations d'inscription complètes" de la fiche dossier (Validation.jsx/Relances.jsx,
// CLAUDE.md — besoin RH/recruteur de retrouver le détail du formulaire d'origine sans revenir au
// dossier papier). Exclut délibérément nir/nir_iv/nir_hash de la sélection candidats : le NIR ne
// doit jamais être déchiffré pour un affichage back-office générique (voir CLAUDE.md, section
// Contraintes RGPD — déchiffrement serveur réservé aux usages qui en ont explicitement besoin,
// aucun aujourd'hui côté consultation de dossier). Scopé par entiteId, même filtre IDOR que
// trouverDossierAvecStatutParId : renvoie undefined si le dossier n'appartient pas à l'entité
// courante.
async function trouverInscriptionCompleteParDossierId(bd, entiteId, dossierId) {
  const candidat = await bd('dossiers')
    .join('candidats', 'candidats.id', 'dossiers.candidat_id')
    .where({ 'dossiers.id': dossierId, 'dossiers.entite_id': entiteId })
    .select(
      'candidats.civilite',
      'candidats.nom',
      'candidats.nom_naissance as nomNaissance',
      'candidats.prenom',
      'candidats.date_naissance as dateNaissance',
      'candidats.lieu_naissance as lieuNaissance',
      'candidats.nationalite',
      'candidats.situation_familiale as situationFamiliale',
      'candidats.email',
      'candidats.date_creation as dateInscription',
    )
    .first();
  if (!candidat) return undefined;

  // Tous les blocs déjà enregistrés pour ce dossier (coordonnees/disponibilites/mutuelle/
  // consentement_rgpd — voir dossierService.inscrireCandidat) : pas de filtre bloc_code, cette
  // vue est volontairement exhaustive, contrairement à trouverCoordonneesCandidat (un seul bloc).
  const blocs = await bd('dossier_donnees_formulaire').where({ dossier_id: dossierId }).select('bloc_code', 'donnees');

  return {
    candidat,
    blocs: Object.fromEntries(blocs.map(({ bloc_code: blocCode, donnees }) => [blocCode, donnees])),
  };
}

// NIR chiffré (bytea) + IV — volontairement SÉPARÉ de trouverInscriptionCompleteParDossierId
// ci-dessus, dont le résultat est renvoyé tel quel par GET /api/dossiers/:dossierId/inscription
// (dossiers.routes.js) à plusieurs rôles back-office pour un affichage générique ("hors NIR",
// voir le commentaire de cette route). Un appelant qui a un besoin explicite de déchiffrer le NIR
// (aujourd'hui : smartOfService.js uniquement) doit passer par cette fonction dédiée, jamais
// mélanger nirChiffre/nirIv dans une forme déjà exposée en HTTP (CLAUDE.md, Contraintes RGPD).
async function trouverNirChiffreParDossierId(bd, entiteId, dossierId) {
  return bd('dossiers')
    .join('candidats', 'candidats.id', 'dossiers.candidat_id')
    .where({ 'dossiers.id': dossierId, 'dossiers.entite_id': entiteId })
    .select('candidats.nir as nirChiffre', 'candidats.nir_iv as nirIv')
    .first();
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
  trouverInscriptionCompleteParDossierId,
  trouverNirChiffreParDossierId,
  trouverCoordonneesCandidat,
  enregistrerDonneesBloc,
  mettreAJourDonneesBloc,
  mettreAJourCandidat,
  trouverCharteActive,
  enregistrerSignatureCharte,
  trouverStatutParCode,
  trouverUtilisateurSysteme,
  enregistrerChangementStatut,
  mettreAJourDateEmbauche,
  listerDossiers,
  listerSuiviFormation,
  listerHistoriqueFormation,
  listerDossiersParIds,
  listerStatuts,
  listerResumesParIds,
  obtenirDerniereModification,
};
