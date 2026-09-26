const test = require('node:test');
const assert = require('node:assert/strict');
const knex = require('knex');

const rendezvousRepository = require('./rendezvousRepository');

// `bd` : instance knex RÉELLE mais JAMAIS connectée — `client: 'pg'` suffit à générer du SQL
// valide et à le récupérer via `.toString()`, sans dépendre d'une connexion Neon réelle. Même
// principe que dossierRepository.test.js/statistiquesRepository.test.js.
const bd = knex({ client: 'pg' });

// Délai de grâce de 24h avant bascule automatique "Test non réalisé" (audit 2026-09-09) — la
// requête doit comparer la FIN du créneau (date_heure + dureeCreneauMinutes), pas date_heure seule,
// à (maintenant - delaiGraceHeures). Vérifié sur le SQL généré plutôt qu'en exécutant contre une
// vraie base : cette requête n'a pas de dépendance métier testable autrement qu'en lisant le SQL
// (make_interval), même patron que dossierRepository.test.js.
test('listerRendezvousTestNonRealisesAutomatiquement compare la FIN du créneau (date_heure + durée) à (now() - délai de grâce), pas date_heure seule', () => {
  const sql = rendezvousRepository
    .listerRendezvousTestNonRealisesAutomatiquement(bd, 1, { dureeCreneauMinutes: 30, delaiGraceHeures: 24 })
    .toString();

  assert.match(
    sql,
    /rendezvous\.date_heure \+ make_interval\(mins => 30\) < now\(\) - make_interval\(hours => 24\)/,
  );
  // Régression : ne doit plus jamais comparer `date_heure` seule à `now()` (comportement d'avant
  // ce correctif, bascule dès le créneau passé sans aucun délai de grâce).
  assert.doesNotMatch(sql, /"rendezvous"\."date_heure" < now\(\)/);
});

test("listerRendezvousTestNonRealisesAutomatiquement exclut tout rendez-vous dont la présence a été confirmée (bouton Présent(e), date_presence_confirmee non NULL)", () => {
  const sql = rendezvousRepository
    .listerRendezvousTestNonRealisesAutomatiquement(bd, 1, { dureeCreneauMinutes: 30, delaiGraceHeures: 24 })
    .toString();

  assert.match(sql, /"rendezvous"\."date_presence_confirmee" is null/i);
});

// Audit 2026-09-13 (dossier #114) : rendezvous.statut = 'confirme' (présence annoncée à l'avance
// PAR LE CANDIDAT) ne doit plus, à lui seul, exclure un rendez-vous de la bascule automatique —
// seul date_presence_confirmee (présence réellement CONSTATÉE par un formateur/inspecteur, testé
// ci-dessus) le doit. Avant ce correctif, la clause `where({ 'rendezvous.statut': 'prevu', ... })`
// excluait TOUT rendez-vous 'confirme', quelle que soit date_presence_confirmee.
test("listerRendezvousTestNonRealisesAutomatiquement inclut 'prevu' ET 'confirme' (plus seulement 'prevu')", () => {
  const sql = rendezvousRepository
    .listerRendezvousTestNonRealisesAutomatiquement(bd, 1, { dureeCreneauMinutes: 30, delaiGraceHeures: 24 })
    .toString();

  assert.match(sql, /"rendezvous"\."statut" in \('prevu', 'confirme'\)/i);
  // Régression : ne doit plus jamais restreindre à 'prevu' seul (comportement d'avant ce correctif).
  assert.doesNotMatch(sql, /"rendezvous"\."statut" = 'prevu'/i);
});

// marquerPresenceConfirmee n'est pas testable en génération de SQL comme ci-dessus : sa dernière
// étape (.then(([rendezvous]) => rendezvous), même patron que mettreAJourStatutRendezvous) en fait
// une vraie Promise dès son retour, pas un query builder dont .toString() reflète le SQL — cette
// fonction est couverte par un test bout-en-bout (vérification manuelle documentée dans le rapport
// de la tâche, pas de connexion DB disponible dans cette suite unitaire).

