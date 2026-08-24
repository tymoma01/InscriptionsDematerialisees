// Accès données pour les rendez-vous — uniquement des requêtes, aucune règle métier ici
// (orchestrée par rappelService.js / rendezvousService.js), même découpage que dossierRepository.js.

// Rendez-vous à venir dans la fenêtre [maintenant, maintenant + fenetreHeures], pas encore
// confirmés/annulés ('prevu' uniquement, voir rendezvous.statut : 'prevu'|'confirme'|'absent'|
// 'annule'), et n'ayant pas déjà reçu de rappel — le NOT EXISTS sur `relances.rendezvous_id`
// (migration 029) est ce qui empêche un double envoi d'un run à l'autre du job de rappel (CLAUDE.md,
// besoin Accueil/Coordination "ne pas relancer en double", ici appliqué au rappel automatique).
function listerRendezvousARappeler(bd, entiteId, { fenetreHeures }) {
  return bd('rendezvous')
    .join('dossiers', 'dossiers.id', 'rendezvous.dossier_id')
    .join('candidats', 'candidats.id', 'dossiers.candidat_id')
    .where('dossiers.entite_id', entiteId)
    .andWhere('rendezvous.statut', 'prevu')
    .andWhereRaw("rendezvous.date_heure BETWEEN now() AND now() + make_interval(hours => ?)", [fenetreHeures])
    .whereNotExists(function () {
      this.select(1).from('relances').whereRaw('relances.rendezvous_id = rendezvous.id');
    })
    .select(
      'rendezvous.id',
      'rendezvous.dossier_id',
      'rendezvous.type_rdv',
      'rendezvous.date_heure',
      'candidats.prenom as candidat_prenom',
      'candidats.nom as candidat_nom',
    );
}

// Rendez-vous de test dont la date est passée, toujours 'prevu' (ni confirmé, ni marqué absent/
// annulé par un agent — GestionRendezvous.jsx, ni replanifié — 'remplace'), sur un dossier
// toujours 'test_planifie' — candidats à la bascule automatique "Test non réalisé" (voir
// basculeTestNonRealiseService.js, tâche planifiée CLAUDE.md). Le filtre sur statuts.code évite
// d'inclure un dossier déjà sorti du parcours test (évalué, replanifié entre-temps...) ; la
// re-vérification finale du statut du RENDEZ-VOUS lui-même (au moment précis de la bascule, pas
// ici) reste portée par trouverRendezvousPourBasculeVerrouillee ci-dessous, contre une action
// manuelle concurrente survenue entre cette lecture et l'écriture.
function listerRendezvousTestNonRealisesAutomatiquement(bd, entiteId) {
  return bd('rendezvous')
    .join('dossiers', 'dossiers.id', 'rendezvous.dossier_id')
    .join('statuts', 'statuts.id', 'dossiers.statut_id')
    .where({
      'dossiers.entite_id': entiteId,
      'rendezvous.type_rdv': 'test',
      'rendezvous.statut': 'prevu',
      'statuts.code': 'test_planifie',
    })
    .andWhere('rendezvous.date_heure', '<', bd.fn.now())
    .select('rendezvous.id', 'rendezvous.dossier_id', 'rendezvous.date_heure');
}

// Relecture verrouillée (FOR UPDATE) d'un rendez-vous précis, juste avant la bascule automatique
// (voir basculeTestNonRealiseService.js) — revérifie l'état RÉEL du rendez-vous au moment exact de
// l'écriture, pas seulement au moment de listerRendezvousTestNonRealisesAutomatiquement ci-dessus :
// un agent a pu le confirmer/marquer absent/annulé entre les deux. FOR UPDATE verrouille la ligne
// le temps de la transaction, pour qu'une mise à jour concurrente de rendezvous.statut
// (changerStatutRendezvous) attende que cette transaction se termine plutôt que de risquer une
// bascule sur une valeur déjà obsolète — `trx` obligatoire (jamais `bd` seul), un verrou FOR UPDATE
// n'a de sens que dans une transaction.
function trouverRendezvousPourBasculeVerrouillee(trx, rendezvousId) {
  return trx('rendezvous').where({ id: rendezvousId }).forUpdate().first();
}

