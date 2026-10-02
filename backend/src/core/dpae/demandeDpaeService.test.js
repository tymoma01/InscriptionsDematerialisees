const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const demandeDpaeRepository = require('./demandeDpaeRepository');
const notificationService = require('../notifications/notificationService');
const siteAffectationRepository = require('./siteAffectationRepository');
const demandeDpaeService = require('./demandeDpaeService');

const ENTITE_ACCECIT = { id: 1, code: 'accecit' };

function mockerKnex(t) {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
}

// Aucune notification stockée à l'envoi (simplification 2026-09-28, demande utilisateur) : tout
// RH voit "toutes les demandes en cours" directement via listerPourRh (consommé par
// NotificationsCloche.jsx côté front pour ce rôle) — rien à créer/synchroniser ici.
test('creerEtEnvoyer crée la demande et ne déclenche aucune notification', async (t) => {
  mockerKnexTransaction(t);
  t.mock.method(siteAffectationRepository, 'listerIdsSitesValides', async () => [10]);
  t.mock.method(siteAffectationRepository, 'lierSitesDemande', async () => {});
  t.mock.method(demandeDpaeRepository, 'creerDemande', async () => 7);
  const creerNotificationsMock = t.mock.method(notificationService, 'creerNotifications', async () => {});

  const demandeId = await demandeDpaeService.creerEtEnvoyer(ENTITE_ACCECIT, 5, {
    salarieNom: 'Martin',
    salariePrenom: 'Sophie',
    sitesAffectationIds: [10],
  });

  assert.equal(demandeId, 7);
  assert.equal(creerNotificationsMock.mock.calls.length, 0);
});

// ---------------------------------------------------------------------------------------------
// Sites d'affectation (référentiel, migration 069, 2026-09-29) — la demande et ses liens sont
// enregistrés dans UNE transaction, et un site invalide refuse toute la demande avant écriture.
// Base factice : `transaction(fn)` appelle fn avec TRX_FACTICE, pour vérifier que TOUTES les
// écritures passent bien par la transaction (jamais par la connexion hors transaction).
// ---------------------------------------------------------------------------------------------
const TRX_FACTICE = { estUneTransaction: true };

function mockerKnexTransaction(t) {
  const transactionMock = t.mock.fn(async (callback) => callback(TRX_FACTICE));
  t.mock.method(db, 'obtenirKnex', async () => ({ transaction: transactionMock }));
  return transactionMock;
}

function mockerSites(t, idsValidesEnBase) {
  const listerMock = t.mock.method(siteAffectationRepository, 'listerIdsSitesValides', async (_trx, _entiteId, ids) =>
    ids.filter((id) => idsValidesEnBase.includes(id)),
  );
  const lierMock = t.mock.method(siteAffectationRepository, 'lierSitesDemande', async () => {});
  const creerMock = t.mock.method(demandeDpaeRepository, 'creerDemande', async () => 7);
  return { listerMock, lierMock, creerMock };
}

const DONNEES_DEMANDE = { salarieNom: 'Martin', salariePrenom: 'Sophie' };

test("creerEtEnvoyer avec un site : demande créée et site lié, dans la transaction ; les ids ne sont pas transmis à l'insertion de la demande", async (t) => {
  const transactionMock = mockerKnexTransaction(t);
  const { listerMock, lierMock, creerMock } = mockerSites(t, [10, 11, 12]);

  const demandeId = await demandeDpaeService.creerEtEnvoyer(ENTITE_ACCECIT, 5, { ...DONNEES_DEMANDE, sitesAffectationIds: [10] });

  assert.equal(demandeId, 7);
  assert.equal(transactionMock.mock.calls.length, 1);
  assert.deepEqual(listerMock.mock.calls[0].arguments, [TRX_FACTICE, ENTITE_ACCECIT.id, [10]]);
  assert.equal(creerMock.mock.calls[0].arguments[0], TRX_FACTICE);
  assert.equal('sitesAffectationIds' in creerMock.mock.calls[0].arguments[1], false);
  assert.deepEqual(lierMock.mock.calls[0].arguments, [TRX_FACTICE, 7, [10]]);
});

test('creerEtEnvoyer avec plusieurs sites : tous les liens sont enregistrés', async (t) => {
  mockerKnexTransaction(t);
  const { lierMock } = mockerSites(t, [10, 11, 12]);

  await demandeDpaeService.creerEtEnvoyer(ENTITE_ACCECIT, 5, { ...DONNEES_DEMANDE, sitesAffectationIds: [12, 10, 11] });

  assert.equal(lierMock.mock.calls.length, 1);
  assert.deepEqual(lierMock.mock.calls[0].arguments, [TRX_FACTICE, 7, [12, 10, 11]]);
});

