const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const { ROLES } = require('../auth/rbac');
const { PERMISSIONS } = require('../auth/permissions');
const dossierRepository = require('./dossierRepository');
const notesDossierRepository = require('./notesDossierRepository');
const motifRepository = require('../motifs/motifRepository');
const rendezvousRepository = require('../rendezvous/rendezvousRepository');
const journalAudit = require('../audit/journalAudit');
const workflowEngine = require('../workflow/workflowEngine');
const blacklistService = require('./blacklistService');

const ENTITE = { id: 1, code: 'accecit' };
const STATUT_BLACKLISTE = { id: 99, code: 'blackliste', libelle: 'Blacklisté' };
const MOTIF = { id: 5, code: 'absence_repetee', libelle: 'Absence répétée sans prévenir' };
const COMMENTAIRE = 'Absent à trois rendez-vous sans prévenir.';
const TRX = { estUnTrx: true };

const ROLES_BACK_OFFICE = [
  ROLES.ACCUEIL_COORDINATION,
  ROLES.PLANNING,
  ROLES.FORMATEUR,
  ROLES.INSPECTEUR,
  ROLES.INSPECTEUR_HOTELLERIE,
  ROLES.ADMIN,
  ROLES.RH,
];

function dossierAuStatut(code, id = 11) {
  return { id: 50, statut_id: id, statut_code: code, statut_libelle: `Libellé ${code}`, statut_avant_blacklist_id: null };
}

function mocker(t, { dossier = dossierAuStatut('test_planifie'), motif = MOTIF } = {}) {
  t.mock.method(db, 'obtenirKnex', async () => ({ transaction: async (callback) => callback(TRX) }));
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => dossier);
  t.mock.method(dossierRepository, 'trouverStatutParCode', async () => STATUT_BLACKLISTE);
  t.mock.method(dossierRepository, 'trouverStatutParId', async () => ({ id: dossier.statut_avant_blacklist_id, code: 'test_planifie', libelle: 'Test planifié' }));
  t.mock.method(motifRepository, 'trouverMotifParCode', async () => motif);
  t.mock.method(dossierRepository, 'trouverDernierPassageAuStatut', async () => ({ date_changement: '2026-11-03T10:00:00Z', auteur_prenom: 'Jeanne', auteur_nom: 'Dupont' }));
  return {
    changement: t.mock.method(dossierRepository, 'enregistrerChangementStatut', async () => {}),
    memoire: t.mock.method(dossierRepository, 'memoriserStatutAvantBlacklist', async () => {}),
    note: t.mock.method(notesDossierRepository, 'ajouterNote', async () => 1),
    audit: t.mock.method(journalAudit, 'enregistrerAction', async () => {}),
    neutralisation: t.mock.method(rendezvousRepository, 'neutraliserRendezvousActifsDossier', async () => []),
  };
}

const appel = (role, surcharge = {}) => ({
  dossierId: 50,
  motifCode: 'absence_repetee',
  commentaire: COMMENTAIRE,
  utilisateurId: 9,
  roleCode: role,
  adresseIp: '127.0.0.1',
  ...surcharge,
});

for (const statut of ['nouveau', 'en_attente_pieces', 'test_planifie', 'test_realise', 'invalide', 'valide_pret_embauche']) {
  test(`blacklister depuis le statut « ${statut} » : statut, statut d'avant, note et audit écrits ; aucun rendez-vous refermé`, async (t) => {
    const m = mocker(t, { dossier: dossierAuStatut(statut, 21) });

    const resultat = await blacklistService.blacklister(ENTITE, appel(ROLES.ACCUEIL_COORDINATION));

    assert.equal(resultat.statutAvantCode, statut);
    assert.equal(m.changement.mock.calls[0].arguments[1].statutId, STATUT_BLACKLISTE.id);
    assert.equal(m.changement.mock.calls[0].arguments[1].motifId, MOTIF.id);
    assert.deepEqual(m.memoire.mock.calls[0].arguments[1], { dossierId: 50, statutId: 21 });
    assert.equal(m.neutralisation.mock.callCount(), 0);
  });
}

