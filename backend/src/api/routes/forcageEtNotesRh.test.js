const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const { ROLES } = require('../../core/auth/rbac');
const { aPermission } = require('../../core/auth/permissions');
const journalAudit = require('../../core/audit/journalAudit');
const workflowEngine = require('../../core/workflow/workflowEngine');
const transitionsRouter = require('./transitions.routes');
const notesRouter = require('./notes.routes');

// Rôle RH : forçage de statut (mêmes droits et mêmes effets que le Planning) et notes d'un dossier (lecture
// et ajout, jamais de modification ni de suppression). Gardes testées sur les VRAIS routeurs.
const ENTITE = { id: 1, code: 'accecit' };
const ROUTEURS = { transitions: transitionsRouter, notes: notesRouter };

function couche(nomRouteur, methode, chemin) {
  const trouvee = ROUTEURS[nomRouteur].stack.find((c) => c.route && c.route.path === chemin && c.route.methods[methode]);
  assert.ok(trouvee, `${nomRouteur} ${methode} ${chemin} introuvable`);
  return trouvee;
}

function passeLesGardes(nomRouteur, methode, chemin, roleCode) {
  const routeur = ROUTEURS[nomRouteur];
  const gardes = [...routeur.stack.filter((c) => !c.route).map((c) => c.handle), ...couche(nomRouteur, methode, chemin).route.stack.slice(0, -1).map((c) => c.handle)];
  const req = { session: { utilisateur: { id: 9, roleCode, entiteId: ENTITE.id } }, entite: ENTITE, params: {}, query: {}, body: {} };
  const res = { statut: null };
  res.status = (code) => {
    res.statut = code;
    return res;
  };
  res.json = () => res;
  for (const garde of gardes) {
    let suivant = false;
    garde(req, res, () => {
      suivant = true;
    });
    if (!suivant) return { autorise: false, statut: res.statut };
  }
  return { autorise: true, statut: null };
}

test('forçage de statut : la RH passe la garde comme le Planning et l’Admin ; Formateur, Inspecteur, Accueil/Coordination, Inspecteur Hôtellerie -> 403', () => {
  for (const roleCode of [ROLES.RH, ROLES.PLANNING, ROLES.ADMIN]) {
    assert.equal(passeLesGardes('transitions', 'post', '/forcer-statut', roleCode).autorise, true, roleCode);
  }
  for (const roleCode of [ROLES.FORMATEUR, ROLES.INSPECTEUR, ROLES.ACCUEIL_COORDINATION, ROLES.INSPECTEUR_HOTELLERIE]) {
    const { autorise, statut } = passeLesGardes('transitions', 'post', '/forcer-statut', roleCode);
    assert.equal(autorise, false, roleCode);
    assert.equal(statut, 403, roleCode);
  }
});

test('notes du dossier : la RH lit et ajoute comme le Planning ; Formateur et Inspecteur gardent leur accès ; aucun autre accès modifié', () => {
  for (const roleCode of [ROLES.RH, ROLES.PLANNING, ROLES.ADMIN, ROLES.ACCUEIL_COORDINATION, ROLES.FORMATEUR, ROLES.INSPECTEUR]) {
    assert.equal(passeLesGardes('notes', 'get', '/', roleCode).autorise, true, `lecture ${roleCode}`);
    assert.equal(passeLesGardes('notes', 'post', '/', roleCode).autorise, true, `ajout ${roleCode}`);
  }
  // Inspecteur Hôtellerie : lecture seule, inchangé.
  assert.equal(passeLesGardes('notes', 'get', '/', ROLES.INSPECTEUR_HOTELLERIE).autorise, true);
  assert.equal(passeLesGardes('notes', 'post', '/', ROLES.INSPECTEUR_HOTELLERIE).statut, 403);
});

test('notes du dossier : aucune route de modification ni de suppression', () => {
  const methodes = notesRouter.stack.filter((c) => c.route).flatMap((c) => Object.keys(c.route.methods));
  assert.deepEqual([...new Set(methodes)].sort(), ['get', 'post']);
});

test('autres droits de la RH sur un dossier inchangés : ni transitions, ni relances, ni rendez-vous, ni gestion des pièces', () => {
  for (const cle of ['gestionTransitions', 'gestionRelances', 'lectureRelances', 'gestionRendezvous', 'gestionPieces', 'marquerEmbauche', 'modificationInscription']) {
    assert.equal(aPermission(ROLES.RH, cle), false, cle);
  }
  for (const cle of ['listeDossiers', 'consultationDossiers', 'exportPieces', 'forcerStatut', 'ajoutNotesDossier', 'lectureNotesDossier']) {
    assert.equal(aPermission(ROLES.RH, cle), true, cle);
  }
});

async function forcer(roleCode) {
  const res = { statut: 200, corps: null };
  res.status = (code) => {
    res.statut = code;
    return res;
  };
  res.json = (corps) => {
    res.corps = corps;
    return res;
  };
  const gestionnaire = couche('transitions', 'post', '/forcer-statut').route.stack.at(-1).handle;
  let erreur = null;
  await gestionnaire(
    { params: { dossierId: '127' }, body: { statutCode: 'test_non_realise', commentaire: 'Correction RH.' }, entite: ENTITE, utilisateur: { id: 9, roleCode }, ip: '10.0.0.1' },
    res,
    (e) => {
      erreur = e;
    },
  );
  return { res, erreur };
}

test('forçage par la RH : mêmes effets que le Planning (service appelé avec le rôle, neutralisation des rendez-vous, une entrée d’audit par changement et par rendez-vous, rôle tracé)', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  const resultatService = {
    statutAvantCode: 'rdv_test_planifie',
    statutApresCode: 'test_non_realise',
    motifNeutralisationCode: 'neutralise_par_forcage',
    rendezvousNeutralises: [{ id: 160, statutAvant: 'prevu', outlookEventId: null, formateurId: null }],
  };
  const forcerMock = t.mock.method(workflowEngine, 'forcerStatut', async () => resultatService);
  const auditMock = t.mock.method(journalAudit, 'enregistrerAction', async () => {});

  const resultats = {};
  for (const roleCode of ['planning', 'rh']) {
    forcerMock.mock.resetCalls();
    auditMock.mock.resetCalls();
    const { res, erreur } = await forcer(roleCode);
    assert.equal(erreur, null);
    assert.equal(res.statut, 201, roleCode);
    assert.equal(forcerMock.mock.calls[0].arguments[1].roleCode, roleCode);
    const entrees = auditMock.mock.calls.map((appel) => appel.arguments[1]);
    resultats[roleCode] = entrees.map(({ action, tableCible, cibleId, utilisateurId }) => ({ action, tableCible, cibleId, utilisateurId }));
    const changement = entrees.find((e) => e.action === 'changement_statut_force');
    assert.deepEqual(
      { statutAvant: changement.donnees.statutAvant, statutApres: changement.donnees.statutApres, commentaire: changement.donnees.commentaire, roleCode: changement.donnees.roleCode },
      { statutAvant: 'rdv_test_planifie', statutApres: 'test_non_realise', commentaire: 'Correction RH.', roleCode },
      roleCode,
    );
    assert.deepEqual(entrees.map((e) => e.action), ['changement_statut_force', 'rendezvous_neutralise_force']);
  }
  // Même suite d'entrées d'audit pour la RH et pour le Planning.
  assert.deepEqual(resultats.rh, resultats.planning);
});