// Scopé par entiteId (jointure vers dossiers) : un rendezvousId est un entier séquentiel, donc
// devinable — sans ce filtre, un agent authentifié d'une entité pourrait agir sur le rendez-vous
// d'une autre entité en devinant son id, même faille IDOR déjà corrigée pour les pièces
// justificatives et les relances (voir pieceJustificativeService.js / relanceService.js).
function trouverRendezvousParId(bd, entiteId, rendezvousId) {
  return bd('rendezvous')
    .join('dossiers', 'dossiers.id', 'rendezvous.dossier_id')
    .where({ 'rendezvous.id': rendezvousId, 'dossiers.entite_id': entiteId })
    .select('rendezvous.*')
    .first();
}

// Jointure sur motifs pour exposer le libellé du motif de désistement (pas seulement motif_id) —
// évite au consommateur (écran coordination) une seconde requête par ligne. dossierId est déjà
// vérifié comme appartenant à l'entité par rendezvousService avant d'appeler cette fonction,
// même principe que pieceJustificativeRepository.listerPiecesParDossier.
// note_planification (migration 049) exposée directement, colonne du rendez-vous lui-même — pas
// de jointure nécessaire pour elle.
// planifie_par_* : même mécanisme que cree_par_*/cree_le dans listerHistoriqueRendezvousParDossiers
// ci-dessous (leftJoin journal_audit, rendezvous n'a lui-même aucune colonne auteur, voir migration
// 018) — repris ici plutôt qu'une nouvelle colonne dédiée sur `rendezvous`, pour ne pas dupliquer
// une traçabilité déjà fiable. planifie_par_role_libelle (roles.libelle, déjà en base pour le RBAC,
// voir rbac.js) ajouté en plus de prenom/nom — aucune requête supplémentaire, une seule jointure de
// plus sur une table déjà minuscule (quelques lignes). NULL pour tout rendez-vous sans entrée
// journal_audit correspondante (même cas que cree_par_* : scripts de dev, migrations de données) —
// à GestionRendezvous.jsx de composer l'affichage nom+rôle en conséquence, jamais en devinant.
function listerRendezvousParDossier(bd, dossierId) {
  return bd('rendezvous')
    .leftJoin('motifs', 'motifs.id', 'rendezvous.motif_id')
    .leftJoin('journal_audit as audit_planification', function () {
      this.on('audit_planification.cible_id', '=', 'rendezvous.id')
        .andOn('audit_planification.table_cible', '=', bd.raw('?', ['rendezvous']))
        .andOnIn('audit_planification.action', ['rendezvous_cree', 'rendezvous_cree_avec_transitions']);
    })
    .leftJoin('utilisateurs as agent_planificateur', 'agent_planificateur.id', 'audit_planification.utilisateur_id')
    .leftJoin('roles as role_planificateur', 'role_planificateur.id', 'agent_planificateur.role_id')
    .where({ 'rendezvous.dossier_id': dossierId })
    .select(
      'rendezvous.id',
      'rendezvous.type_rdv',
      'rendezvous.date_heure',
      'rendezvous.statut',
      'rendezvous.note_planification',
      // formateur_id/lieu_id/postes_selectionnes (audit 2026-08-24, préremplissage de la
      // replanification groupée depuis "Dossiers candidats") — absents jusqu'ici de ce select
      // (aucun consommateur n'en avait besoin), ajoutés en pur ajout de colonnes : aucun appelant
      // existant (GestionRendezvous.jsx, Tests.jsx) ne casse en recevant des clés en plus qu'il
      // n'utilise pas.
      'rendezvous.formateur_id',
      'rendezvous.lieu_id',
      'rendezvous.postes_selectionnes',
      'motifs.code as motif_code',
      'motifs.libelle as motif_libelle',
      'agent_planificateur.prenom as planifie_par_prenom',
      'agent_planificateur.nom as planifie_par_nom',
      'role_planificateur.libelle as planifie_par_role_libelle',
      // Date/heure de saisie de la note de planification (audit 2026-08-19, demande explicite) —
      // même colonne journal_audit.date_action que cree_le dans
      // listerHistoriqueRendezvousParDossiers ci-dessous : l'écriture de note_planification n'a
      // lieu qu'à la création du rendez-vous (jamais modifiée après coup, voir
      // ModalePlanificationTest.jsx), donc la date de CETTE entrée journal_audit est bien celle de
      // la saisie de la note, pas seulement celle du rendez-vous. NULL dans le même cas que
      // planifie_par_* (rendez-vous créé hors API).
      'audit_planification.date_action as planifie_le',
    )
    // Tri à deux niveaux (audit 2026-08-19, demande explicite) :
    // 1. Le(s) rendez-vous ACTIF(S) (statut != 'remplace' — prevu/confirme/absent/annule, voir
    //    GestionRendezvous.jsx varianteStatutRendezvous) toujours en tête, quelle que soit sa date
    //    de planification par rapport aux rendez-vous 'remplace' plus récemment (re)planifiés :
    //    trier uniquement par planifie_le plaçait sinon le rendez-vous actif au milieu de la
    //    liste, entouré de rendez-vous 'remplace' plus récents en planification mais sans
    //    pertinence pour l'agent (voir orderByRaw ci-dessous, `statut = 'remplace'` vaut false
    //    pour l'actif, qui trie donc avant `true` en ASC).
    // 2. Les rendez-vous 'remplace', ENTRE EUX, restent triés par date de PLANIFICATION
    //    (planifie_le, quand l'agent a enregistré CE rendez-vous, pas date_heure — quand le test
    //    aura/a eu lieu), du plus récent au plus ancien — tri déjà en place, conservé tel quel.
    //    NULLS LAST : un rendez-vous sans entrée journal_audit (planifie_le NULL, voir son
    //    commentaire plus haut — scripts de dev, migrations de données) retombe en fin de liste
    //    plutôt qu'en tête.
    .orderByRaw("(rendezvous.statut = 'remplace') asc")
    .orderBy([{ column: 'audit_planification.date_action', order: 'desc', nulls: 'last' }]);
}