for (const role of ROLES_BACK_OFFICE) {
  test(`blacklister est autorisé au rôle ${role}`, async (t) => {
    mocker(t);
    await blacklistService.blacklister(ENTITE, appel(role));
  });
}

test('blacklister est refusé à un rôle hors back-office (403)', async (t) => {
  mocker(t);
  await assert.rejects(
    blacklistService.blacklister(ENTITE, appel(ROLES.SYSTEME)),
    (erreur) => erreur instanceof blacklistService.ErreurBlacklist && erreur.statutHttp === 403,
  );
});

test('blacklister inscrit la catégorie et le commentaire dans une note du dossier', async (t) => {
  const m = mocker(t);
  await blacklistService.blacklister(ENTITE, appel(ROLES.FORMATEUR));
  const note = m.note.mock.calls[0].arguments[1];
  assert.equal(note.dossierId, 50);
  assert.equal(note.auteurId, 9);
  assert.match(note.contenu, /Blacklisté/);
  assert.match(note.contenu, /Absence répétée sans prévenir/);
  assert.match(note.contenu, /Absent à trois rendez-vous/);
});

test("blacklister inscrit au journal d'audit l'auteur, le rôle, l'ancien statut et le motif", async (t) => {
  const m = mocker(t);
  await blacklistService.blacklister(ENTITE, appel(ROLES.RH));
  const entree = m.audit.mock.calls[0].arguments[1];
  assert.equal(entree.action, 'dossier_blacklist');
  assert.equal(entree.utilisateurId, 9);
  assert.equal(entree.cibleId, 50);
  assert.equal(entree.donnees.roleCode, ROLES.RH);
  assert.equal(entree.donnees.statutAvant, 'test_planifie');
  assert.equal(entree.donnees.categorie, 'absence_repetee');
  assert.equal(entree.donnees.commentaire, COMMENTAIRE);
});

test('blacklister refuse un commentaire vide, trop court ou trop long, sans rien écrire', async (t) => {
  const m = mocker(t);
  for (const commentaire of ['', '   ', 'court', 'x'.repeat(501), undefined]) {
    await assert.rejects(
      blacklistService.blacklister(ENTITE, appel(ROLES.ADMIN, { commentaire })),
      (erreur) => erreur instanceof blacklistService.ErreurBlacklist && erreur.statutHttp === 400,
    );
  }
  assert.equal(m.changement.mock.callCount(), 0);
  assert.equal(m.note.mock.callCount(), 0);
  assert.equal(m.audit.mock.callCount(), 0);
});

test('blacklister accepte 10 et 500 caractères (bornes incluses)', async (t) => {
  mocker(t);
  await blacklistService.blacklister(ENTITE, appel(ROLES.ADMIN, { commentaire: 'x'.repeat(10) }));
  await blacklistService.blacklister(ENTITE, appel(ROLES.ADMIN, { commentaire: 'x'.repeat(500) }));
});

test('blacklister refuse une catégorie absente ou inconnue', async (t) => {
  mocker(t, { motif: null });
  await assert.rejects(blacklistService.blacklister(ENTITE, appel(ROLES.ADMIN, { motifCode: 'inconnu' })), /Le motif est obligatoire/);
  await assert.rejects(blacklistService.blacklister(ENTITE, appel(ROLES.ADMIN, { motifCode: undefined })), /Le motif est obligatoire/);
});

test('blacklister refuse un dossier déjà blacklisté (409)', async (t) => {
  mocker(t, { dossier: dossierAuStatut('blackliste') });
  await assert.rejects(blacklistService.blacklister(ENTITE, appel(ROLES.ADMIN)), (e) => e.statutHttp === 409);
});

test('blacklister : dossier introuvable -> 404', async (t) => {
  mocker(t, { dossier: null });
  await assert.rejects(blacklistService.blacklister(ENTITE, appel(ROLES.ADMIN)), (e) => e.statutHttp === 404);
});

