const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const dossierRepository = require('../dossier/dossierRepository');
const rendezvousRepository = require('../rendezvous/rendezvousRepository');
const motifRepository = require('../motifs/motifRepository');
const workflowRepository = require('./workflowRepository');
const workflowEngine = require('./workflowEngine');

const ENTITE_ACCECIT = { id: 1, code: 'accecit' };

const DOSSIER_TEST_PLANIFIE = { id: 127, statut_id: 11, statut_code: 'test_planifie', statut_libelle: 'Test planifié' };
const STATUT_TEST_NON_REALISE = { id: 15, code: 'test_non_realise', libelle: 'Test non réalisé', neutralise_rendezvous_actifs: false };

// Motif 'neutralise_par_forcage' (bloc 2, audit 2026-09-23, categorie 'systeme' — voir
// scripts/seedMotifNeutraliseParForcage.js) : résolu par forcerStatut AVANT toute écriture.
const MOTIF_NEUTRALISE_PAR_FORCAGE = { id: 501, code: 'neutralise_par_forcage', categorie: 'systeme' };

const TRX_FACTICE = { estUnTrx: true };

// Même patron que evaluationEngine.test.js (mockerKnex) : bd.transaction appelle directement le
// callback avec un trx factice, suffisant au niveau unitaire — dossierRepository/rendezvousRepository
// sont mockées directement, jamais de vraie requête SQL ici.
function mockerKnex(t) {
  t.mock.method(db, 'obtenirKnex', async () => ({ transaction: async (callback) => callback(TRX_FACTICE) }));
}

function mockerDependancesBase(t, overrides = {}) {
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', overrides.trouverDossierAvecStatutParId ?? (async () => DOSSIER_TEST_PLANIFIE));
  t.mock.method(dossierRepository, 'trouverStatutParCode', overrides.trouverStatutParCode ?? (async () => STATUT_TEST_NON_REALISE));
  const enregistrerChangementStatutMock = t.mock.method(dossierRepository, 'enregistrerChangementStatut', async () => {});
  const trouverMotifParCodeMock = t.mock.method(
    motifRepository,
    'trouverMotifParCode',
    overrides.trouverMotifParCode ?? (async () => MOTIF_NEUTRALISE_PAR_FORCAGE),
  );
  const neutraliserMock = t.mock.method(
    rendezvousRepository,
    'neutraliserRendezvousActifsDossier',
    overrides.neutraliserRendezvousActifsDossier ?? (async () => []),
  );
  return { enregistrerChangementStatutMock, trouverMotifParCodeMock, neutraliserMock };
}

// Régression dossier #127 (audit 2026-09-09) : un changement de statut forcé vers un statut dont
// neutralise_rendezvous_actifs=false (test_non_realise pour ACCECIT) laissait jusqu'ici le
// rendez-vous actif intact ("prevu"), désynchronisé du nouveau statut du dossier — voir le
// commentaire d'en-tête de forcerStatut, workflowEngine.js.
test('forcerStatut neutralise TOUJOURS le(s) rendez-vous actif(s), même quand neutralise_rendezvous_actifs=false sur le statut cible', async (t) => {
  mockerKnex(t);
  const rendezvousRetourne = { id: 160, statutAvant: 'prevu', outlookEventId: null, formateurId: null };
  const { neutraliserMock } = mockerDependancesBase(t, {
    neutraliserRendezvousActifsDossier: async () => [rendezvousRetourne],
  });

  const resultat = await workflowEngine.forcerStatut(ENTITE_ACCECIT, {
    dossierId: 127,
    statutCode: 'test_non_realise',
    commentaire: 'Essaye forcing changement de statut dossier',
    utilisateurId: 9,
    roleCode: 'admin',
  });

  assert.equal(neutraliserMock.mock.calls.length, 1);
  const appel = neutraliserMock.mock.calls[0].arguments[1];
  assert.equal(appel.dossierId, 127);
  // Bloc 2 (audit 2026-09-23) : 'annule' + motifId, jamais 'remplace' — réservé à une VRAIE
  // replanification (appliquerTransition, voir le test dédié plus bas).
  assert.equal(appel.statutRemplace, 'annule');
  assert.equal(appel.motifId, MOTIF_NEUTRALISE_PAR_FORCAGE.id);
  assert.deepEqual(resultat.rendezvousNeutralises, [rendezvousRetourne]);
  assert.equal(resultat.statutApresCode, 'test_non_realise');
  assert.equal(resultat.motifNeutralisationCode, 'neutralise_par_forcage');
});

