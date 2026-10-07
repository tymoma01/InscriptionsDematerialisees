const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const journalAudit = require('../audit/journalAudit');
const notificationService = require('../notifications/notificationService');
const demandeDpaeRepository = require('./demandeDpaeRepository');
const demandeDpaeService = require('./demandeDpaeService');
const siteAffectationRepository = require('./siteAffectationRepository');
const notesDemandeDpaeRepository = require('./notesDemandeDpaeRepository');

// Scénarios de concurrence et d'atomicité des décisions DPAE, sur une base factice qui reproduit ce
// que garantit PostgreSQL : l'UPDATE ... WHERE statut AND version est un compare-and-set atomique, et
// une transaction qui échoue annule ses propres écritures (décision, audit, notifications) sans
// toucher à celles des autres. Les requêtes SQL elles-mêmes sont vérifiées dans
// demandeDpaeRepository.test.js.
const ENTITE = { id: 1, code: 'accecit' };

function creerBaseFactice(t, { statut = 'envoyee', version = 1, lecturesSimultanees = 1 } = {}) {
  const etat = { statut, version, audits: [], notifications: [] };
  let lectures = 0;
  let liberer;
  const barriere = new Promise((resolve) => {
    liberer = resolve;
  });

  t.mock.method(db, 'obtenirKnex', async () => ({
    transaction: async (callback) => {
      const trx = { annulations: [] };
      try {
        return await callback(trx);
      } catch (erreur) {
        for (const annuler of trx.annulations.reverse()) annuler();
        throw erreur;
      }
    },
  }));

  // L'instantané est pris AVANT l'attente : avec lecturesSimultanees = 2, les deux appelants lisent
  // la même version avant que l'un d'eux n'écrive.
  t.mock.method(demandeDpaeRepository, 'trouverDemandeParId', async () => {
    const instantane = { id: 7, statut: etat.statut, version: etat.version, demandeur_id: 16, salarie_nom: 'Martin', salarie_prenom: 'Sophie' };
    lectures += 1;
    if (lectures >= lecturesSimultanees) liberer();
    await barriere;
    return instantane;
  });

  const compareAndSet = (trx, { statutDepart, version, statut }) => {
    if (etat.statut !== statutDepart || etat.version !== version) return 0;
    const avant = { statut: etat.statut, version: etat.version };
    etat.statut = statut;
    etat.version += 1;
    trx.annulations.push(() => Object.assign(etat, avant));
    return 1;
  };
  t.mock.method(demandeDpaeRepository, 'marquerTraitee', async (trx, _id, parametres) => compareAndSet(trx, parametres));
  t.mock.method(demandeDpaeRepository, 'marquerEnAttente', async (trx, _id, parametres) => compareAndSet(trx, { ...parametres, statut: 'en_attente' }));

  // Modification : même compare-and-set que les décisions ; sites et utilisateurs RH factices.
  t.mock.method(demandeDpaeRepository, 'modifierDemande', async (trx, _id, { statutDepart, version, statutArrivee }) =>
    compareAndSet(trx, { statutDepart, version, statut: statutArrivee }),
  );
  t.mock.method(siteAffectationRepository, 'listerIdsSitesValides', async (_trx, _entiteId, ids) => ids);
  t.mock.method(siteAffectationRepository, 'listerSitesDemande', async () => []);
  t.mock.method(siteAffectationRepository, 'remplacerSitesDemande', async () => {});
  t.mock.method(notesDemandeDpaeRepository, 'ajouterNote', async () => 55);
  t.mock.method(demandeDpaeRepository, 'listerIdsUtilisateursActifsParRole', async () => [3]);

  const empiler = (liste) => async (trx, valeur) => {
    liste.push(valeur);
    trx.annulations.push(() => liste.pop());
  };
  const auditMock = t.mock.method(journalAudit, 'enregistrerAction', empiler(etat.audits));
  const notificationsMock = t.mock.method(notificationService, 'creerNotifications', empiler(etat.notifications));
  return { etat, auditMock, notificationsMock };
}