// listerRendezvousTest — badge "Statut forcé manuellement" (audit 2026-09-22, dossiers #16/#54).
// Vérifie la forme du SQL généré (LATERAL, pas un simple LEFT JOIN, pour garantir AU PLUS UNE
// ligne par dossier même si un dossier accumulait plusieurs événements le même jour) plutôt que
// d'exécuter contre une vraie base, même patron que les tests ci-dessus.
test("listerRendezvousTest joint le DERNIER événement journal_audit ('historique_statuts') du dossier via LATERAL, pas un simple LEFT JOIN", () => {
  const sql = rendezvousRepository.listerRendezvousTest(bd, 1, {}).toString();

  assert.match(sql, /LEFT JOIN LATERAL/);
  assert.match(sql, /table_cible = 'historique_statuts'/);
  assert.match(sql, /ORDER BY ja\.date_action DESC/);
  assert.match(sql, /LIMIT 1/);
});

test("listerRendezvousTest expose statut_force = (action = 'changement_statut_force'), pas 'dossier_marque_embauche' (transition normale, voir embaucheService)", () => {
  const sql = rendezvousRepository.listerRendezvousTest(bd, 1, {}).toString();

  assert.match(sql, /dernier_changement_statut\.action = 'changement_statut_force'/);
  assert.doesNotMatch(sql, /dossier_marque_embauche/);
});

// listerDossiersAnnulesNonSynchronises — correctif du 2026-09-23 (angle mort du rattrapage
// annulation test : un rendez-vous 'annule' ANCIEN faisait matcher le dossier même après une
// replanification légitime, voir le commentaire d'en-tête de la fonction). Vérifié en génération de
// SQL (JOIN LATERAL borné à un seul rendez-vous par dossier, le plus récent), même patron que
// listerRendezvousTest ci-dessus — pas d'exécution contre une vraie base dans cette suite.
test("listerDossiersAnnulesNonSynchronises ne retient, par dossier, QUE le DERNIER rendez-vous 'test' (ORDER BY id DESC LIMIT 1 dans la LATERAL), jamais le plus ancien", () => {
  const sql = rendezvousRepository.listerDossiersAnnulesNonSynchronises(bd, 1).toString();

  assert.match(sql, /JOIN LATERAL/);
  assert.match(sql, /r\.dossier_id = d\.id AND r\.type_rdv = 'test'/);
  assert.match(sql, /ORDER BY r\.id DESC/);
  assert.match(sql, /LIMIT 1/);
  // Régression : ne doit plus jamais regrouper par dossier avec min(id) (comportement d'avant ce
  // correctif, qui retenait le PLUS ANCIEN rendez-vous 'annule' plutôt que le plus récent).
  assert.doesNotMatch(sql, /min\(r\.id\)/i);
  assert.doesNotMatch(sql, /group by/i);
});

test("listerDossiersAnnulesNonSynchronises ne matche que si le DERNIER rendez-vous 'test' du dossier est 'annule' (pas seulement s'il EN EXISTE un quelque part dans l'historique)", () => {
  const sql = rendezvousRepository.listerDossiersAnnulesNonSynchronises(bd, 1).toString();

  assert.match(sql, /"dernier_rendezvous_test"\."statut" = 'annule'/);
  // La condition porte sur le rendez-vous résolu par la LATERAL (dernier_rendezvous_test), jamais
  // directement sur "rendezvous"."statut" — sinon n'importe quel rendez-vous 'annule', même ancien,
  // ferait à nouveau matcher le dossier.
  assert.doesNotMatch(sql, /"rendezvous"\."statut" = 'annule'/);
});