// Vue d'ensemble des rendez-vous de test, tous dossiers confondus (page Planification côté
// Coordination, CLAUDE.md : "planifie les tests") — 'test' explicitement plutôt qu'un paramètre
// type_rdv générique : même choix que evaluationRepository.listerRendezvousAEvaluer, cette page
// ne parle que de tests, pas de rendez-vous en général (ex. signature de contrat, à venir).
// formateur_id étant nullable, leftJoin (un rendez-vous pas encore assigné doit rester listé).
// dateDebut/dateFin : bornes du jour au format 'AAAA-MM-JJ' (dateFin exclusive), utilisées par le
// calendrier de disponibilité d'un formateur (voir CalendrierDisponibiliteFormateur.jsx) pour ne
// charger que le mois affiché. Comparées telles quelles à date_heure (timestamptz) : la précision
// est à la journée, suffisante pour un calendrier — pas de conversion de fuseau applicative ici,
// même niveau de simplicité que le reste du filtrage par date de ce dépôt (aVenirSeulement
// ci-dessous compare aussi directement à bd.fn.now()).
// Jointure gauche vers dossier_donnees_formulaire (bloc 'disponibilites', JSONB, migration 013)
// pour exposer le(s) poste(s) recherché(s) sur la colonne "Poste" de Planification.jsx — même
// patron que dossierRepository.listerDossiers / evaluationRepository.listerRendezvousAEvaluer.
// Keyed sur dossiers.id (pas rendezvous.id) : le bloc est propre au dossier, pas au rendez-vous.
function listerRendezvousTest(bd, entiteId, { aVenirSeulement, formateurId, dateDebut, dateFin } = {}) {
  const requete = bd('rendezvous')
    .join('dossiers', 'dossiers.id', 'rendezvous.dossier_id')
    .join('candidats', 'candidats.id', 'dossiers.candidat_id')
    .leftJoin('utilisateurs', 'utilisateurs.id', 'rendezvous.formateur_id')
    .leftJoin('dossier_donnees_formulaire as bloc_disponibilites', function () {
      this.on('bloc_disponibilites.dossier_id', '=', 'dossiers.id').andOn(
        'bloc_disponibilites.bloc_code',
        '=',
        bd.raw('?', ['disponibilites']),
      );
    })
    .where({ 'dossiers.entite_id': entiteId, 'rendezvous.type_rdv': 'test' })
    .select(
      'rendezvous.id',
      'rendezvous.dossier_id',
      'rendezvous.date_heure',
      'rendezvous.statut',
      'candidats.prenom as candidat_prenom',
      'candidats.nom as candidat_nom',
      'utilisateurs.prenom as formateur_prenom',
      'utilisateurs.nom as formateur_nom',
      'bloc_disponibilites.donnees as donnees_disponibilites',
    )
    .orderBy('rendezvous.date_heure', 'asc');

  if (aVenirSeulement) {
    requete.andWhere('rendezvous.date_heure', '>=', bd.fn.now()).whereIn('rendezvous.statut', ['prevu', 'confirme']);
  }
  if (formateurId) {
    requete.andWhere('rendezvous.formateur_id', formateurId);
  }
  if (dateDebut) {
    requete.andWhere('rendezvous.date_heure', '>=', dateDebut);
  }
  if (dateFin) {
    requete.andWhere('rendezvous.date_heure', '<', dateFin);
  }
  // Un calendrier de disponibilité ne doit montrer comme "occupé" que ce qui bloque
  // effectivement un nouveau créneau (même convention que compterRendezvousFormateurAuCreneau) —
  // un rendez-vous absent/annulé a libéré la place. Seulement quand une borne de date est fournie
  // : aVenirSeulement gère déjà ce filtre pour son propre usage (page Planification), pas la
  // peine de dupliquer le whereIn si les deux sont absents (comportement historique inchangé).
  if ((dateDebut || dateFin) && !aVenirSeulement) {
    requete.whereIn('rendezvous.statut', ['prevu', 'confirme']);
  }

  return requete;
}