// Bloc 2 (audit 2026-09-23, B9) : le motif est résolu en categorie 'systeme', jamais 'desistement'
// (sinon il apparaîtrait dans listerMotifsDesistement(), le menu agent "Marquer annulé"/NSPP — voir
// scripts/seedMotifNeutraliseParForcage.js).
test("forcerStatut résout le motif 'neutralise_par_forcage' en categorie 'systeme'", async (t) => {
  mockerKnex(t);
  const { trouverMotifParCodeMock } = mockerDependancesBase(t, {
    neutraliserRendezvousActifsDossier: async () => [],
  });

  await workflowEngine.forcerStatut(ENTITE_ACCECIT, {
    dossierId: 127,
    statutCode: 'test_non_realise',
    commentaire: 'Test.',
    utilisateurId: 9,
    roleCode: 'admin',
  });

  assert.equal(trouverMotifParCodeMock.mock.calls.length, 1);
  const appel = trouverMotifParCodeMock.mock.calls[0].arguments;
  assert.equal(appel[1], ENTITE_ACCECIT.id);
  assert.equal(appel[2], 'systeme');
  assert.equal(appel[3], 'neutralise_par_forcage');
});

// Bloc 2 (audit 2026-09-23, B3/B9) : fail fast, AUCUNE écriture si l'entité n'a pas encore ce motif
// seedé — jamais un dossier déplacé avec des rendez-vous neutralisés sans motif exploitable.
test("forcerStatut lève une erreur explicite et n'écrit rien si le motif 'neutralise_par_forcage' est absent pour l'entité", async (t) => {
  mockerKnex(t);
  const { enregistrerChangementStatutMock, neutraliserMock } = mockerDependancesBase(t, {
    trouverMotifParCode: async () => undefined,
  });

  await assert.rejects(
    () =>
      workflowEngine.forcerStatut(ENTITE_ACCECIT, {
        dossierId: 127,
        statutCode: 'test_non_realise',
        commentaire: 'Test.',
        utilisateurId: 9,
        roleCode: 'admin',
      }),
    /Motif neutralise_par_forcage absent pour cette entité/,
  );

  assert.equal(enregistrerChangementStatutMock.mock.calls.length, 0);
  assert.equal(neutraliserMock.mock.calls.length, 0);
});

test("forcerStatut renvoie rendezvousNeutralises vide si le dossier n'a aucun rendez-vous actif", async (t) => {
  mockerKnex(t);
  mockerDependancesBase(t, { neutraliserRendezvousActifsDossier: async () => [] });

  const resultat = await workflowEngine.forcerStatut(ENTITE_ACCECIT, {
    dossierId: 127,
    statutCode: 'test_non_realise',
    commentaire: 'Correction manuelle.',
    utilisateurId: 9,
    roleCode: 'admin',
  });

  assert.deepEqual(resultat.rendezvousNeutralises, []);
});

test('forcerStatut neutralise aussi vers un statut où neutralise_rendezvous_actifs=true (comportement inchangé, toujours vrai désormais)', async (t) => {
  mockerKnex(t);
  const { neutraliserMock } = mockerDependancesBase(t, {
    trouverStatutParCode: async () => ({ id: 17, code: 'invalide', libelle: 'Invalidé', neutralise_rendezvous_actifs: true }),
    neutraliserRendezvousActifsDossier: async () => [{ id: 200 }],
  });

  await workflowEngine.forcerStatut(ENTITE_ACCECIT, {
    dossierId: 127,
    statutCode: 'invalide',
    commentaire: 'Décision admin.',
    utilisateurId: 9,
    roleCode: 'admin',
  });

  assert.equal(neutraliserMock.mock.calls.length, 1);
});

