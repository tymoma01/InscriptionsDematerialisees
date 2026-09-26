const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const dossierRepository = require('../dossier/dossierRepository');
const rendezvousRepository = require('../rendezvous/rendezvousRepository');
const motifRepository = require('../motifs/motifRepository');
const workflowRepository = require('./workflowRepository');
const journalAudit = require('../audit/journalAudit');
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

test('forcerStatut rejette un rôle autre qu’Admin/Planning', async (t) => {
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
    /Seuls les rôles Admin et Planning peuvent forcer/,
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
  const neutraliserMock = t.mock.method(rendezvousRepository, 'neutraliserRendezvousActifsDossier', async () => [
    { id: 999, statutAvant: 'prevu', statutApres: 'remplace' },
  ]);
  t.mock.method(journalAudit, 'enregistrerAction', async () => {});
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

// Traçabilité (audit 2026-09-26) : jusqu'ici, cette neutralisation générique n'écrivait AUCUNE
// entrée journal_audit (contrairement au chemin forcerStatut, tracé côté route) — voir le
// commentaire d'en-tête de ce bloc dans workflowEngine.js.
test("appliquerTransition écrit une entrée journal_audit 'rendezvous_neutralise_transition' PAR rendez-vous neutralisé, dans la même transaction", async (t) => {
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
  t.mock.method(rendezvousRepository, 'neutraliserRendezvousActifsDossier', async () => [
    { id: 160, statutAvant: 'prevu', statutApres: 'remplace' },
    { id: 161, statutAvant: 'confirme', statutApres: 'remplace' },
  ]);
  const enregistrerActionMock = t.mock.method(journalAudit, 'enregistrerAction', async () => {});

  const trxFactice = { estUneTrxExistante: true };
  await workflowEngine.appliquerTransition(
    ENTITE_ACCECIT,
    { dossierId: 127, codeAction: 'invalider_test', commentaire: 'Test échoué.', utilisateurId: 9, roleCode: 'admin' },
    trxFactice,
  );

  assert.equal(enregistrerActionMock.mock.calls.length, 2);
  const [bdAppel, donneesAppel] = enregistrerActionMock.mock.calls[0].arguments;
  assert.equal(bdAppel, trxFactice, 'doit écrire dans la même transaction que le changement de statut');
  assert.equal(donneesAppel.utilisateurId, 9);
  assert.equal(donneesAppel.entiteId, ENTITE_ACCECIT.id);
  assert.equal(donneesAppel.action, 'rendezvous_neutralise_transition');
  assert.equal(donneesAppel.tableCible, 'rendezvous');
  assert.equal(donneesAppel.cibleId, 160);
  assert.deepEqual(donneesAppel.donnees, { dossierId: 127, codeAction: 'invalider_test', statutAvant: 'prevu', statutApres: 'remplace' });

  const deuxiemeAppel = enregistrerActionMock.mock.calls[1].arguments[1];
  assert.equal(deuxiemeAppel.cibleId, 161);
  assert.deepEqual(deuxiemeAppel.donnees, { dossierId: 127, codeAction: 'invalider_test', statutAvant: 'confirme', statutApres: 'remplace' });
});

test("appliquerTransition n'écrit AUCUNE entrée journal_audit si aucun rendez-vous n'est neutralisé", async (t) => {
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
  t.mock.method(rendezvousRepository, 'neutraliserRendezvousActifsDossier', async () => []);
  const enregistrerActionMock = t.mock.method(journalAudit, 'enregistrerAction', async () => {});

  await workflowEngine.appliquerTransition(
    ENTITE_ACCECIT,
    { dossierId: 127, codeAction: 'invalider_test', commentaire: 'Test échoué.', utilisateurId: 9, roleCode: 'admin' },
    { estUneTrxExistante: true },
  );

  assert.equal(enregistrerActionMock.mock.calls.length, 0);
});

test("appliquerTransition n'écrit aucune entrée journal_audit quand le statut destination ne neutralise pas les rendez-vous actifs (neutralise_rendezvous_actifs=false)", async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'trouverDossierParId', async () => ({ id: 127, statut_id: 11 }));
  t.mock.method(workflowRepository, 'trouverTransition', async () => ({
    id: 1,
    statut_destination_id: 15,
    statut_destination_neutralise_rendezvous_actifs: false,
    motif_requis: false,
  }));
  t.mock.method(workflowRepository, 'transitionAutoriseePourRole', async () => true);
  t.mock.method(dossierRepository, 'enregistrerChangementStatut', async () => {});
  const neutraliserMock = t.mock.method(rendezvousRepository, 'neutraliserRendezvousActifsDossier', async () => {
    throw new Error('ne doit pas être appelé (neutralise_rendezvous_actifs=false)');
  });
  const enregistrerActionMock = t.mock.method(journalAudit, 'enregistrerAction', async () => {});

  await workflowEngine.appliquerTransition(
    ENTITE_ACCECIT,
    { dossierId: 127, codeAction: 'confirmer_test_realise', commentaire: 'Test réalisé.', utilisateurId: 9, roleCode: 'formateur' },
    { estUneTrxExistante: true },
  );

  assert.equal(neutraliserMock.mock.calls.length, 0);
  assert.equal(enregistrerActionMock.mock.calls.length, 0);
});