// Historique complet (passé ET futur, tous statuts) des rendez-vous de test d'un ou plusieurs
// dossiers (voir rendezvousService.listerHistoriqueRendezvousDossiers, page Planification côté
// Coordination) — contrairement à listerRendezvousTest ci-dessus, aucun filtre `aVenirSeulement`
// ni whereIn sur statut : c'est justement tout l'historique, y compris les tentatives passées
// (replanifiées, manquées, honorées), qui intéresse cet écran. Jointure gauche vers `evaluations`
// (migration 020) : c'est la présence d'une ligne évaluation, pas rendezvous.statut, qui indique
// qu'un test a réellement eu lieu (voir rendezvousService.categoriserStatutRendezvous) —
// `evaluations.rendezvous_id` n'a pas de contrainte UNIQUE mais un rendez-vous n'est en pratique
// jamais évalué deux fois (evaluationEngine.enregistrerEvaluation rejette une évaluation déjà
// existante), donc ce leftJoin ne duplique jamais une ligne rendez-vous.
//
// motif_libelle/evaluation_commentaire : les deux seules sources de "note" réellement rattachées
// à CE rendez-vous précis (contrairement aux notes_dossier, jamais liées à un rendez-vous — voir
// notesDossierRepository.listerNotesParDossiers, affichées séparément par
// rendezvousService.listerHistoriqueRendezvousDossiers). Mutuellement exclusifs en pratique : un
// motif n'existe que sur un rendez-vous 'absent'/'annule' (migration 031), un commentaire
// d'évaluation seulement s'il existe une évaluation liée — jamais les deux en même temps, voir
// rendezvousService.categoriserStatutRendezvous (l'évaluation prime toujours sur le statut brut).
// leftJoin vers journal_audit pour exposer qui a créé ce rendez-vous (colonnes cree_le/
// cree_par_prenom/cree_par_nom) — rendezvous n'a lui-même aucune colonne auteur (voir migration
// 018), la seule trace existante est l'entrée journal_audit écrite par rendezvous.routes.js à la
// création (action 'rendezvous_cree' ou 'rendezvous_cree_avec_transitions', voir journalAudit.js).
// table_cible/cible_id (pas de colonne rendezvous_id dédiée sur journal_audit) identifient la
// ligne au même titre qu'une FK classique. Un même rendezvous.id ne peut correspondre qu'à UNE
// seule de ces deux actions (routes POST / et POST /avec-transitions mutuellement exclusives) :
// ce leftJoin ne duplique donc jamais une ligne rendez-vous, comme le leftJoin evaluations plus
// haut. cree_le/cree_par_* restent NULL (jamais '-' ni une valeur devinée) pour tout rendez-vous
// sans entrée correspondante — notamment ceux insérés hors API (scripts de dev type
// backend/scripts/creerRendezvousTest.js) — à l'appelant (PanneauHistoriqueRendezvous.jsx)
// d'afficher explicitement "non tracé" plutôt que de laisser croire à une création anonyme.
function listerHistoriqueRendezvousParDossiers(bd, entiteId, dossierIds) {
  return bd('rendezvous')
    .join('dossiers', 'dossiers.id', 'rendezvous.dossier_id')
    .join('candidats', 'candidats.id', 'dossiers.candidat_id')
    .leftJoin('utilisateurs', 'utilisateurs.id', 'rendezvous.formateur_id')
    .leftJoin('motifs', 'motifs.id', 'rendezvous.motif_id')
    .leftJoin('evaluations', 'evaluations.rendezvous_id', 'rendezvous.id')
    .leftJoin('journal_audit as audit_creation', function () {
      this.on('audit_creation.cible_id', '=', 'rendezvous.id')
        .andOn('audit_creation.table_cible', '=', bd.raw('?', ['rendezvous']))
        .andOnIn('audit_creation.action', ['rendezvous_cree', 'rendezvous_cree_avec_transitions']);
    })
    .leftJoin('utilisateurs as agent_createur', 'agent_createur.id', 'audit_creation.utilisateur_id')
    .where({ 'dossiers.entite_id': entiteId, 'rendezvous.type_rdv': 'test' })
    .whereIn('rendezvous.dossier_id', dossierIds)
    .select(
      'rendezvous.id',
      'rendezvous.dossier_id',
      'rendezvous.date_heure',
      'rendezvous.statut',
      'motifs.code as motif_code',
      'motifs.libelle as motif_libelle',
      'candidats.prenom as candidat_prenom',
      'candidats.nom as candidat_nom',
      'utilisateurs.prenom as formateur_prenom',
      'utilisateurs.nom as formateur_nom',
      'evaluations.id as evaluation_id',
      'evaluations.resultat_global as evaluation_resultat',
      'evaluations.commentaire as evaluation_commentaire',
      'audit_creation.date_action as cree_le',
      'agent_createur.prenom as cree_par_prenom',
      'agent_createur.nom as cree_par_nom',
    )
    .orderBy([{ column: 'rendezvous.dossier_id' }, { column: 'rendezvous.date_heure', order: 'desc' }]);
}

