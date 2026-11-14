const test = require('node:test');
const assert = require('node:assert/strict');
const knex = require('knex');

const db = require('../../db/knex');
const { ROLES } = require('./rbac');
const perimetreDossiers = require('./perimetreDossiers');
const dossierRepository = require('../dossier/dossierRepository');
const rendezvousService = require('../rendezvous/rendezvousService');
const migration = require('../../db/migrations/095_role_planning_tertiaire');

// Planning Tertiaire : rôle créé par la migration 095 (libellé du Planning changé), périmètre de dossiers
// limité au Tertiaire avec refus 403 explicite.
const PT = ROLES.PLANNING_TERTIAIRE;

// Base factice enregistrant les écritures de la migration.
function baseFactice({ planningTransitions = [11, 12], roleExistant = null } = {}) {
  const journal = { updates: [], inserts: [], raw: [] };
  const roles = { planning: { id: 4 }, ...(roleExistant ? { planning_tertiaire: roleExistant } : {}) };
  const bd = (table) => {
    const contexte = { table, filtre: null };
    const api = {
      where(filtre) {
        contexte.filtre = filtre;
        return api;
      },
      update(valeurs) {
        journal.updates.push({ table, filtre: contexte.filtre, valeurs });
        return Promise.resolve(1);
      },
      first() {
        if (table === 'roles') return Promise.resolve(roles[contexte.filtre.code]);
        return Promise.resolve(undefined);
      },
      select() {
        return Promise.resolve(planningTransitions.map((id) => ({ transition_id: id })));
      },
      insert(valeurs) {
        journal.inserts.push({ table, valeurs });
        return { returning: () => Promise.resolve([{ id: 77 }]) };
      },
    };
    return api;
  };
  bd.raw = (sql, parametres) => {
    journal.raw.push({ sql, parametres });
    return Promise.resolve();
  };
  return { bd, journal };
}

test('Migration 095 : « Planning » devient « Planning Hôtellerie » (code inchangé) et « Planning Tertiaire » est créé, assignable', async () => {
  const { bd, journal } = baseFactice();
  await migration.up(bd);
  assert.deepEqual(journal.updates[0], { table: 'roles', filtre: { code: 'planning' }, valeurs: { libelle: 'Planning Hôtellerie' } });
  assert.deepEqual(journal.inserts[0], { table: 'roles', valeurs: { code: 'planning_tertiaire', libelle: 'Planning Tertiaire', assignable: true } });
  // Aucun compte existant modifié.
  assert.ok(journal.updates.every(({ table }) => table !== 'utilisateurs'));
});

test('Migration 095 : le Planning Tertiaire reçoit les mêmes transitions que le Planning, et la configuration DPAE du Tertiaire', async () => {
  const { bd, journal } = baseFactice();
  await migration.up(bd);
  const transitions = journal.inserts.filter(({ table }) => table === 'transition_roles').map(({ valeurs }) => valeurs);
  assert.deepEqual(transitions, [
    { transition_id: 11, role_id: 77 },
    { transition_id: 12, role_id: 77 },
  ]);
  const config = JSON.parse(journal.raw[0].parametres[0]);
  assert.deepEqual(config.tertiaire.postes, ['nettoyage', 'vitrerie', 'machiniste', 'chef_equipe', 'autre']);
  assert.deepEqual(config.tertiaire.echelons_par_poste, {});
});

test('Migration 095 : relancée, elle ne recrée pas le rôle', async () => {
  const { bd, journal } = baseFactice({ roleExistant: { id: 90 } });
  await migration.up(bd);
  assert.equal(journal.inserts.filter(({ table }) => table === 'roles').length, 0);
});

test('Périmètre de dossiers du Planning Tertiaire : candidats Tertiaire seulement, tous statuts, refus 403 explicite', () => {
  const perimetre = perimetreDossiers.perimetreDossiersPourRole(PT);
  assert.equal(perimetre.typePoste, 'bureau');
  assert.equal(perimetre.statutsCodes, undefined);
  assert.equal(perimetreDossiers.perimetreDossiersPourRole(ROLES.PLANNING), null);

  const bd = knex({ client: 'pg' });
  const liste = dossierRepository.listerDossiers(bd, 1, { perimetre }).toString();
  assert.match(liste, /bloc_disponibilites\.donnees ->> 'typePoste' = 'bureau'/);
  assert.doesNotMatch(liste, /"statuts"\."code" in/);
  const fiche = perimetreDossiers.requeteDossierDansPerimetre(bd, 1, 41, perimetre).toString();
  assert.match(fiche, /'typePoste' = 'bureau'/);
});

test('Dossier hors périmètre du Planning Tertiaire : 403 avec message clair (pas 404), dossier du Tertiaire : la requête continue', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  const dansPerimetre = t.mock.method(perimetreDossiers, 'dossierDansPerimetre', async () => false);
  const req = { session: { utilisateur: { id: 9, roleCode: PT, entiteId: 1 } }, entite: { id: 1 }, params: { dossierId: '41' } };
  const res = { statut: null, corps: null, status(code) { this.statut = code; return this; }, json(corps) { this.corps = corps; return this; } };
  let suite = false;
  await perimetreDossiers.verifierPerimetreDossier(req, res, () => { suite = true; });
  assert.equal(res.statut, 403);
  assert.equal(res.corps.erreur, "Ce dossier concerne l'entité Hôtellerie : il est traité par le Planning Hôtellerie.");
  assert.equal(suite, false);

  dansPerimetre.mock.mockImplementation(async () => true);
  await perimetreDossiers.verifierPerimetreDossier(req, res, () => { suite = true; });
  assert.equal(suite, true);
});

test('Suivi des tests : le Planning Tertiaire est limité au secteur Tertiaire, le Planning Hôtellerie voit tout', () => {
  const filtre = (roleCode) => rendezvousService.filtresListeRendezvousTestParRole({ roleCode, utilisateurId: 9, formateurIdDemande: 3 });
  assert.equal(filtre(PT).typePoste, 'bureau');
  assert.equal(filtre(PT).formateurId, 3);
  assert.equal(filtre(ROLES.PLANNING).typePoste, null);
  assert.equal(filtre(ROLES.INSPECTEUR).typePoste, 'bureau');
});

test('Statistiques : le secteur Tertiaire est imposé au Planning Tertiaire (périmètre de dossiers)', () => {
  assert.equal(perimetreDossiers.perimetreDossiersPourRole(PT).typePoste, 'bureau');
});