// ═══ Bloc 3 (audit 2026-09-25) : rôle Planning + statuts exclus du forçage ═══

const ENTITE_ADAPTEL = { id: 2, code: 'adaptel' };

test("forcerStatut accepte le rôle Planning (ROLES_FORCAGE), même comportement qu'Admin", async (t) => {
  mockerKnex(t);
  mockerDependancesBase(t, { neutraliserRendezvousActifsDossier: async () => [] });

  await assert.doesNotReject(() =>
    workflowEngine.forcerStatut(ENTITE_ACCECIT, {
      dossierId: 127,
      statutCode: 'test_non_realise',
      commentaire: 'Test Planning.',
      utilisateurId: 9,
      roleCode: 'planning',
    }),
  );
});

// Non-régression explicite (bloc 3) : Accueil/Coordination seul (sans être Planning) reste refusé.
test('forcerStatut rejette toujours un compte Accueil/Coordination seul', async (t) => {
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
    /Seuls les rôles Admin et Planning peuvent forcer/,
  );
});

// Non-régression : Formateur/Inspecteur, jamais concernés, restent refusés.
test('forcerStatut rejette toujours Formateur et Inspecteur', async (t) => {
  mockerKnex(t);
  mockerDependancesBase(t);

  for (const roleCode of ['formateur', 'inspecteur']) {
    await assert.rejects(
      () =>
        workflowEngine.forcerStatut(ENTITE_ACCECIT, {
          dossierId: 127,
          statutCode: 'test_non_realise',
          commentaire: 'Test.',
          utilisateurId: 5,
          roleCode,
        }),
      /Seuls les rôles Admin et Planning peuvent forcer/,
    );
  }
});

// Statuts exclus du forçage (STATUTS_EXCLUS_FORCAGE_TOUTES_ENTITES) — refusés pour TOUTE entité.
for (const statutExclu of [
  'en_attente_verification',
  'en_attente_verdict',
  'verdict_positif',
  'verdict_negatif',
  'en_attente_validation_recruteur',
]) {
  test(`forcerStatut refuse le statut exclu '${statutExclu}' (toutes entités)`, async (t) => {
    mockerKnex(t);
    const { neutraliserMock } = mockerDependancesBase(t, {
      trouverStatutParCode: async () => ({ id: 99, code: statutExclu, libelle: 'Peu importe' }),
    });

    await assert.rejects(
      () =>
        workflowEngine.forcerStatut(ENTITE_ACCECIT, {
          dossierId: 127,
          statutCode: statutExclu,
          commentaire: 'Test.',
          utilisateurId: 9,
          roleCode: 'admin',
        }),
      /Ce statut ne peut pas être choisi par forçage/,
    );
    assert.equal(neutraliserMock.mock.calls.length, 0);
  });
}

// 'valide'/'rejete' : exclus UNIQUEMENT pour ACCECIT.
for (const statutHeriteAccecit of ['valide', 'rejete']) {
  test(`forcerStatut refuse '${statutHeriteAccecit}' pour ACCECIT`, async (t) => {
    mockerKnex(t);
    mockerDependancesBase(t, {
      trouverStatutParCode: async () => ({ id: 99, code: statutHeriteAccecit, libelle: 'Peu importe' }),
    });

    await assert.rejects(
      () =>
        workflowEngine.forcerStatut(ENTITE_ACCECIT, {
          dossierId: 127,
          statutCode: statutHeriteAccecit,
          commentaire: 'Test.',
          utilisateurId: 9,
          roleCode: 'admin',
        }),
      /Ce statut ne peut pas être choisi par forçage/,
    );
  });
}

// ... mais restent disponibles pour Adaptel, où ce sont les statuts réels du workflow (dossier
// #46, voir l'audit).
test("forcerStatut accepte 'valide' pour Adaptel (statut réel de son workflow, pas hérité)", async (t) => {
  mockerKnex(t);
  const { neutraliserMock } = mockerDependancesBase(t, {
    trouverDossierAvecStatutParId: async () => ({ id: 46, statut_id: 3, statut_code: 'en_attente_pieces', statut_libelle: 'En attente de pièces' }),
    trouverStatutParCode: async () => ({ id: 99, code: 'valide', libelle: 'Validé' }),
    neutraliserRendezvousActifsDossier: async () => [],
  });

  await assert.doesNotReject(() =>
    workflowEngine.forcerStatut(ENTITE_ADAPTEL, {
      dossierId: 46,
      statutCode: 'valide',
      commentaire: 'Correction manuelle Adaptel.',
      utilisateurId: 9,
      roleCode: 'admin',
    }),
  );
  assert.equal(neutraliserMock.mock.calls.length, 1);
});

// ═══ Bloc 3 suite (audit 2026-09-25) : date d'embauche lors d'un forçage vers "embauche" ═══