// Rendez-vous de test actuellement "actif" d'un dossier (voir rendezvousService.
// verifierDelaiAvantReplanification) : le plus récent par date_heure parmi les rendez-vous 'test'
// encore 'prevu'/'confirme' — un rendez-vous 'absent'/'annule' a déjà été traité par le formateur
// (ou l'agent), il ne bloque plus rien. S'il existe plusieurs lignes 'prevu' pour ce dossier
// (aucune transition ne referme automatiquement l'ancien rendez-vous lors d'une replanification,
// voir ListeEvaluationsAFaire.jsx), c'est la plus récente qui représente le créneau réellement
// attendu par le formateur.
function trouverRendezvousTestActifDossier(bd, dossierId) {
  return bd('rendezvous')
    .where({ dossier_id: dossierId, type_rdv: 'test' })
    .whereIn('statut', ['prevu', 'confirme'])
    .orderBy('date_heure', 'desc')
    .first();
}

function mettreAJourStatutRendezvous(bd, rendezvousId, { statut, motifId }) {
  return bd('rendezvous')
    .where({ id: rendezvousId })
    .update({ statut, motif_id: motifId })
    .returning('*')
    .then(([rendezvous]) => rendezvous);
}

// Neutralise le(s) rendez-vous du même dossier+type encore actif(s) ('prevu'/'confirme') — voir
// rendezvousService.creerRendezvous, appelée juste avant la création d'un nouveau rendez-vous pour
// corriger la cause racine des doublons (audit du 2026-08-13, dossier #88 rendez-vous 61-65) :
// jusqu'ici, rien ne referme l'ancien rendez-vous lors d'une replanification, les deux restaient
// 'prevu' en parallèle. Ne touche QUE `statut` (contrairement à mettreAJourStatutRendezvous
// ci-dessus, pensée pour un agent qui choisit aussi `motif_id`) : toutes les autres colonnes
// (date_heure, formateur_id, motif_id existant...) restent intactes, aucune suppression — la
// traçabilité/l'historique par dossier (listerHistoriqueRendezvousParDossiers) continue de les
// exposer avec leurs données d'origine. `whereIn('statut', ...)` plutôt qu'un seul id récupéré via
// trouverRendezvousTestActifDossier : neutralise tout doublon déjà présent (auto-cicatrisation
// d'un dossier ayant accumulé plusieurs rendez-vous actifs avant ce correctif), pas seulement le
// plus récent.
// `typeRdv` désormais optionnel (audit 2026-08-21, workflowEngine.appliquerTransition) : ce moteur
// générique ne connaît aucun type de rendez-vous en dur (voir son commentaire d'en-tête) et doit
// pouvoir neutraliser TOUS les rendez-vous actifs d'un dossier passant à un statut clos, quel que
// soit leur type — les appelants existants (rendezvousService.creerRendezvous) continuent de
// fournir `typeRdv` explicitement, comportement inchangé pour eux.
function neutraliserRendezvousActifsDossier(bd, { dossierId, typeRdv, statutRemplace }) {
  const requete = bd('rendezvous')
    .where({ dossier_id: dossierId })
    .whereIn('statut', ['prevu', 'confirme']);
  if (typeRdv) requete.andWhere({ type_rdv: typeRdv });
  return requete.update({ statut: statutRemplace });
}

