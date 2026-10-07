const test = require('node:test');
const assert = require('node:assert/strict');
const knex = require('knex');

const db = require('../../db/knex');
const journalAudit = require('../audit/journalAudit');
const notificationService = require('../notifications/notificationService');
const demandeDpaeRepository = require('./demandeDpaeRepository');
const demandeDpaeService = require('./demandeDpaeService');

// date_envoi_rh (départ des délais RH) : posée à la PREMIÈRE transmission seulement, jamais écrasée ensuite.
const ENTITE = { id: 1, code: 'accecit' };

test('SQL : la transmission du Planning ne pose date_envoi_rh que si elle est nulle (COALESCE)', () => {
  const bd = knex({ client: 'pg' });
  const { sql } = demandeDpaeRepository.transmettreALaRh(bd, 7, { statutDepart: 'a_valider_planning', version: 3, statut: 'envoyee' }).toSQL();
  assert.match(sql, /"date_envoi_rh" = COALESCE\(date_envoi_rh, now\(\)\)/);
});

test('aucune autre requête du dépôt n’écrit date_envoi_rh dans un UPDATE (classement, réactivation, retransmission, renvoi, modification…)', () => {
  const bd = knex({ client: 'pg' });
  const parametres = { statutDepart: 'x', version: 1, statut: 'y' };
  for (const [nom, requete] of [
    ['classerSansSuite', demandeDpaeRepository.classerSansSuite(bd, 7, { ...parametres, classeeParRole: 'planning' })],
    ['reactiver', demandeDpaeRepository.reactiver(bd, 7, parametres)],
    ['retransmettreALaRh', demandeDpaeRepository.retransmettreALaRh(bd, 7, parametres)],
    ['envoyerAuPlanning', demandeDpaeRepository.envoyerAuPlanning(bd, 7, parametres)],
    ['renvoyerAInspecteur', demandeDpaeRepository.renvoyerAInspecteur(bd, 7, parametres)],
    ['marquerTraitee', demandeDpaeRepository.marquerTraitee(bd, 7, { ...parametres, traitantId: 1 })],
    ['marquerEnAttente', demandeDpaeRepository.marquerEnAttente(bd, 7, { statutDepart: 'x', version: 1, traitantId: 1 })],
    ['modifierDemande', demandeDpaeRepository.modifierDemande(bd, 7, { statutDepart: 'x', version: 1, statutArrivee: 'x', donnees: { salarieNom: 'Martin' } })],
  ]) {
    assert.doesNotMatch(requete.toSQL().sql, /"date_envoi_rh" =/, nom);
  }
});

// Base factice qui reproduit ce que PostgreSQL fait des trois expressions utilisées par le dépôt :
// now(), version + 1 et COALESCE(date_envoi_rh, now()) ; l'UPDATE est un compare-and-set.
function creerBaseFactice(t, etatInitial) {
  const etat = { ...etatInitial, horloge: 0, audits: [] };
  const maintenant = () => `T${etat.horloge}`;
  const trx = (table) => {
    assert.equal(table, 'demandes_dpae');
    let condition;
    return {
      where(valeur) {
        condition = valeur;
        return this;
      },
      async update(valeurs) {
        if (etat.id !== condition.id || etat.statut !== condition.statut || etat.version !== condition.version) return 0;
        for (const [colonne, valeur] of Object.entries(valeurs)) {
          if (valeur === 'NOW') etat[colonne] = maintenant();
          else if (valeur === 'VERSION+1') etat.version += 1;
          else if (valeur === 'COALESCE') etat[colonne] ??= maintenant();
          else etat[colonne] = valeur;
        }
        return 1;
      },
    };
  };
  trx.fn = { now: () => 'NOW' };
  trx.raw = (sql) => (sql === 'version + 1' ? 'VERSION+1' : sql === 'COALESCE(date_envoi_rh, now())' ? 'COALESCE' : assert.fail(`expression inattendue : ${sql}`));

  t.mock.method(db, 'obtenirKnex', async () => ({ transaction: async (callback) => callback(trx) }));
  t.mock.method(demandeDpaeRepository, 'trouverDemandeParId', async () => ({ ...etat, entite_id: 1, demandeur_id: 16, salarie_nom: 'Martin', salarie_prenom: 'Sophie' }));
  t.mock.method(demandeDpaeRepository, 'listerIdsUtilisateursActifsParRole', async () => [3]);
  t.mock.method(journalAudit, 'enregistrerAction', async (_trx, entree) => {
    etat.audits.push({ action: entree.action, dateAction: maintenant() });
  });
  t.mock.method(notificationService, 'creerNotifications', async () => {});
  return etat;
}

test('demande transmise, classée par le Planning, réactivée, puis retransmise : date_envoi_rh = PREMIÈRE date, chaque transmission tracée avec sa date', async (t) => {
  const etat = creerBaseFactice(t, { id: 7, statut: 'a_valider_planning', version: 1, date_envoi_rh: null, classee_par_role: null, statut_avant_classement: null });
  const options = (roleCode) => ({ version: etat.version, adresseIp: 'x', roleCode });

  etat.horloge = 1;
  await demandeDpaeService.transmettreALaRh(ENTITE, 7, 8, options('planning'));
  assert.equal(etat.statut, 'envoyee');
  assert.equal(etat.date_envoi_rh, 'T1');

  etat.horloge = 2;
  await demandeDpaeService.classerSansSuite(ENTITE, 7, 8, options('planning'));
  assert.equal(etat.statut, 'classee_sans_suite');
  assert.deepEqual([etat.classee_par_role, etat.statut_avant_classement], ['planning', 'envoyee']);
  assert.equal(etat.date_envoi_rh, 'T1');

  etat.horloge = 3;
  await demandeDpaeService.reactiver(ENTITE, 7, 1, options('admin'));
  assert.equal(etat.statut, 'a_valider_planning');
  assert.deepEqual([etat.classee_par_role, etat.statut_avant_classement], [null, null]);
  assert.equal(etat.date_envoi_rh, 'T1');

  etat.horloge = 4;
  await demandeDpaeService.transmettreALaRh(ENTITE, 7, 8, options('planning'));
  assert.equal(etat.statut, 'envoyee');
  assert.equal(etat.date_envoi_rh, 'T1', 'la première date est conservée');

  // L'historique montre les deux transmissions, chacune avec sa propre date.
  assert.deepEqual(
    etat.audits.filter(({ action }) => action === 'demande_dpae_transmission_rh'),
    [{ action: 'demande_dpae_transmission_rh', dateAction: 'T1' }, { action: 'demande_dpae_transmission_rh', dateAction: 'T4' }],
  );
});