test("creerEtEnvoyer avec un site inexistant, inactif ou d'une autre entité : refus de TOUTE la demande, rien n'est écrit", async (t) => {
  mockerKnexTransaction(t);
  // 10 valide ; 99 absent de la liste des sites actifs de l'entité (inexistant, inactif ou d'une
  // autre entité : le repository ne renvoie que les ids existants, actifs ET de cette entité).
  const { lierMock, creerMock } = mockerSites(t, [10]);

  await assert.rejects(
    () => demandeDpaeService.creerEtEnvoyer(ENTITE_ACCECIT, 5, { ...DONNEES_DEMANDE, sitesAffectationIds: [10, 99] }),
    (erreur) =>
      erreur instanceof demandeDpaeService.ErreurSitesAffectationInvalides && /: 99\. La demande n'a pas été enregistrée\./.test(erreur.message),
  );
  assert.equal(creerMock.mock.calls.length, 0);
  assert.equal(lierMock.mock.calls.length, 0);
});

test("creerEtEnvoyer : si l'enregistrement des liens échoue, l'erreur remonte hors de la transaction (annulation, pas d'enregistrement partiel)", async (t) => {
  mockerKnexTransaction(t);
  mockerSites(t, [10]);
  t.mock.method(siteAffectationRepository, 'lierSitesDemande', async () => {
    throw new Error('violation de clé étrangère');
  });

  // La transaction knex annule tout ce qu'elle contient quand son callback rejette : on vérifie
  // ici que l'erreur n'est pas avalée, condition pour que knex effectue ce rollback.
  await assert.rejects(
    () => demandeDpaeService.creerEtEnvoyer(ENTITE_ACCECIT, 5, { ...DONNEES_DEMANDE, sitesAffectationIds: [10] }),
    /violation de clé étrangère/,
  );
});

test('obtenirDemande renvoie la demande avec ses sites d\'affectation', async (t) => {
  mockerKnex(t);
  t.mock.method(demandeDpaeRepository, 'trouverDemandeParId', async () => ({ id: 7, hotel: null }));
  t.mock.method(siteAffectationRepository, 'listerSitesDemande', async () => [{ id: 10, nom: 'AIGLON', initiales: 'AIG' }]);

  const demande = await demandeDpaeService.obtenirDemande(ENTITE_ACCECIT, 7);

  assert.deepEqual(demande.sites_affectation, [{ id: 10, nom: 'AIGLON', initiales: 'AIG' }]);
});

test('valider rejette une demande introuvable', async (t) => {
  mockerKnex(t);
  t.mock.method(demandeDpaeRepository, 'trouverDemandeParId', async () => undefined);

  await assert.rejects(
    () => demandeDpaeService.valider(ENTITE_ACCECIT, 999, 1),
    demandeDpaeService.ErreurDemandeIntrouvable,
  );
});

test('valider rejette une demande déjà traitée', async (t) => {
  mockerKnex(t);
  t.mock.method(demandeDpaeRepository, 'trouverDemandeParId', async () => ({ id: 7, statut: 'validee' }));

  await assert.rejects(
    () => demandeDpaeService.valider(ENTITE_ACCECIT, 7, 1),
    demandeDpaeService.ErreurDemandeDejaTraitee,
  );
});

test('valider marque la demande validée et notifie le demandeur', async (t) => {
  mockerKnex(t);
  t.mock.method(demandeDpaeRepository, 'trouverDemandeParId', async () => ({
    id: 7,
    statut: 'envoyee',
    demandeur_id: 3,
    salarie_nom: 'Martin',
    salarie_prenom: 'Sophie',
  }));
  const marquerTraiteeMock = t.mock.method(demandeDpaeRepository, 'marquerTraitee', async () => {});
  const creerNotificationsMock = t.mock.method(notificationService, 'creerNotifications', async () => {});

  await demandeDpaeService.valider(ENTITE_ACCECIT, 7, 42);

  assert.deepEqual(marquerTraiteeMock.mock.calls[0].arguments[2], { statut: 'validee', traitantId: 42 });
  assert.equal(creerNotificationsMock.mock.calls[0].arguments[1][0].utilisateurId, 3);
});

test('rejeter exige un motif', async (t) => {
  mockerKnex(t);

  await assert.rejects(
    () => demandeDpaeService.rejeter(ENTITE_ACCECIT, 7, 42, '   '),
    /motif de rejet est obligatoire/,
  );
});