// Nombre de candidats déjà assignés à ce formateur au même horaire exact (voir
// rendezvousService.creerRendezvous, CAPACITE_MAX_FORMATEUR_PAR_CRENEAU) — 'prevu'/'confirme'
// uniquement : un rendez-vous marqué absent ou annulé libère la place, il ne doit pas compter
// dans l'occupation du créneau.
async function compterRendezvousFormateurAuCreneau(bd, formateurId, dateHeure) {
  const ligne = await bd('rendezvous')
    .where({ formateur_id: formateurId, date_heure: dateHeure })
    .whereIn('statut', ['prevu', 'confirme'])
    .count({ total: '*' })
    .first();
  return Number(ligne.total);
}

// Toujours créé au statut 'prevu' (voir rendezvousService.STATUTS_AUTORISES) — un rendez-vous ne
// naît jamais confirmé/absent/annulé, ces statuts ne se posent qu'après coup via
// mettreAJourStatutRendezvous. formateurId/lieuId peuvent être nuls (rendez-vous pas encore
// assigné à un formateur, ou sans lieu précisé) : voir rendezvousService.creerRendezvous pour la
// validation en amont (rôle formateur, lieu actif de l'entité).
// notePlanification : note libre optionnelle pour le formateur/inspecteur (migration 049) —
// undefined/chaîne vide stockés NULL (?? null, jamais ''), pour que l'email/l'affichage puissent
// se contenter d'un test de vérité simple (voir invitationTestService.js/GestionRendezvous.jsx)
// plutôt que devoir aussi distinguer une chaîne vide d'une valeur absente.
async function creerRendezvous(
  bd,
  { dossierId, typeRdv, dateHeure, formateurId, lieuId, postesSelectionnes = [], notePlanification },
) {
  const [rendezvous] = await bd('rendezvous')
    .insert({
      dossier_id: dossierId,
      type_rdv: typeRdv,
      date_heure: dateHeure,
      formateur_id: formateurId,
      lieu_id: lieuId,
      statut: 'prevu',
      // JSON.stringify explicite (même patron que dossierRepository.enregistrerDonneesBloc) :
      // ne pas laisser le driver pg deviner la sérialisation d'un tableau JS pour une colonne
      // jsonb (migration 039).
      postes_selectionnes: JSON.stringify(postesSelectionnes),
      note_planification: notePlanification || null,
    })
    .returning('*');
  return rendezvous;
}

