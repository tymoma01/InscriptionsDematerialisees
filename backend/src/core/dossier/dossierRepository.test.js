const test = require('node:test');
const assert = require('node:assert/strict');
const knex = require('knex');

const dossierRepository = require('./dossierRepository');

// `bd` : instance knex RÉELLE mais JAMAIS connectée — `client: 'pg'` suffit à générer du SQL
// valide et à le récupérer via `.toString()`, sans dépendre d'une connexion Neon réelle. Même
// principe que statistiquesRepository.test.js.
const bd = knex({ client: 'pg' });

// Couvre le correctif du 2026-08-12 (audit dossiers #89/#74) : le badge "Indicateurs"/la ligne
// "Dates clés" du tableau détaillé (colonne verdict_orientation) doivent refléter la MÊME
// orientation EFFECTIVE que le camembert "Formation vs prêt à l'embauche"
// (statistiquesRepository.compterOrientations/listerOrientations) — sinon le camembert compterait
// un dossier Inspecteur sous "Prêt à l'embauche" alors que son badge/sa date resteraient invisibles
// dans le tableau détaillé, rouvrant l'incohérence par un autre chemin.
test('listerDossiersParIds déduit verdict_orientation="pret_embauche" par COALESCE quand evaluation_verdict.orientation est NULL (rôle Inspecteur, statut valide_pret_embauche)', () => {
  const sql = dossierRepository.listerDossiersParIds(bd, 1, [74, 89]).toString();
  assert.match(
    sql,
    /COALESCE\(\s*evaluation_verdict\.orientation,\s*CASE WHEN statuts\.code = 'valide_pret_embauche' THEN 'pret_embauche' END\s*\)\s*as verdict_orientation/,
  );
});

// Correctif 2026-09-02 (audit dashboard, dossier #88, décision utilisateur : "c'est la DERNIÈRE
// évaluation qui fait foi partout") — date_verdict doit être ancré sur la DERNIÈRE évaluation du
// dossier (MAX), pas la première (MIN, comportement avant ce correctif) : sinon la colonne
// "Dates clés" pouvait afficher la date ET le résultat d'un échec initial alors que le badge
// "Indicateurs" (statistiquesRepository.listerVerdicts, corrigé de la même façon) affichait déjà
// "Test réussi" pour ce même dossier.
test('listerDossiersParIds ancre date_verdict sur la DERNIÈRE évaluation du dossier (MAX), pas la première', () => {
  const sql = dossierRepository.listerDossiersParIds(bd, 1, [74, 89]).toString();
  assert.match(sql, /MAX\(evaluations\.date_evaluation\) as date_verdict/);
  assert.doesNotMatch(sql, /MIN\(evaluations\.date_evaluation\) as date_verdict/);
});

// Correctif 2026-09-18 (audit tableau de bord, demande utilisateur) — la ligne "Test planifié" de
// "Dates clés" doit refléter la date/heure RÉELLEMENT prévue pour le test (rendez-vous), pas la
// date à laquelle le STATUT a basculé vers test_planifie : date_rendezvous_test_planifie (MAX,
// tous statuts de rendez-vous confondus, décision utilisateur — reste renseignée même une fois le
// test honoré/absent/annulé) vient s'ajouter à date_test_planifie (MIN historique_statuts,
// INCHANGÉE, conservée pour le délai "Inscription → Envoi en test" uniquement).
test('listerDossiersParIds joint le rendez-vous de test le plus RÉCENT (MAX date_heure, tous statuts confondus) sans filtrer sur rendezvous.statut, en plus de date_test_planifie inchangée', () => {
  const sql = dossierRepository.listerDossiersParIds(bd, 1, [74, 89]).toString();
  assert.match(sql, /MAX\(date_heure\) as date_rendezvous_test_planifie/);
  assert.match(sql, /"type_rdv" = 'test'/);
  assert.doesNotMatch(
    sql.match(/select "dossier_id", MAX\(date_heure\)[^)]*\) as "dates_rendezvous_test_planifie"/)?.[0] ?? '',
    /'prevu'|'confirme'/,
    'ne doit filtrer sur aucun statut de rendez-vous (tous statuts confondus, décision utilisateur)',
  );
  assert.match(sql, /MIN\(historique_statuts\.date_changement\) as date_test_planifie/, 'date_test_planifie doit rester inchangée (MIN)');
  assert.match(sql, /"dates_rendezvous_test_planifie"\."date_rendezvous_test_planifie"/);
});

// Colonne "Dates clés" enrichie pour les 4 nouvelles cartes "Effectifs par statut" (audit tableau
// de bord 2026-08-31, décision utilisateur) — une jointure LEFT JOIN dédiée par statut suivi
// (joindreDateEntreeStatut), MAX(historique_statuts.date_changement), même calcul que
// listerSuiviFormation.dates_entree_formation (voir plus bas) — pas un mécanisme dynamique unique,
// seulement 4 statuts concernés pour l'instant.
test('listerDossiersParIds joint une date d’entrée (MAX historique_statuts) par statut pour les 4 nouvelles cartes "Effectifs par statut"', () => {
  const sql = dossierRepository.listerDossiersParIds(bd, 1, [74, 89]).toString();
  for (const statutCode of ['test_realise', 'valide_pret_embauche', 'formation_non_validee', 'embauche']) {
    assert.match(sql, new RegExp(`"statuts_${statutCode}"\\."code" = '${statutCode}'`));
    assert.match(sql, new RegExp(`MAX\\(historique_statuts\\.date_changement\\) as date_entree_${statutCode}`));
    assert.match(sql, new RegExp(`"dates_${statutCode}"\\."date_entree_${statutCode}"`));
  }
});