test('rejeter marque la demande rejetée avec le motif et notifie le demandeur', async (t) => {
  mockerKnex(t);
  t.mock.method(demandeDpaeRepository, 'trouverDemandeParId', async () => ({
    id: 7,
    statut: 'envoyee',
    demandeur_id: 3,
    salarie_nom: 'Martin',
    salarie_prenom: 'Sophie',
  }));
  const marquerTraiteeMock = t.mock.method(demandeDpaeRepository, 'marquerTraitee', async () => {});
  t.mock.method(notificationService, 'creerNotifications', async () => {});

  await demandeDpaeService.rejeter(ENTITE_ACCECIT, 7, 42, '  Poste déjà pourvu  ');

  assert.deepEqual(marquerTraiteeMock.mock.calls[0].arguments[2], {
    statut: 'rejetee',
    traitantId: 42,
    motifRejet: 'Poste déjà pourvu',
  });
});

// ---------------------------------------------------------------------------------------------
// Consultation (périmètre révisé le 2026-09-30) — liste de suivi et fiche.
// ---------------------------------------------------------------------------------------------
const ENTITE_AUTRE = { id: 2, code: 'autre_entite' };

// Base factice : demandes de DEUX entités ; le repository filtre sur entite_id (comme la requête
// SQL, voir demandeDpaeRepository) — c'est ce filtre qui garantit l'isolement entre entités.
const DEMANDES_EN_BASE = [
  { id: 1, entite_id: 1, demandeur_id: 16, hotel: 'Ancien texte', date_creation: '2026-09-28T10:00:00Z' },
  { id: 2, entite_id: 1, demandeur_id: 30, hotel: null, date_creation: '2026-09-29T10:00:00Z' },
  { id: 3, entite_id: 2, demandeur_id: 30, hotel: null, date_creation: '2026-09-29T11:00:00Z' },
];

function mockerBaseConsultation(t) {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  const toutesMock = t.mock.method(demandeDpaeRepository, 'listerDemandesPourRh', async (_bd, entiteId, statut) =>
    DEMANDES_EN_BASE.filter((d) => d.entite_id === entiteId && (statut === null || d.statut === statut)).reverse(),
  );
  const miennesMock = t.mock.method(demandeDpaeRepository, 'listerDemandesParDemandeur', async (_bd, entiteId, demandeurId) =>
    DEMANDES_EN_BASE.filter((d) => d.entite_id === entiteId && d.demandeur_id === demandeurId).reverse(),
  );
  t.mock.method(siteAffectationRepository, 'listerSitesParDemandes', async () => [
    { demande_dpae_id: 2, id: 10, nom: 'AIGLON', initiales: 'AIG' },
    { demande_dpae_id: 2, id: 11, nom: 'ALBE', initiales: 'AL' },
  ]);
  t.mock.method(demandeDpaeRepository, 'trouverDemandeParId', async (_bd, entiteId, id) =>
    DEMANDES_EN_BASE.find((d) => d.entite_id === entiteId && d.id === id),
  );
  t.mock.method(siteAffectationRepository, 'listerSitesDemande', async () => []);
  return { toutesMock, miennesMock };
}

test('perimetreSuivi : Admin, RH et Planning voient toutes les demandes par défaut, ou les leurs sur demande ; tout autre rôle, jamais que les siennes', () => {
  const { perimetreSuivi } = demandeDpaeService;
  for (const roleCode of ['admin', 'rh', 'planning']) {
    assert.equal(perimetreSuivi({ roleCode, perimetreDemande: undefined }), 'toutes', roleCode);
    assert.equal(perimetreSuivi({ roleCode, perimetreDemande: 'toutes' }), 'toutes', roleCode);
    assert.equal(perimetreSuivi({ roleCode, perimetreDemande: 'mes' }), 'mes', roleCode);
  }
  // Rôle hors dpaeConsultationToutes (la route le refuse de toute façon en amont) : jamais
  // plus que ses propres demandes, quoi qu'il demande.
  assert.equal(perimetreSuivi({ roleCode: 'accueil_coordination', perimetreDemande: 'toutes' }), 'mes');
});

test("listerSuivi (Admin, RH, Planning) : toutes les demandes de l'entité par défaut, plus récentes d'abord, jamais celles d'une autre entité", async (t) => {
  const { toutesMock } = mockerBaseConsultation(t);
  for (const roleCode of ['admin', 'rh', 'planning']) {
    const demandes = await demandeDpaeService.listerSuivi(ENTITE_ACCECIT, { utilisateurId: 99, roleCode });
    assert.deepEqual(demandes.map((d) => d.id), [2, 1], roleCode);
  }
  assert.deepEqual(toutesMock.mock.calls.map((appel) => [appel.arguments[1], appel.arguments[2]]), [[1, null], [1, null], [1, null]]);
});