test('forcerStatut rejette un rôle autre qu’Admin', async (t) => {
  mockerKnex(t);
  mockerDependancesBase(t);

  await assert.rejects(
    () =>
      workflowEngine.forcerStatut(ENTITE_ACCECIT, {
        dossierId: 127,
        statutCode: 'test_non_realise',
        commentaire: 'Test.',
        utilisateurId: 5,
        roleCode: 'accueil_coordination',
      }),
    /Seul le rôle Admin peut forcer/,
  );
});

test('forcerStatut rejette un commentaire vide', async (t) => {
  mockerKnex(t);
  mockerDependancesBase(t);

  await assert.rejects(
    () =>
      workflowEngine.forcerStatut(ENTITE_ACCECIT, {
        dossierId: 127,
        statutCode: 'test_non_realise',
        commentaire: '   ',
        utilisateurId: 9,
        roleCode: 'admin',
      }),
    /commentaire est obligatoire/,
  );
});

test('forcerStatut rejette un saut vers le statut déjà courant du dossier', async (t) => {
  mockerKnex(t);
  mockerDependancesBase(t, {
    trouverStatutParCode: async () => ({ id: 11, code: 'test_planifie', libelle: 'Test planifié', neutralise_rendezvous_actifs: false }),
  });

  await assert.rejects(
    () =>
      workflowEngine.forcerStatut(ENTITE_ACCECIT, {
        dossierId: 127,
        statutCode: 'test_planifie',
        commentaire: 'Test.',
        utilisateurId: 9,
        roleCode: 'admin',
      }),
    /est déjà au statut/,
  );
});

// appliquerTransition — régression (bloc 2, audit 2026-09-23, B9) : NE modifie PAS
// appliquerTransition, une VRAIE replanification (transition normale, statut destination
// neutralise_rendezvous_actifs=true) doit continuer de poser 'remplace', jamais 'annule', et sans
// motifId — seul forcerStatut ci-dessus change de comportement.
test("appliquerTransition neutralise toujours en 'remplace' (jamais 'annule', jamais de motifId) quand le statut destination neutralise_rendezvous_actifs", async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'trouverDossierParId', async () => ({ id: 127, statut_id: 11 }));
  t.mock.method(workflowRepository, 'trouverTransition', async () => ({
    id: 1,
    statut_destination_id: 17,
    statut_destination_neutralise_rendezvous_actifs: true,
    motif_requis: false,
  }));
  t.mock.method(workflowRepository, 'transitionAutoriseePourRole', async () => true);
  t.mock.method(dossierRepository, 'enregistrerChangementStatut', async () => {});
  const neutraliserMock = t.mock.method(rendezvousRepository, 'neutraliserRendezvousActifsDossier', async () => [{ id: 999 }]);
  // motifRepository.trouverMotifParCode : jamais appelé ici (motif_requis=false), mais mocké quand
  // même pour éviter tout risque d'appel réel non intentionnel sur un `bd` factice.
  t.mock.method(motifRepository, 'trouverMotifParCode', async () => {
    throw new Error('ne doit pas être appelé (motif_requis=false)');
  });

  await workflowEngine.appliquerTransition(
    ENTITE_ACCECIT,
    { dossierId: 127, codeAction: 'invalider_test', commentaire: 'Test échoué.', utilisateurId: 9, roleCode: 'admin' },
    { estUneTrxExistante: true },
  );

  assert.equal(neutraliserMock.mock.calls.length, 1);
  const appel = neutraliserMock.mock.calls[0].arguments[1];
  assert.equal(appel.dossierId, 127);
  assert.equal(appel.statutRemplace, 'remplace');
  assert.equal('motifId' in appel, false, 'appliquerTransition ne doit jamais passer motifId à neutraliserRendezvousActifsDossier');
});