test('deux décisions simultanées sur la même demande : une seule réussit, l’autre reçoit le refus « modifiée entre-temps »', async (t) => {
  const { etat } = creerBaseFactice(t, { lecturesSimultanees: 2 });

  const resultats = await Promise.allSettled([
    demandeDpaeService.valider(ENTITE, 7, 41, { version: 1 }),
    demandeDpaeService.rejeter(ENTITE, 7, 42, { version: 1 }),
  ]);

  const reussies = resultats.filter((resultat) => resultat.status === 'fulfilled');
  const refusees = resultats.filter((resultat) => resultat.status === 'rejected');
  assert.equal(reussies.length, 1);
  assert.equal(refusees.length, 1);
  assert.ok(refusees[0].reason instanceof demandeDpaeService.ErreurDemandeModifiee);
  assert.equal(refusees[0].reason.message, 'Cette demande a été modifiée entre-temps. Rechargez-la.');
  // Une seule décision enregistrée, une seule trace, une seule notification.
  assert.equal(etat.version, 2);
  assert.ok(['validee', 'rejetee'].includes(etat.statut));
  assert.equal(etat.audits.length, 1);
  assert.equal(etat.notifications.length, 1);
});

test('deux validations simultanées : une seule réussit, l’autre reçoit le refus', async (t) => {
  const { etat } = creerBaseFactice(t, { lecturesSimultanees: 2 });

  const resultats = await Promise.allSettled([
    demandeDpaeService.valider(ENTITE, 7, 41, { version: 1 }),
    demandeDpaeService.valider(ENTITE, 7, 42, { version: 1 }),
  ]);

  assert.equal(resultats.filter((resultat) => resultat.status === 'fulfilled').length, 1);
  const refusee = resultats.find((resultat) => resultat.status === 'rejected');
  assert.ok(refusee.reason instanceof demandeDpaeService.ErreurDemandeModifiee);
  assert.equal(etat.audits.length, 1);
  assert.equal(etat.notifications.length, 1);
});

test('version obsolète : refus, aucune écriture, aucune trace ni notification', async (t) => {
  const { etat } = creerBaseFactice(t, { version: 5 });

  for (const appel of [
    () => demandeDpaeService.valider(ENTITE, 7, 42, { version: 4 }),
    () => demandeDpaeService.rejeter(ENTITE, 7, 42, { version: 4 }),
    () => demandeDpaeService.mettreEnAttente(ENTITE, 7, 42, { version: 4 }),
  ]) {
    await assert.rejects(appel, demandeDpaeService.ErreurDemandeModifiee);
  }
  assert.deepEqual({ statut: etat.statut, version: etat.version }, { statut: 'envoyee', version: 5 });
  assert.equal(etat.audits.length, 0);
  assert.equal(etat.notifications.length, 0);
});

test('rejeu d’une décision avec l’ancienne version après une première décision : refus', async (t) => {
  const { etat } = creerBaseFactice(t);

  await demandeDpaeService.valider(ENTITE, 7, 42, { version: 1 });
  assert.deepEqual({ statut: etat.statut, version: etat.version }, { statut: 'validee', version: 2 });

  await assert.rejects(() => demandeDpaeService.valider(ENTITE, 7, 42, { version: 1 }), demandeDpaeService.ErreurDemandeModifiee);
  assert.equal(etat.audits.length, 1);
});

test('transition non autorisée (demande déjà décidée, bonne version) : refus, rien n’est écrit', async (t) => {
  const { etat } = creerBaseFactice(t, { statut: 'validee', version: 2 });

  await assert.rejects(() => demandeDpaeService.rejeter(ENTITE, 7, 42, { version: 2 }), demandeDpaeService.ErreurDemandeDejaTraitee);
  await assert.rejects(() => demandeDpaeService.mettreEnAttente(ENTITE, 7, 42, { version: 2 }), demandeDpaeService.ErreurDemandeDejaTraitee);
  assert.deepEqual({ statut: etat.statut, version: etat.version }, { statut: 'validee', version: 2 });
  assert.equal(etat.audits.length, 0);
});