test("listerSuivi (Planning) « Mes demandes » : seulement les siennes", async (t) => {
  mockerBaseConsultation(t);
  const demandes = await demandeDpaeService.listerSuivi(ENTITE_ACCECIT, { utilisateurId: 16, roleCode: 'planning', perimetreDemande: 'mes' });
  assert.deepEqual(demandes.map((d) => d.id), [1]);
});

test('listerSuivi : chaque demande porte ses sites, une demande sans site lié garde son ancien texte (jamais exclue)', async (t) => {
  mockerBaseConsultation(t);
  const [recente, ancienne] = await demandeDpaeService.listerSuivi(ENTITE_ACCECIT, { utilisateurId: 99, roleCode: 'admin' });
  assert.deepEqual(recente.sites_affectation, [{ id: 10, nom: 'AIGLON', initiales: 'AIG' }, { id: 11, nom: 'ALBE', initiales: 'AL' }]);
  assert.deepEqual(ancienne.sites_affectation, []);
  assert.equal(ancienne.hotel, 'Ancien texte');
});

test("listerSuivi « Mes demandes » : seulement celles de l'utilisateur, dans son entité", async (t) => {
  const { miennesMock } = mockerBaseConsultation(t);
  const demandes = await demandeDpaeService.listerSuivi(ENTITE_ACCECIT, { utilisateurId: 30, roleCode: 'admin', perimetreDemande: 'mes' });
  assert.deepEqual(demandes.map((d) => d.id), [2]);
  assert.deepEqual(miennesMock.mock.calls[0].arguments.slice(1), [1, 30]);
});

test("peutConsulterDemande : Admin, RH et Planning toutes les fiches ; Accueil/Coordination jamais, même auteur", () => {
  const { peutConsulterDemande } = demandeDpaeService;
  const demande = { demandeur_id: 30 };
  assert.equal(peutConsulterDemande({ roleCode: 'admin', utilisateurId: 1, demande }), true);
  assert.equal(peutConsulterDemande({ roleCode: 'rh', utilisateurId: 1, demande }), true);
  assert.equal(peutConsulterDemande({ roleCode: 'planning', utilisateurId: 30, demande }), true);
  assert.equal(peutConsulterDemande({ roleCode: 'planning', utilisateurId: 1, demande }), true);
  assert.equal(peutConsulterDemande({ roleCode: 'accueil_coordination', utilisateurId: 30, demande }), false);
  assert.equal(peutConsulterDemande({ roleCode: 'formateur', utilisateurId: 30, demande }), false);
});

test("obtenirDemande : une demande d'une autre entité est introuvable, quel que soit le rôle", async (t) => {
  mockerBaseConsultation(t);
  // Demande 3 = autre entité : demandée depuis ACCECIT -> introuvable.
  await assert.rejects(() => demandeDpaeService.obtenirDemande(ENTITE_ACCECIT, 3), demandeDpaeService.ErreurDemandeIntrouvable);
  // Et inversement, depuis l'autre entité, la demande 1 d'ACCECIT est introuvable.
  await assert.rejects(() => demandeDpaeService.obtenirDemande(ENTITE_AUTRE, 1), demandeDpaeService.ErreurDemandeIntrouvable);
});

// ---------------------------------------------------------------------------------------------
// Statut « En attente » — transitions autorisées : À traiter -> En attente (motif
// obligatoire) ; En attente -> Validée | Rejetée. Aucune autre.
// ---------------------------------------------------------------------------------------------
function mockerDemandeAuStatut(t, statut) {
  mockerKnex(t);
  t.mock.method(demandeDpaeRepository, 'trouverDemandeParId', async () => ({
    id: 7,
    statut,
    demandeur_id: 3,
    salarie_nom: 'Martin',
    salarie_prenom: 'Sophie',
  }));
  return {
    marquerEnAttenteMock: t.mock.method(demandeDpaeRepository, 'marquerEnAttente', async () => {}),
    marquerTraiteeMock: t.mock.method(demandeDpaeRepository, 'marquerTraitee', async () => {}),
    creerNotificationsMock: t.mock.method(notificationService, 'creerNotifications', async () => {}),
  };
}