test("retrait : l'Admin rétablit le statut d'avant, avec note et audit ; la mémoire est effacée", async (t) => {
  const m = mocker(t, { dossier: { ...dossierAuStatut('blackliste', 99), statut_avant_blacklist_id: 11 } });

  const resultat = await blacklistService.retirerDeLaBlacklist(ENTITE, {
    dossierId: 50,
    commentaire: 'Erreur de dossier, homonyme confirmé.',
    utilisateurId: 3,
    roleCode: ROLES.ADMIN,
    adresseIp: '127.0.0.1',
  });

  assert.equal(resultat.statutRetabliCode, 'test_planifie');
  assert.equal(m.changement.mock.calls[0].arguments[1].statutId, 11);
  assert.deepEqual(m.memoire.mock.calls[0].arguments[1], { dossierId: 50, statutId: null });
  assert.match(m.note.mock.calls[0].arguments[1].contenu, /Retrait de la blacklist/);
  assert.equal(m.audit.mock.calls[0].arguments[1].action, 'dossier_blacklist_retrait');
  assert.equal(m.audit.mock.calls[0].arguments[1].donnees.roleCode, ROLES.ADMIN);
});

test('retrait : refusé à tous les rôles sauf Admin (403), motif obligatoire, dossier non blacklisté refusé (409)', async (t) => {
  const m = mocker(t, { dossier: { ...dossierAuStatut('blackliste', 99), statut_avant_blacklist_id: 11 } });
  const base = { dossierId: 50, commentaire: 'Erreur de dossier, homonyme.', utilisateurId: 3, adresseIp: 'x' };

  for (const role of ROLES_BACK_OFFICE.filter((r) => r !== ROLES.ADMIN)) {
    await assert.rejects(blacklistService.retirerDeLaBlacklist(ENTITE, { ...base, roleCode: role }), (e) => e.statutHttp === 403, role);
  }
  await assert.rejects(blacklistService.retirerDeLaBlacklist(ENTITE, { ...base, roleCode: ROLES.ADMIN, commentaire: '  ' }), (e) => e.statutHttp === 400);
  assert.equal(m.changement.mock.callCount(), 0);

});

test('retrait : un dossier non blacklisté est refusé (409)', async (t) => {
  mocker(t, { dossier: dossierAuStatut('test_planifie') });
  await assert.rejects(
    blacklistService.retirerDeLaBlacklist(ENTITE, { dossierId: 50, commentaire: 'Erreur de dossier, homonyme.', utilisateurId: 3, roleCode: ROLES.ADMIN, adresseIp: 'x' }),
    (e) => e.statutHttp === 409,
  );
});

test('permissions : blacklister pour tout le back-office, retirerBlacklist pour l’Admin seul', () => {
  assert.deepEqual([...PERMISSIONS.blacklister].sort(), [...ROLES_BACK_OFFICE].sort());
  assert.deepEqual([...PERMISSIONS.retirerBlacklist], [ROLES.ADMIN]);
});

test('forcerStatut ne peut ni cibler « Blacklisté » ni sortir un dossier blacklisté', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({ transaction: async (cb) => cb(TRX) }));
  t.mock.method(dossierRepository, 'trouverStatutParCode', async () => STATUT_BLACKLISTE);

  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => dossierAuStatut('test_planifie'));
  await assert.rejects(
    workflowEngine.forcerStatut(ENTITE, { dossierId: 50, statutCode: 'blackliste', commentaire: 'x', utilisateurId: 1, roleCode: ROLES.ADMIN }),
    /ne peut pas être choisi/,
  );

  t.mock.restoreAll();
  t.mock.method(db, 'obtenirKnex', async () => ({ transaction: async (cb) => cb(TRX) }));
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => dossierAuStatut('blackliste'));
  await assert.rejects(
    workflowEngine.forcerStatut(ENTITE, { dossierId: 50, statutCode: 'nouveau', commentaire: 'x', utilisateurId: 1, roleCode: ROLES.ADMIN }),
    /blacklisté/,
  );
});