// existeRendezvousTestPlusRecent — garde en défense côté rendezvousService.
// resoudreTransitionAnnulationTest (voir son commentaire) : un simple id strictement supérieur,
// type_rdv='test', peu importe le statut de ce rendez-vous plus récent.
test("existeRendezvousTestPlusRecent compare sur id strictement supérieur (pas >=), sans filtrer par statut", () => {
  const sql = rendezvousRepository.existeRendezvousTestPlusRecent(bd, 90, 71).toString();

  assert.match(sql, /"dossier_id" = 90/);
  assert.match(sql, /"type_rdv" = 'test'/);
  assert.match(sql, /"id" > 71/);
  assert.doesNotMatch(sql, /"statut"/);
});

// existeRendezvousTestActif — correctif complémentaire du 2026-09-23 (dossier #129, voir le
// commentaire d'en-tête de la fonction) : condition INDÉPENDANTE de l'id, contrairement à
// existeRendezvousTestPlusRecent ci-dessus.
test("existeRendezvousTestActif filtre sur statut 'prevu'/'confirme', jamais sur l'id (contrairement à existeRendezvousTestPlusRecent)", () => {
  const sql = rendezvousRepository.existeRendezvousTestActif(bd, 129).toString();

  assert.match(sql, /"dossier_id" = 129/);
  assert.match(sql, /"type_rdv" = 'test'/);
  assert.match(sql, /"statut" in \('prevu', 'confirme'\)/i);
  assert.doesNotMatch(sql, /"id" >/);
});

// listerDossiersAnnulesNonSynchronises — correctif complémentaire du 2026-09-23 (dossier #129) :
// exclut désormais tout dossier portant AU MOINS un rendez-vous 'test' 'prevu'/'confirme', en plus
// de la condition LATERAL déjà en place (testée plus haut) — deux conditions indépendantes, l'une
// n'excuse pas l'autre.
test("listerDossiersAnnulesNonSynchronises exclut tout dossier portant un rendez-vous 'test' 'prevu'/'confirme', indépendamment de l'id du dernier rendez-vous retenu par la LATERAL", () => {
  const sql = rendezvousRepository.listerDossiersAnnulesNonSynchronises(bd, 1).toString();

  assert.match(sql, /not exists/i);
  assert.match(sql, /r2\.dossier_id = d\.id/);
  assert.match(sql, /"r2"\."type_rdv" = 'test'/);
  assert.match(sql, /"r2"\."statut" in \('prevu', 'confirme'\)/i);
});

// listerDossiersAnnulesNonSynchronises — double sécurité du bloc 2 (audit 2026-09-23) : exclut en
// plus tout dossier dont le dernier rendez-vous 'annule' porte le motif 'neutralise_par_forcage'
// (workflowEngine.forcerStatut), jamais une vraie annulation candidat.
test("listerDossiersAnnulesNonSynchronises exclut le dernier rendez-vous 'annule' si son motif est 'neutralise_par_forcage' (LEFT JOIN motifs, un rendez-vous sans motif reste inclus)", () => {
  const sql = rendezvousRepository.listerDossiersAnnulesNonSynchronises(bd, 1).toString();

  assert.match(sql, /left join "motifs" as "motif_dernier_rendezvous_test"/i);
  assert.match(sql, /"motif_dernier_rendezvous_test"\."id" = "dernier_rendezvous_test"\."motif_id"/);
  assert.match(sql, /not "motif_dernier_rendezvous_test"\."code" = 'neutralise_par_forcage'/);
  // Un rendez-vous sans motif (motif_id NULL, donc pas de ligne motifs à joindre) doit rester
  // matché : le OR whereNull ci-dessous, pas une exclusion par défaut faute de jointure.
  assert.match(sql, /or "motif_dernier_rendezvous_test"\."code" is null/i);
});

// listerRendezvousTest — bloc 2 (audit 2026-09-23, B8) : Planification.jsx a besoin du motif pour
// distinguer un rendez-vous annulé par un candidat d'un rendez-vous annulé par un forçage de
// statut Admin (même 'statut' brut en base : 'annule' dans les deux cas).
test('listerRendezvousTest joint motifs et expose motif_code', () => {
  const sql = rendezvousRepository.listerRendezvousTest(bd, 1, {}).toString();

  assert.match(sql, /left join "motifs" on "motifs"\."id" = "rendezvous"\."motif_id"/i);
  assert.match(sql, /"motifs"\."code" as "motif_code"/);
});