test('mettreEnAttente depuis « À traiter » : statut en attente avec le motif (nettoyé), demandeur notifié avec le motif', async (t) => {
  const { marquerEnAttenteMock, marquerTraiteeMock, creerNotificationsMock } = mockerDemandeAuStatut(t, 'envoyee');

  await demandeDpaeService.mettreEnAttente(ENTITE_ACCECIT, 7, 42, '  Pièce manquante  ');

  assert.deepEqual(marquerEnAttenteMock.mock.calls[0].arguments.slice(1), [7, { traitantId: 42, motif: 'Pièce manquante' }]);
  // Pas une décision : la date de traitement (marquerTraitee) n'est jamais posée.
  assert.equal(marquerTraiteeMock.mock.calls.length, 0);
  const [notification] = creerNotificationsMock.mock.calls[0].arguments[1];
  assert.equal(notification.utilisateurId, 3);
  assert.equal(notification.type, 'demande_dpae_en_attente');
  assert.match(notification.message, /mise en attente par la RH : Pièce manquante$/);
});

test('mettreEnAttente : motif absent, vide ou fait d’espaces -> refus, rien n’est écrit ni notifié', async (t) => {
  const { marquerEnAttenteMock, creerNotificationsMock } = mockerDemandeAuStatut(t, 'envoyee');
  for (const motif of [undefined, '', '   ']) {
    await assert.rejects(() => demandeDpaeService.mettreEnAttente(ENTITE_ACCECIT, 7, 42, motif), /motif de mise en attente est obligatoire/);
  }
  assert.equal(marquerEnAttenteMock.mock.calls.length, 0);
  assert.equal(creerNotificationsMock.mock.calls.length, 0);
});

test('mettreEnAttente depuis « En attente », « Validée » ou « Rejetée » -> refus (aucune autre transition)', async (t) => {
  for (const statut of ['en_attente', 'validee', 'rejetee']) {
    await t.test(statut, async (st) => {
      const { marquerEnAttenteMock } = mockerDemandeAuStatut(st, statut);
      await assert.rejects(() => demandeDpaeService.mettreEnAttente(ENTITE_ACCECIT, 7, 42, 'Motif'), demandeDpaeService.ErreurDemandeDejaTraitee);
      assert.equal(marquerEnAttenteMock.mock.calls.length, 0);
    });
  }
});

test('mettreEnAttente : demande introuvable (ou d’une autre entité) -> ErreurDemandeIntrouvable', async (t) => {
  mockerKnex(t);
  t.mock.method(demandeDpaeRepository, 'trouverDemandeParId', async () => undefined);
  await assert.rejects(() => demandeDpaeService.mettreEnAttente(ENTITE_ACCECIT, 999, 42, 'Motif'), demandeDpaeService.ErreurDemandeIntrouvable);
});

test('« En attente » -> « Validée » : autorisé, décision posée et demandeur notifié', async (t) => {
  const { marquerTraiteeMock, creerNotificationsMock } = mockerDemandeAuStatut(t, 'en_attente');
  await demandeDpaeService.valider(ENTITE_ACCECIT, 7, 42);
  assert.deepEqual(marquerTraiteeMock.mock.calls[0].arguments[2], { statut: 'validee', traitantId: 42 });
  assert.equal(creerNotificationsMock.mock.calls[0].arguments[1][0].type, 'demande_dpae_validee');
});

test('« En attente » -> « Rejetée » : autorisé avec motif', async (t) => {
  const { marquerTraiteeMock } = mockerDemandeAuStatut(t, 'en_attente');
  await demandeDpaeService.rejeter(ENTITE_ACCECIT, 7, 42, 'Doublon');
  assert.deepEqual(marquerTraiteeMock.mock.calls[0].arguments[2], { statut: 'rejetee', traitantId: 42, motifRejet: 'Doublon' });
});

test('Validation ou rejet d’une demande déjà décidée (validée ou rejetée) -> refus', async (t) => {
  for (const statut of ['validee', 'rejetee']) {
    await t.test(statut, async (st) => {
      const { marquerTraiteeMock } = mockerDemandeAuStatut(st, statut);
      await assert.rejects(() => demandeDpaeService.valider(ENTITE_ACCECIT, 7, 42), demandeDpaeService.ErreurDemandeDejaTraitee);
      await assert.rejects(() => demandeDpaeService.rejeter(ENTITE_ACCECIT, 7, 42, 'Motif'), demandeDpaeService.ErreurDemandeDejaTraitee);
      assert.equal(marquerTraiteeMock.mock.calls.length, 0);
    });
  }
});