// Colonne "Dates clés" pour une sélection "Répartition par poste" (audit 2026-09-02, décision
// utilisateur) — un poste n'a pas d'ancre dans construireColonnesAlignees (TableauDossiersSelectionnes.jsx),
// repli sur la date d'ENTRÉE dans le statut COURANT du dossier. GÉNÉRIQUE (corrélée à
// dossiers.statut_id, pas un code en dur comme joindreDateEntreeStatut) : verrouille le LEFT JOIN
// LATERAL corrélé plutôt qu'une jointure statique par statut.
test('listerDossiersParIds joint la date d’entrée dans le statut COURANT du dossier via un LEFT JOIN LATERAL corrélé à dossiers.statut_id', () => {
  const sql = dossierRepository.listerDossiersParIds(bd, 1, [74, 89]).toString();
  assert.match(sql, /LEFT JOIN LATERAL/);
  assert.match(sql, /hs\.dossier_id = dossiers\.id/);
  assert.match(sql, /hs\.statut_id = dossiers\.statut_id/);
  assert.match(sql, /MAX\(hs\.date_changement\) AS date_entree_statut_courant/);
  assert.match(sql, /"entree_statut_courant"\."date_entree_statut_courant"/);
});

// Colonne "Dates clés" pour "Délai moyen Test → Formation" (correctif 2026-09-02, audit dashboard
// dossier #69) — l'ancienne version ancrait l'entrée sur MAX(historique_statuts.date_changement)
// parmi TOUTES les occurrences de valide_envoi_formation, y compris une éventuelle boucle rouverte
// et encore ouverte (aucune sortie) : cas du dossier #69, reparti en formation 379 ms après la
// sortie de son premier cycle, dont "Dates clés" affichait alors NULL/NULL alors que le badge
// "Délai Test → Formation" restait affiché (statistiquesRepository.delaiFormation retrouve
// correctement le premier cycle, clos, en parcourant chaque entrée indépendamment). Corrigé en
// reprenant le même patron LATERAL imbriqué que delaiFormation (sortie = ligne immédiatement
// suivante, retenue seulement si valide_pret_embauche/formation_non_validee), puis en choisissant,
// PARMI les entrées ainsi CLOSES, la plus RÉCENTE (ORDER BY entree.date_changement DESC LIMIT 1) —
// entrée et sortie sont résolues ensemble dans le même LATERAL cycle_formation_clos.
test('listerDossiersParIds ancre "Dates clés" formation sur le DERNIER cycle CLOS (LATERAL imbriqué, trié par entrée DESC), pas sur la dernière occurrence de valide_envoi_formation même si elle est encore ouverte', () => {
  const sql = dossierRepository.listerDossiersParIds(bd, 1, [74, 89]).toString();
  assert.doesNotMatch(
    sql,
    /"statuts_valide_envoi_formation"/,
    'l’ancienne jointure MAX par statut (joindreDateEntreeStatut) pour valide_envoi_formation ne doit plus exister',
  );
  assert.match(sql, /statut_entree\.code = 'valide_envoi_formation'/);
  assert.match(sql, /sortie\.code IN \('valide_pret_embauche', 'formation_non_validee'\)/);
  assert.match(sql, /ORDER BY entree\.date_changement DESC\s*\n?\s*LIMIT 1\s*\n?\s*\) AS cycle_formation_clos ON true/);
  assert.match(sql, /"cycle_formation_clos"\."date_entree" as "date_entree_valide_envoi_formation"/);
  assert.match(sql, /"cycle_formation_clos"\."date_sortie" as "date_sortie_formation"/);
});

test('listerDossiersParIds retourne un tableau vide sans construire de requête pour une liste de dossiers vide (comportement inchangé)', async () => {
  const resultat = await dossierRepository.listerDossiersParIds(bd, 1, []);
  assert.deepEqual(resultat, []);
});