test('mise en attente puis décision avec la nouvelle version : enchaînement autorisé, version incrémentée à chaque écriture', async (t) => {
  const { etat } = creerBaseFactice(t);

  await demandeDpaeService.mettreEnAttente(ENTITE, 7, 42, { version: 1 });
  assert.deepEqual({ statut: etat.statut, version: etat.version }, { statut: 'en_attente', version: 2 });

  await demandeDpaeService.rejeter(ENTITE, 7, 42, { version: 2 });
  assert.deepEqual({ statut: etat.statut, version: etat.version }, { statut: 'rejetee', version: 3 });
  assert.equal(etat.audits.length, 2);
  assert.equal(etat.notifications.length, 2);
});

test('échec de l’écriture dans le journal d’audit : aucune décision enregistrée, aucune notification', async (t) => {
  const { etat, auditMock } = creerBaseFactice(t);
  auditMock.mock.mockImplementation(async () => {
    throw new Error('journal_audit indisponible');
  });

  for (const appel of [
    () => demandeDpaeService.valider(ENTITE, 7, 42, { version: 1 }),
    () => demandeDpaeService.rejeter(ENTITE, 7, 42, { version: 1 }),
    () => demandeDpaeService.mettreEnAttente(ENTITE, 7, 42, { version: 1 }),
  ]) {
    await assert.rejects(appel, /journal_audit indisponible/);
    assert.deepEqual({ statut: etat.statut, version: etat.version }, { statut: 'envoyee', version: 1 });
  }
  assert.equal(etat.notifications.length, 0);
  assert.equal(etat.audits.length, 0);
});

test('échec de la création des notifications : décision et trace d’audit annulées', async (t) => {
  const { etat, notificationsMock } = creerBaseFactice(t);
  notificationsMock.mock.mockImplementation(async () => {
    throw new Error('notifications indisponibles');
  });

  await assert.rejects(() => demandeDpaeService.valider(ENTITE, 7, 42, { version: 1 }), /notifications indisponibles/);
  assert.deepEqual({ statut: etat.statut, version: etat.version }, { statut: 'envoyee', version: 1 });
  assert.equal(etat.audits.length, 0);
});

test('modification et décision RH simultanées sur la même demande : une seule réussit, l’autre reçoit le refus « modifiée entre-temps »', async (t) => {
  const { etat } = creerBaseFactice(t, { statut: 'envoyee', version: 2, lecturesSimultanees: 2 });
  const donnees = {
    typeDemande: 'nouvelle_embauche',
    salarieNom: 'Martin',
    salariePrenom: 'Sophie',
    salarieDejaEmploye: false,
    sitesAffectationIds: [10],
    dateDebut: '2026-10-12',
    verifBesoinHotel: true,
    verifTousJoursInclus: true,
    verifNonPlanification: true,
  };

  const resultats = await Promise.allSettled([
    demandeDpaeService.modifierDemande(ENTITE, 7, { donnees, version: 2, utilisateurId: 16, roleCode: 'planning', adresseIp: 'x', noteModification: 'Précision' }),
    demandeDpaeService.rejeter(ENTITE, 7, 42, { version: 2 }),
  ]);

  assert.equal(resultats.filter((resultat) => resultat.status === 'fulfilled').length, 1);
  const refusee = resultats.find((resultat) => resultat.status === 'rejected');
  assert.ok(refusee.reason instanceof demandeDpaeService.ErreurDemandeModifiee);
  assert.equal(etat.version, 3);
  // Une seule trace par décision gagnante ; la modification gagnante en écrit deux (modification et note).
  assert.equal(etat.audits.length, resultats[0].status === 'fulfilled' ? 2 : 1);
});
