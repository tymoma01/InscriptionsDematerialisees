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
// complet, pas seulement ce qui tombe dans la période KPI en cours. MIN() : premier passage en
// "test_planifie"/première évaluation, cohérent avec listerEnvoyesEnTest/listerVerdicts (mêmes
// dates que les indicateurs KPI correspondants, juste sans le filtre de période). NULL si l'étape
// n'a pas encore été atteinte — laissé tel quel, c'est justement ce qui permet au front de
// n'afficher que les lignes pertinentes (pas de date vide/placeholder, voir
// statistiquesService.listerDossiersParIndicateurs).
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
// TableauDossiersSelectionnes.jsx).
function listerDossiersParIds(bd, entiteId, dossierIds) {
  if (dossierIds.length === 0) return Promise.resolve([]);
  return bd('dossiers')
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
    )
    .leftJoin(
      bd('evaluations')
        .groupBy('evaluations.dossier_id')
        .select('evaluations.dossier_id', bd.raw('MIN(evaluations.date_evaluation) as date_verdict'))
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
  listerDossiers,
  listerDossiersParIds,
  listerStatuts,
  listerResumesParIds,
  obtenirDerniereModification,
};