// Infobulle "Test planifié" (audit 2026-09-14, colonne "Statut", TableauDeBordAccueil.jsx) — LEFT
// JOIN LATERAL (pas un simple LEFT JOIN) : garantit au plus une ligne par dossier même si un
// dossier porte plusieurs rendez-vous 'prevu'/'confirme' à la fois (aucune transition ne referme
// automatiquement l'ancien lors d'une replanification — même choix que
// rendezvousRepository.trouverRendezvousTestActifDossier, dupliqué ici). type_rdv='test' explicite :
// n'importe quel autre type de rendez-vous (ex. invitation signature de contrat) ne doit jamais
// alimenter cette infobulle.
test("listerDossiers joint le rendez-vous de test ACTIF le plus récent du dossier (LEFT JOIN LATERAL, ORDER BY date_heure DESC LIMIT 1)", () => {
  const sql = dossierRepository.listerDossiers(bd, 1, {}).toString();
  assert.match(sql, /LEFT JOIN LATERAL/);
  assert.match(sql, /r\.dossier_id = dossiers\.id/);
  assert.match(sql, /r\.type_rdv = 'test'/);
  assert.match(sql, /r\.statut IN \('prevu', 'confirme'\)/);
  assert.match(sql, /ORDER BY r\.date_heure DESC\s*\n?\s*LIMIT 1\s*\n?\s*\) AS rendezvous_actif ON true/);
  assert.match(sql, /"rendezvous_actif"\."date_heure" as "rendezvous_test_date_heure"/);
  assert.match(sql, /"formateur_actif"\."prenom" as "rendezvous_test_formateur_prenom"/);
  assert.match(sql, /"formateur_actif"\."nom" as "rendezvous_test_formateur_nom"/);
});

// Suivi de formation (audit 2026-08-28, point 1 : dossiers déjà traités restent visibles) — la
// sous-requête historique_statuts reste fixée sur 'valide_envoi_formation' (définit le PÉRIMÈTRE
// de la page), tandis que le filtre sur le statut COURANT porte sur les 3 issues possibles, pas
// seulement 'valide_envoi_formation'.
test('listerSuiviFormation filtre historique_statuts sur valide_envoi_formation (périmètre) et le statut courant sur les 3 issues possibles', () => {
  const sql = dossierRepository.listerSuiviFormation(bd, 1).toString();
  assert.match(sql, /"statuts_formation"\."code" = 'valide_envoi_formation'/);
  assert.match(
    sql,
    /"statuts"\."code" in \('valide_envoi_formation', 'valide_pret_embauche', 'formation_non_validee'\)/,
  );
  assert.match(sql, /MAX\(historique_statuts\.date_changement\) as date_entree_statut/);
  assert.match(sql, /"dossiers"\."entite_id" = 1/);
  assert.match(sql, /dates_entree_formation"\."dossier_id" is not null/);
});

// Point 2 : le formateur affiché doit venir de la DERNIÈRE évaluation soumise (evaluations,
// triée par date_evaluation), jamais d'un simple "rendez-vous le plus récent" qui pourrait ne
// jamais avoir été évalué (replanifié/annulé après coup).
test('listerSuiviFormation résout le formateur via une LATERAL JOIN sur evaluations triée par date_evaluation DESC LIMIT 1, jamais rendezvous.formateur_id', () => {
  const sql = dossierRepository.listerSuiviFormation(bd, 1).toString();
  assert.match(sql, /LEFT JOIN LATERAL[\s\S]*FROM evaluations e[\s\S]*ORDER BY e\.date_evaluation DESC[\s\S]*LIMIT 1/);
  assert.doesNotMatch(sql, /rendezvous/);
});

// Onglet "Formation" (audit 2026-08-28) — scopé au dossier ET à l'entité (garde IDOR), filtré sur
// les 3 statuts formation, trié du plus ANCIEN au plus récent (c'est dossierService qui inverse
// pour l'affichage, voir construireHistoriqueFormation) — l'inverse de listerSuiviFormation
// ci-dessus (desc), nécessaire ici pour que l'algorithme d'association envoi/résultat parcoure
// l'historique dans l'ordre chronologique réel.
test("listerHistoriqueFormation scope par dossier ET entité, filtre les 3 statuts formation, trie par date_changement ASC", () => {
  const sql = dossierRepository.listerHistoriqueFormation(bd, 1, 42).toString();
  assert.match(sql, /"dossiers"\."id" = 42/);
  assert.match(sql, /"dossiers"\."entite_id" = 1/);
  assert.match(
    sql,
    /"statuts"\."code" in \('valide_envoi_formation', 'valide_pret_embauche', 'formation_non_validee'\)/,
  );
  assert.match(sql, /order by "historique_statuts"\."date_changement" asc/);
});

// Badge "Statut forcé manuellement" (audit 2026-09-22, dossiers #16/#54, étendu à Validation.jsx
// section "Changement de statut manuel/forcé") — même fragment SQL que
// rendezvousRepository.listerRendezvousTest (voir son test dédié pour le détail du raisonnement) :
// LATERAL (pas un simple LEFT JOIN) pour garantir AU PLUS UNE ligne, jamais 'dossier_marque_embauche'.
test("trouverDossierAvecStatutParId joint le DERNIER événement journal_audit ('historique_statuts') du dossier via LATERAL, pas un simple LEFT JOIN", () => {
  const sql = dossierRepository.trouverDossierAvecStatutParId(bd, 1, 42).toString();

  assert.match(sql, /LEFT JOIN LATERAL/);
  assert.match(sql, /table_cible = 'historique_statuts'/);
  assert.match(sql, /ORDER BY ja\.date_action DESC/);
  assert.match(sql, /LIMIT 1/);
  assert.match(sql, /dernier_changement_statut\.action = 'changement_statut_force'/);
  assert.doesNotMatch(sql, /dossier_marque_embauche/);
});