const STATUT_EMBAUCHE = { id: 44, code: 'embauche', libelle: 'Embauché', neutralise_rendezvous_actifs: true };

test("forcerStatut refuse un forçage vers 'embauche' sans dateEmbauche", async (t) => {
  mockerKnex(t);
  const { neutraliserMock } = mockerDependancesBase(t, { trouverStatutParCode: async () => STATUT_EMBAUCHE });
  const mettreAJourDateEmbaucheMock = t.mock.method(dossierRepository, 'mettreAJourDateEmbauche', async () => {});

  await assert.rejects(
    () =>
      workflowEngine.forcerStatut(ENTITE_ACCECIT, {
        dossierId: 127,
        statutCode: 'embauche',
        commentaire: 'Test.',
        utilisateurId: 9,
        roleCode: 'admin',
      }),
    /Une date d’embauche valide \(AAAA-MM-JJ\) est obligatoire pour forcer le statut "embauche"/,
  );
  assert.equal(neutraliserMock.mock.calls.length, 0);
  assert.equal(mettreAJourDateEmbaucheMock.mock.calls.length, 0);
});

// Même regex qu'embaucheService/marquerEmbaucheBodySchema — une date malformée doit être refusée
// au même titre qu'absente (le Zod du body l'accepte comme `string` optionnelle, quel que soit son
// contenu si non fourni via le schéma réel ; ce test couvre uniquement la revalidation interne à
// forcerStatut, indépendante de Zod).
test("forcerStatut refuse un forçage vers 'embauche' avec une dateEmbauche malformée", async (t) => {
  mockerKnex(t);
  mockerDependancesBase(t, { trouverStatutParCode: async () => STATUT_EMBAUCHE });

  await assert.rejects(
    () =>
      workflowEngine.forcerStatut(ENTITE_ACCECIT, {
        dossierId: 127,
        statutCode: 'embauche',
        commentaire: 'Test.',
        dateEmbauche: '25/12/2026',
        utilisateurId: 9,
        roleCode: 'admin',
      }),
    /Une date d’embauche valide \(AAAA-MM-JJ\) est obligatoire/,
  );
});

test("forcerStatut enregistre dateEmbauche sur dossiers.date_embauche (même fonction que le parcours normal), dans la MÊME transaction que le changement de statut", async (t) => {
  mockerKnex(t);
  const { enregistrerChangementStatutMock, neutraliserMock } = mockerDependancesBase(t, {
    trouverStatutParCode: async () => STATUT_EMBAUCHE,
    neutraliserRendezvousActifsDossier: async () => [],
  });
  const mettreAJourDateEmbaucheMock = t.mock.method(dossierRepository, 'mettreAJourDateEmbauche', async () => {});

  const resultat = await workflowEngine.forcerStatut(ENTITE_ACCECIT, {
    dossierId: 127,
    statutCode: 'embauche',
    commentaire: 'Correction manuelle.',
    dateEmbauche: '2026-10-01',
    utilisateurId: 9,
    roleCode: 'admin',
  });

  assert.equal(resultat.statutApresCode, 'embauche');
  assert.equal(mettreAJourDateEmbaucheMock.mock.calls.length, 1);
  const appelDateEmbauche = mettreAJourDateEmbaucheMock.mock.calls[0].arguments;
  assert.equal(appelDateEmbauche[0], TRX_FACTICE, 'mettreAJourDateEmbauche doit recevoir la même transaction que enregistrerChangementStatut/neutraliserRendezvousActifsDossier');
  assert.deepEqual(appelDateEmbauche[1], { dossierId: 127, dateEmbauche: '2026-10-01' });

  // Ordre : le changement de statut est déjà enregistré avant l'écriture de la date (même patron
  // que embaucheService.marquerEmbauche — transition puis date), toujours dans la même transaction.
  assert.equal(enregistrerChangementStatutMock.mock.calls.length, 1);
  assert.equal(enregistrerChangementStatutMock.mock.calls[0].arguments[0], TRX_FACTICE);
  assert.equal(neutraliserMock.mock.calls[0].arguments[0], TRX_FACTICE);
});

test("forcerStatut n'exige ni n'écrit dateEmbauche pour un forçage vers un autre statut qu'embauche", async (t) => {
  mockerKnex(t);
  mockerDependancesBase(t, { neutraliserRendezvousActifsDossier: async () => [] });
  const mettreAJourDateEmbaucheMock = t.mock.method(dossierRepository, 'mettreAJourDateEmbauche', async () => {
    throw new Error('ne doit pas être appelé pour un statut autre que "embauche"');
  });

  await assert.doesNotReject(() =>
    workflowEngine.forcerStatut(ENTITE_ACCECIT, {
      dossierId: 127,
      statutCode: 'test_non_realise',
      commentaire: 'Correction manuelle.',
      utilisateurId: 9,
      roleCode: 'admin',
      // dateEmbauche volontairement absent : ne doit jamais être exigé hors du statut "embauche".
    }),
  );
  assert.equal(mettreAJourDateEmbaucheMock.mock.calls.length, 0);
});