// neutraliserRendezvousActifsDossier — bloc 2 (audit 2026-09-23, B2/B9) : devenue une fonction
// async à deux requêtes (SELECT verrouillé puis UPDATE, voir son commentaire) — plus un simple
// query builder chaînable, donc plus testable en génération de SQL (.toString()) comme les
// fonctions ci-dessus. Testée en comportement contre un `bd` factice minimal, même principe que
// workflowEngine.test.js/rendezvousService.test.js (repositories mockées), mais ICI c'est cette
// fonction elle-même qui est sous test — le `bd` factice simule donc le query builder Knex
// directement plutôt que de mocker une couche au-dessus.
function creerBdFacticeNeutralisation(lignesSelectionnees) {
  const appelsUpdate = [];
  function bd(table) {
    assert.equal(table, 'rendezvous');
    let idsWhereIn = null;
    const builder = {
      where: () => builder,
      andWhere: () => builder,
      forUpdate: () => builder,
      whereIn: (colonne, valeurs) => {
        if (colonne === 'id') idsWhereIn = valeurs;
        return builder;
      },
      select: async () => lignesSelectionnees,
      update: async (donnees) => {
        appelsUpdate.push({ ids: idsWhereIn, donnees });
        return lignesSelectionnees.length;
      },
    };
    return builder;
  }
  bd.appelsUpdate = appelsUpdate;
  return bd;
}

test('neutraliserRendezvousActifsDossier sans motifId : comportement STRICTEMENT inchangé (seul `statut` écrit, jamais `motif_id`)', async () => {
  const lignes = [
    { id: 10, statut: 'prevu', outlook_event_id: 'evt-1', formateur_id: 5 },
    { id: 11, statut: 'confirme', outlook_event_id: null, formateur_id: null },
  ];
  const bdFactice = creerBdFacticeNeutralisation(lignes);

  const resultat = await rendezvousRepository.neutraliserRendezvousActifsDossier(bdFactice, {
    dossierId: 90,
    statutRemplace: 'remplace',
  });

  assert.deepEqual(resultat, [
    { id: 10, statutAvant: 'prevu', statutApres: 'remplace', outlookEventId: 'evt-1', formateurId: 5 },
    { id: 11, statutAvant: 'confirme', statutApres: 'remplace', outlookEventId: null, formateurId: null },
  ]);
  assert.equal(bdFactice.appelsUpdate.length, 1);
  assert.deepEqual(bdFactice.appelsUpdate[0].donnees, { statut: 'remplace' });
  assert.deepEqual(bdFactice.appelsUpdate[0].ids, [10, 11]);
});

test('neutraliserRendezvousActifsDossier avec motifId : `motif_id` écrit dans la MÊME requête UPDATE que `statut`', async () => {
  const lignes = [{ id: 20, statut: 'prevu', outlook_event_id: null, formateur_id: null }];
  const bdFactice = creerBdFacticeNeutralisation(lignes);

  await rendezvousRepository.neutraliserRendezvousActifsDossier(bdFactice, {
    dossierId: 90,
    statutRemplace: 'annule',
    motifId: 501,
  });

  assert.equal(bdFactice.appelsUpdate.length, 1);
  assert.deepEqual(bdFactice.appelsUpdate[0].donnees, { statut: 'annule', motif_id: 501 });
});

test('neutraliserRendezvousActifsDossier renvoie [] et ne fait AUCUNE écriture si aucun rendez-vous actif', async () => {
  const bdFactice = creerBdFacticeNeutralisation([]);

  const resultat = await rendezvousRepository.neutraliserRendezvousActifsDossier(bdFactice, {
    dossierId: 90,
    statutRemplace: 'remplace',
  });

  assert.deepEqual(resultat, []);
  assert.equal(bdFactice.appelsUpdate.length, 0);
});