test('trouverDossiersBlacklistesCorrespondants renvoie dossier et critère (NIR puis identité)', async () => {
  let sqlRecu;
  const bd = {
    raw: (sql, parametres) => {
      sqlRecu = { sql, parametres };
      return Promise.resolve({ rows: [{ dossier_id: 12, critere: 'nir' }, { dossier_id: 8, critere: 'identite' }] });
    },
  };
  const resultat = await dossierRepository.trouverDossiersBlacklistesCorrespondants(bd, 1, 200, 'blackliste');
  assert.deepEqual(resultat, [{ dossierId: 12, critere: 'nir' }, { dossierId: 8, critere: 'identite' }]);
  assert.deepEqual(sqlRecu.parametres, ['blackliste', 200, 1]);
  assert.match(sqlRecu.sql, /nir_hash/);
  assert.match(sqlRecu.sql, /date_naissance/);
  assert.match(sqlRecu.sql, /d2\.id <> d\.id/);
});

// --- Messages de refus : texte exact affiché tel quel par l'interface ---

test('message 403 : dossier embauché, rôle non autorisé', async (t) => {
  mocker(t, { dossier: dossierAuStatut('embauche') });
  for (const role of [ROLES.ACCUEIL_COORDINATION, ROLES.FORMATEUR, ROLES.INSPECTEUR, ROLES.INSPECTEUR_HOTELLERIE]) {
    await assert.rejects(
      blacklistService.blacklister(ENTITE, appel(role)),
      (e) => e.statutHttp === 403 && e.message === 'Ce candidat est embauché : seuls les rôles Planning, RH et Admin peuvent le blacklister.',
      role,
    );
  }
});

test('dossier embauché : Planning, RH et Admin peuvent blacklister', async (t) => {
  const m = mocker(t, { dossier: dossierAuStatut('embauche') });
  for (const role of [ROLES.PLANNING, ROLES.RH, ROLES.ADMIN]) {
    await blacklistService.blacklister(ENTITE, appel(role));
  }
  assert.equal(m.changement.mock.callCount(), 3);
});

test('dossier non embauché : chaque rôle du back-office peut blacklister', async (t) => {
  const m = mocker(t, { dossier: dossierAuStatut('valide_pret_embauche') });
  for (const role of ROLES_BACK_OFFICE) await blacklistService.blacklister(ENTITE, appel(role));
  assert.equal(m.changement.mock.callCount(), ROLES_BACK_OFFICE.length);
});

test('message 409 : déjà blacklisté, avec la date et l’auteur', async (t) => {
  mocker(t, { dossier: dossierAuStatut('blackliste') });
  await assert.rejects(
    blacklistService.blacklister(ENTITE, appel(ROLES.ADMIN)),
    (e) => e.statutHttp === 409 && e.message === 'Ce candidat est déjà blacklisté depuis le 03/11/2026 par Jeanne Dupont.',
  );
});

test('message 400 : motif manquant ou trop court', async (t) => {
  const attendu = "Le motif est obligatoire : choisissez une catégorie et saisissez un commentaire d'au moins 10 caractères.";
  mocker(t);
  await assert.rejects(blacklistService.blacklister(ENTITE, appel(ROLES.ADMIN, { commentaire: 'court' })), (e) => e.statutHttp === 400 && e.message === attendu);
  await assert.rejects(blacklistService.blacklister(ENTITE, appel(ROLES.ADMIN, { motifCode: '' })), (e) => e.statutHttp === 400 && e.message === attendu);
});

test('message 403 : retrait de la blacklist par un rôle autre que l’Admin', async (t) => {
  mocker(t, { dossier: { ...dossierAuStatut('blackliste', 99), statut_avant_blacklist_id: 11 } });
  for (const role of ROLES_BACK_OFFICE.filter((r) => r !== ROLES.ADMIN)) {
    await assert.rejects(
      blacklistService.retirerDeLaBlacklist(ENTITE, { dossierId: 50, commentaire: COMMENTAIRE, utilisateurId: 3, roleCode: role, adresseIp: 'x' }),
      (e) => e.statutHttp === 403 && e.message === 'Seul un administrateur peut retirer un candidat de la blacklist.',
      role,
    );
  }
});