// Rendez-vous référençant un lieu donné, tous statuts/dates confondus (passés ET futurs, voir
// lieuService.supprimerLieu — la suppression d'un lieu doit tenir compte de tout l'historique, pas
// seulement des créneaux à venir, contrairement à listerRendezvousTest ci-dessus). Jointure vers
// dossier_donnees_formulaire (bloc 'coordonnees') en plus de candidats : email/téléphone
// nécessaires pour la notification de changement d'adresse (voir
// notificationChangementLieuService.js), résolus ici en une seule requête plutôt qu'un lookup par
// rendez-vous (même raisonnement que dossierRepository.listerDossiers pour ce même bloc). Jointure
// gauche vers utilisateurs (formateur_id, nullable) en plus — même patron que listerRendezvousTest
// ci-dessus : sert à ce que le .ics regénéré pour cette notification (voir generateurIcs.js)
// reprenne le même participant formateur que l'.ics de la convocation initiale, pas seulement le
// candidat. Jointure gauche vers roles en plus (audit 2026-08-21) : formateur_role_code
// (formateur/inspecteur) nécessaire pour construireLienEvaluation (voir formatageEmail.js) —
// distingue /formateur/evaluations de /inspecteur/evaluations dans le lien envoyé par
// notificationChangementLieuService.js, même donnée que formateur.role_code déjà disponible côté
// invitationTestService.js (utilisateurRepository.trouverUtilisateurParId, qui joint roles).
function listerRendezvousParLieu(bd, entiteId, lieuId) {
  return bd('rendezvous')
    .join('dossiers', 'dossiers.id', 'rendezvous.dossier_id')
    .join('candidats', 'candidats.id', 'dossiers.candidat_id')
    .leftJoin('utilisateurs', 'utilisateurs.id', 'rendezvous.formateur_id')
    .leftJoin('roles', 'roles.id', 'utilisateurs.role_id')
    .leftJoin('dossier_donnees_formulaire as bloc_coordonnees', function () {
      this.on('bloc_coordonnees.dossier_id', '=', 'dossiers.id').andOn(
        'bloc_coordonnees.bloc_code',
        '=',
        bd.raw('?', ['coordonnees']),
      );
    })
    .where({ 'dossiers.entite_id': entiteId, 'rendezvous.lieu_id': lieuId })
    .select(
      'rendezvous.id',
      'rendezvous.dossier_id',
      'rendezvous.date_heure',
      'rendezvous.statut',
      'candidats.prenom as candidat_prenom',
      'candidats.nom as candidat_nom',
      'bloc_coordonnees.donnees as donnees_coordonnees',
      'utilisateurs.prenom as formateur_prenom',
      'utilisateurs.nom as formateur_nom',
      'utilisateurs.email as formateur_email',
      'roles.code as formateur_role_code',
    )
    .orderBy('rendezvous.date_heure', 'asc');
}

// Migration en masse (voir lieuService.supprimerLieu, appelée dans la même transaction que la
// suppression du lieu d'origine — la FK rendezvous.lieu_id, migration 045, n'a pas de ON DELETE
// CASCADE/SET NULL, la migration doit donc précéder la suppression). Pas de filtre entiteId ici :
// lieuIdOrigine/lieuIdDestination sont déjà vérifiés comme appartenant à l'entité courante par
// l'appelant (lieuRepository.trouverLieuParId) avant que cette fonction ne soit invoquée.
function migrerRendezvousVersLieu(trx, { lieuIdOrigine, lieuIdDestination }) {
  return trx('rendezvous').where({ lieu_id: lieuIdOrigine }).update({ lieu_id: lieuIdDestination });
}

module.exports = {
  listerRendezvousARappeler,
  listerRendezvousTestNonRealisesAutomatiquement,
  trouverRendezvousPourBasculeVerrouillee,
  trouverRendezvousParId,
  listerRendezvousParDossier,
  listerRendezvousTest,
  listerHistoriqueRendezvousParDossiers,
  mettreAJourStatutRendezvous,
  compterRendezvousFormateurAuCreneau,
  trouverRendezvousTestActifDossier,
  neutraliserRendezvousActifsDossier,
  creerRendezvous,
  listerRendezvousParLieu,
  migrerRendezvousVersLieu,
};
