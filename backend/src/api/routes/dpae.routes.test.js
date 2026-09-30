const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const journalAudit = require('../../core/audit/journalAudit');
const demandeDpaeService = require('../../core/dpae/demandeDpaeService');
const notesDemandeDpaeService = require('../../core/dpae/notesDemandeDpaeService');
const dpaeRouter = require('./dpae.routes');

const { demandeBodySchema } = dpaeRouter;

// Testé sur le VRAI schéma monté sur POST /api/dpae (exporté par dpae.routes.js, même convention
// que dossiers.routes.test.js).
const DEMANDE_VALIDE = {
  typeDemande: 'nouvelle_embauche',
  salarieNom: 'Martin',
  salariePrenom: 'Léa',
  salarieDejaEmploye: false,
  sitesAffectationIds: [10],
  verifBesoinHotel: true,
  verifTousJoursInclus: true,
  verifNonPlanification: true,
};

const MESSAGE_SITES_OBLIGATOIRES = "Au moins un site d'affectation est obligatoire.";

// Site(s) d'affectation (référentiel, migration 069, 2026-09-29) — remplace l'ancien champ texte
// `hotel` obligatoire. L'existence/l'état actif/l'entité de chaque id sont vérifiés par le service
// (voir demandeDpaeService.test.js), ce schéma ne garantit que la forme de la liste.
test("POST /api/dpae : un site d'affectation -> accepté ; plusieurs sites -> acceptés, tous conservés", () => {
  assert.deepEqual(demandeBodySchema.parse(DEMANDE_VALIDE).sitesAffectationIds, [10]);
  assert.deepEqual(demandeBodySchema.parse({ ...DEMANDE_VALIDE, sitesAffectationIds: [10, 11, 12] }).sitesAffectationIds, [10, 11, 12]);
});

test("POST /api/dpae : liste de sites vide ou absente -> refus « Au moins un site d'affectation est obligatoire. »", () => {
  const { sitesAffectationIds: _ids, ...sansSites } = DEMANDE_VALIDE;
  for (const [cas, donnees] of [
    ['vide', { ...DEMANDE_VALIDE, sitesAffectationIds: [] }],
    ['absente', sansSites],
  ]) {
    const resultat = demandeBodySchema.safeParse(donnees);
    assert.equal(resultat.success, false, cas);
    assert.deepEqual(resultat.error.flatten().fieldErrors.sitesAffectationIds, [MESSAGE_SITES_OBLIGATOIRES], cas);
  }
});

test('POST /api/dpae : un même site deux fois dans la liste -> refus', () => {
  const resultat = demandeBodySchema.safeParse({ ...DEMANDE_VALIDE, sitesAffectationIds: [10, 11, 10] });
  assert.equal(resultat.success, false);
  assert.deepEqual(resultat.error.flatten().fieldErrors.sitesAffectationIds, [
    "Un même site d'affectation ne peut pas être sélectionné deux fois.",
  ]);
});

test("POST /api/dpae : l'ancien champ texte hotel n'est plus exigé (toléré s'il est fourni)", () => {
  assert.equal(demandeBodySchema.safeParse(DEMANDE_VALIDE).success, true);
  assert.equal(demandeBodySchema.safeParse({ ...DEMANDE_VALIDE, hotel: 'Hôtel du Cadran' }).success, true);
});

test("POST /api/dpae : le champ Entité (division) reste facultatif (inchangé)", () => {
  assert.equal(demandeBodySchema.safeParse(DEMANDE_VALIDE).success, true);
  assert.equal(demandeBodySchema.safeParse({ ...DEMANDE_VALIDE, division: '' }).success, true);
  assert.equal(demandeBodySchema.safeParse({ ...DEMANDE_VALIDE, division: 'acchot' }).success, true);
});

// "Nom du salarié remplacé" obligatoire uniquement pour un CDD de remplacement (audit 2026-09-29).
const MESSAGE_SALARIE_REMPLACE = 'Le nom du salarié remplacé est obligatoire pour un CDD de remplacement.';
const CDD_REMPLACEMENT = { ...DEMANDE_VALIDE, typeContrat: 'cdd', motifCdd: 'remplacement_absent' };

test('POST /api/dpae : CDD de remplacement sans nom du salarié remplacé (absent, vide ou espaces) -> refusé avec le message dédié', () => {
  for (const [cas, donnees] of [
    ['absent', CDD_REMPLACEMENT],
    ['vide', { ...CDD_REMPLACEMENT, salarieRemplaceNom: '' }],
    ['espaces', { ...CDD_REMPLACEMENT, salarieRemplaceNom: '   ' }],
  ]) {
    const resultat = demandeBodySchema.safeParse(donnees);
    assert.equal(resultat.success, false, cas);
    assert.deepEqual(resultat.error.flatten().fieldErrors.salarieRemplaceNom, [MESSAGE_SALARIE_REMPLACE], cas);
  }
});

test("POST /api/dpae : CDD de remplacement avec nom du salarié remplacé -> accepté (date de fin d'absence toujours facultative)", () => {
  const resultat = demandeBodySchema.safeParse({ ...CDD_REMPLACEMENT, salarieRemplaceNom: ' Dupont ' });
  assert.equal(resultat.success, true);
  assert.equal(resultat.data.salarieRemplaceNom, 'Dupont');
  assert.equal(resultat.data.dateFinAbsence, undefined);
});

test("POST /api/dpae : CDD de surcroît d'activité sans nom du salarié remplacé -> accepté", () => {
  assert.equal(demandeBodySchema.safeParse({ ...DEMANDE_VALIDE, typeContrat: 'cdd', motifCdd: 'surcroit_activite' }).success, true);
});

test('POST /api/dpae : CDI sans nom du salarié remplacé -> accepté (même si une raison de CDD traîne dans la demande)', () => {
  assert.equal(demandeBodySchema.safeParse({ ...DEMANDE_VALIDE, typeContrat: 'cdi' }).success, true);
  assert.equal(demandeBodySchema.safeParse({ ...DEMANDE_VALIDE, typeContrat: 'cdi', motifCdd: 'remplacement_absent' }).success, true);
});

// ---------------------------------------------------------------------------------------------
// Périmètre des rôles DPAE (2026-09-30) — testé sur les VRAIES gardes montées sur chaque route :
// on lit la pile du routeur Express et on exécute le premier middleware de la route (requireRole),
// jamais une copie des listes de rôles. Aucune infrastructure de test HTTP dans ce projet.
// ---------------------------------------------------------------------------------------------
function gardeRoute(methode, chemin) {
  const couche = dpaeRouter.stack.find((c) => c.route && c.route.path === chemin && c.route.methods[methode]);
  assert.ok(couche, `route ${methode.toUpperCase()} ${chemin} introuvable`);
  return couche.route.stack[0].handle;
}

function executerGarde(garde, roleCode) {
  const res = { statut: null };
  res.status = (code) => {
    res.statut = code;
    return res;
  };
  res.json = () => res;
  let autorise = false;
  garde({ utilisateur: { id: 1, roleCode } }, res, () => {
    autorise = true;
  });
  return { autorise, statut: res.statut };
}

const ACTIONS_DPAE = {
  'création (POST /)': ['post', '/'],
  'liste de suivi (GET /suivi)': ['get', '/suivi'],
  'fiche (GET /:id)': ['get', '/:id'],
  'file RH (GET /)': ['get', '/'],
  'validation RH (PATCH /:id/valider)': ['patch', '/:id/valider'],
  'rejet RH (PATCH /:id/rejeter)': ['patch', '/:id/rejeter'],
  'mise en attente RH (PATCH /:id/mettre-en-attente)': ['patch', '/:id/mettre-en-attente'],
  'notes, lecture (GET /:id/notes)': ['get', '/:id/notes'],
  'notes, ajout (POST /:id/notes)': ['post', '/:id/notes'],
};

test("DPAE : l'Admin passe la garde de CHAQUE route (création, liste, fiche, file RH, validation, rejet, mise en attente, notes)", () => {
  for (const [action, [methode, chemin]] of Object.entries(ACTIONS_DPAE)) {
    assert.equal(executerGarde(gardeRoute(methode, chemin), 'admin').autorise, true, action);
  }
});

test('DPAE : Accueil/Coordination reçoit 403 sur la création, la liste, la fiche et le traitement', () => {
  for (const [action, [methode, chemin]] of Object.entries(ACTIONS_DPAE)) {
    const { autorise, statut } = executerGarde(gardeRoute(methode, chemin), 'accueil_coordination');
    assert.equal(autorise, false, action);
    assert.equal(statut, 403, action);
  }
});

test('DPAE : création réservée à Planning et Admin (RH, Formateur, Inspecteur refusés)', () => {
  const garde = gardeRoute('post', '/');
  for (const roleCode of ['planning', 'admin']) assert.equal(executerGarde(garde, roleCode).autorise, true, roleCode);
  for (const roleCode of ['rh', 'formateur', 'inspecteur', 'accueil_coordination']) {
    assert.equal(executerGarde(garde, roleCode).statut, 403, roleCode);
  }
});

test('DPAE : liste de suivi et fiche ouvertes à Admin, RH et Planning ; fermées aux autres rôles', () => {
  for (const chemin of ['/suivi', '/:id']) {
    const garde = gardeRoute('get', chemin);
    for (const roleCode of ['admin', 'rh', 'planning']) assert.equal(executerGarde(garde, roleCode).autorise, true, `${chemin} ${roleCode}`);
    for (const roleCode of ['accueil_coordination', 'formateur', 'inspecteur']) {
      assert.equal(executerGarde(garde, roleCode).statut, 403, `${chemin} ${roleCode}`);
    }
  }
});

test('DPAE : traitement RH (file, validation, rejet) réservé à RH et Admin', () => {
  for (const [methode, chemin] of [['get', '/'], ['patch', '/:id/valider'], ['patch', '/:id/rejeter']]) {
    const garde = gardeRoute(methode, chemin);
    for (const roleCode of ['rh', 'admin']) assert.equal(executerGarde(garde, roleCode).autorise, true, `${chemin} ${roleCode}`);
    for (const roleCode of ['planning', 'accueil_coordination', 'formateur']) {
      assert.equal(executerGarde(garde, roleCode).statut, 403, `${chemin} ${roleCode}`);
    }
  }
});

// ---------------------------------------------------------------------------------------------
// Tableau de bord DPAE (2026-09-30) — garde réellement montée et filtres. Les indicateurs eux-mêmes
// (SQL) sont vérifiés sur la base DEV par scripts/testTableauDeBordDpae.js (transaction annulée).
// ---------------------------------------------------------------------------------------------
test('GET /api/dpae/tableau-de-bord : Admin, RH et Planning autorisés ; Accueil/Coordination, Formateur et Inspecteur -> 403', () => {
  const garde = gardeRoute('get', '/tableau-de-bord');
  for (const roleCode of ['admin', 'rh', 'planning']) assert.equal(executerGarde(garde, roleCode).autorise, true, roleCode);
  for (const roleCode of ['accueil_coordination', 'formateur', 'inspecteur']) {
    assert.equal(executerGarde(garde, roleCode).statut, 403, roleCode);
  }
});

test('GET /api/dpae/tableau-de-bord est déclarée AVANT GET /:id (sinon « tableau-de-bord » serait pris pour un identifiant)', () => {
  const chemins = dpaeRouter.stack.filter((couche) => couche.route?.methods.get).map((couche) => couche.route.path);
  assert.ok(chemins.indexOf('/tableau-de-bord') < chemins.indexOf('/:id'));
});

test('Filtres du tableau de bord : valeurs valides acceptées, valeurs vides = « tous »', () => {
  const { filtresTableauDeBordSchema } = dpaeRouter;
  assert.deepEqual(
    filtresTableauDeBordSchema.parse({ debut: '2026-09-01', fin: '2026-09-30', siteId: '12', typeContrat: 'cdd', statut: 'validee' }),
    { debut: '2026-09-01', fin: '2026-09-30', siteId: 12, typeContrat: 'cdd', statut: 'validee' },
  );
  assert.equal(filtresTableauDeBordSchema.parse({ siteId: 'non_reference' }).siteId, 'non_reference');
  // Valeurs vides -> aucune restriction (undefined) ; clé absente -> absente.
  const vides = filtresTableauDeBordSchema.parse({ debut: '', siteId: '', typeContrat: '', statut: '' });
  for (const cle of ['debut', 'fin', 'siteId', 'typeContrat', 'statut']) assert.equal(vides[cle], undefined, cle);
});

test('Filtres du tableau de bord : valeurs invalides refusées (date, site, contrat, statut)', () => {
  const { filtresTableauDeBordSchema } = dpaeRouter;
  for (const invalide of [{ debut: '30/09/2026' }, { siteId: 'abc' }, { siteId: '-3' }, { typeContrat: 'interim' }, { statut: 'brouillon' }]) {
    assert.equal(filtresTableauDeBordSchema.safeParse(invalide).success, false, JSON.stringify(invalide));
  }
});

// ---------------------------------------------------------------------------------------------
// Statut « En attente » (2026-09-30) — garde, motif obligatoire, traçabilité.
// ---------------------------------------------------------------------------------------------
function gestionnaireRoute(methode, chemin) {
  const couche = dpaeRouter.stack.find((c) => c.route && c.route.path === chemin && c.route.methods[methode]);
  return couche.route.stack[1].handle;
}

// Exécute le gestionnaire (après la garde) avec une requête factice ; renvoie la réponse et
// l'erreur éventuellement transmise à next.
async function appelerGestionnaire(methode, chemin, { params, body, roleCode = 'rh', utilisateurId = 9 }) {
  const res = { statut: 200, corps: null };
  res.status = (code) => {
    res.statut = code;
    return res;
  };
  res.json = (corps) => {
    res.corps = corps;
    return res;
  };
  res.end = () => res;
  let erreurTransmise = null;
  await gestionnaireRoute(methode, chemin)(
    { params, body, entite: { id: 1, code: 'accecit' }, utilisateur: { id: utilisateurId, roleCode }, ip: '127.0.0.1' },
    res,
    (erreur) => {
      erreurTransmise = erreur;
    },
  );
  return { res, erreurTransmise };
}

function mockerAudit(t) {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  return t.mock.method(journalAudit, 'enregistrerAction', async () => {});
}

test('PATCH /:id/mettre-en-attente : RH et Admin autorisés ; Planning, Accueil/Coordination, Formateur, Inspecteur -> 403', () => {
  const garde = gardeRoute('patch', '/:id/mettre-en-attente');
  for (const roleCode of ['rh', 'admin']) assert.equal(executerGarde(garde, roleCode).autorise, true, roleCode);
  for (const roleCode of ['planning', 'accueil_coordination', 'formateur', 'inspecteur']) {
    assert.equal(executerGarde(garde, roleCode).statut, 403, roleCode);
  }
});

test('PATCH /:id/mettre-en-attente : motif absent, vide ou fait d’espaces -> 400, rien n’est fait ni tracé', async (t) => {
  const auditMock = mockerAudit(t);
  const serviceMock = t.mock.method(demandeDpaeService, 'mettreEnAttente', async () => {});
  for (const body of [{}, { motif: '' }, { motif: '   ' }]) {
    const { res } = await appelerGestionnaire('patch', '/:id/mettre-en-attente', { params: { id: '7' }, body });
    assert.equal(res.statut, 400, JSON.stringify(body));
  }
  assert.equal(serviceMock.mock.calls.length, 0);
  assert.equal(auditMock.mock.calls.length, 0);
});

test('PATCH /:id/mettre-en-attente avec motif : 204, changement tracé dans journal_audit (auteur de la session, motif)', async (t) => {
  const auditMock = mockerAudit(t);
  const serviceMock = t.mock.method(demandeDpaeService, 'mettreEnAttente', async () => {});
  const { res } = await appelerGestionnaire('patch', '/:id/mettre-en-attente', {
    params: { id: '7' },
    body: { motif: ' Attente du planning client ' },
    utilisateurId: 9,
  });
  assert.equal(res.statut, 204);
  assert.deepEqual(serviceMock.mock.calls[0].arguments.slice(1), [7, 9, 'Attente du planning client']);
  const entree = auditMock.mock.calls[0].arguments[1];
  assert.equal(entree.utilisateurId, 9);
  assert.equal(entree.action, 'demande_dpae_mise_en_attente');
  assert.equal(entree.cibleId, 7);
  assert.deepEqual(entree.donnees, { motif: 'Attente du planning client' });
});

test('PATCH /:id/mettre-en-attente : transition refusée par le service -> 409 ; demande introuvable -> 404 ; rien de tracé', async (t) => {
  const auditMock = mockerAudit(t);
  const serviceMock = t.mock.method(demandeDpaeService, 'mettreEnAttente', async () => {
    throw new demandeDpaeService.ErreurDemandeDejaTraitee('déjà en attente');
  });
  let { res } = await appelerGestionnaire('patch', '/:id/mettre-en-attente', { params: { id: '7' }, body: { motif: 'x' } });
  assert.equal(res.statut, 409);
  serviceMock.mock.mockImplementation(async () => {
    throw new demandeDpaeService.ErreurDemandeIntrouvable('introuvable');
  });
  ({ res } = await appelerGestionnaire('patch', '/:id/mettre-en-attente', { params: { id: '7' }, body: { motif: 'x' } }));
  assert.equal(res.statut, 404);
  assert.equal(auditMock.mock.calls.length, 0);
});

test('Schéma du motif de mise en attente : exporté, nettoyé, obligatoire', () => {
  const { miseEnAttenteBodySchema } = dpaeRouter;
  assert.deepEqual(miseEnAttenteBodySchema.parse({ motif: '  Pièce manquante ' }), { motif: 'Pièce manquante' });
  assert.equal(miseEnAttenteBodySchema.safeParse({ motif: '  ' }).success, false);
});

test('Filtre Statut du tableau de bord : « en_attente » accepté', () => {
  assert.equal(dpaeRouter.filtresTableauDeBordSchema.parse({ statut: 'en_attente' }).statut, 'en_attente');
});

// ---------------------------------------------------------------------------------------------
// Notes d'une demande DPAE (2026-09-30).
// ---------------------------------------------------------------------------------------------
test('Notes (GET et POST /:id/notes) : Admin, RH et Planning autorisés ; Accueil/Coordination, Formateur, Inspecteur -> 403', () => {
  for (const methode of ['get', 'post']) {
    const garde = gardeRoute(methode, '/:id/notes');
    for (const roleCode of ['admin', 'rh', 'planning']) assert.equal(executerGarde(garde, roleCode).autorise, true, `${methode} ${roleCode}`);
    for (const roleCode of ['accueil_coordination', 'formateur', 'inspecteur']) {
      assert.equal(executerGarde(garde, roleCode).statut, 403, `${methode} ${roleCode}`);
    }
  }
});

test('Notes : aucune route de modification ni de suppression', () => {
  const routesNotes = dpaeRouter.stack.filter((c) => c.route && c.route.path.includes('notes'));
  const methodes = routesNotes.flatMap((c) => Object.keys(c.route.methods));
  assert.deepEqual(methodes.sort(), ['get', 'post']);
});

test('POST /:id/notes par chaque rôle autorisé : 201, auteur pris de la session (jamais du corps), ajout tracé', async (t) => {
  const auditMock = mockerAudit(t);
  const serviceMock = t.mock.method(notesDemandeDpaeService, 'ajouterNote', async () => ({ noteId: 55 }));
  for (const [roleCode, utilisateurId] of [['admin', 1], ['rh', 9], ['planning', 16]]) {
    const { res } = await appelerGestionnaire('post', '/:id/notes', {
      params: { id: '7' },
      body: { contenu: ' Client relancé ', auteurId: 999 },
      roleCode,
      utilisateurId,
    });
    assert.equal(res.statut, 201, roleCode);
    assert.deepEqual(res.corps, { noteId: 55 });
  }
  assert.deepEqual(serviceMock.mock.calls.map((appel) => appel.arguments[1].auteurId), [1, 9, 16]);
  assert.equal(serviceMock.mock.calls[0].arguments[1].contenu, 'Client relancé');
  const entree = auditMock.mock.calls[2].arguments[1];
  assert.equal(entree.utilisateurId, 16);
  assert.equal(entree.action, 'note_demande_dpae_creation');
  assert.equal(entree.tableCible, 'notes_demande_dpae');
  assert.equal(entree.cibleId, 55);
  assert.deepEqual(entree.donnees, { demandeId: 7, contenu: 'Client relancé' });
});

test('POST /:id/notes : contenu vide ou trop long (> 1000) -> 400, rien d’enregistré', async (t) => {
  mockerAudit(t);
  const serviceMock = t.mock.method(notesDemandeDpaeService, 'ajouterNote', async () => ({ noteId: 55 }));
  for (const contenu of ['', '   ', 'x'.repeat(1001)]) {
    const { res } = await appelerGestionnaire('post', '/:id/notes', { params: { id: '7' }, body: { contenu } });
    assert.equal(res.statut, 400);
  }
  assert.equal(serviceMock.mock.calls.length, 0);
});

test('GET /:id/notes par chaque rôle autorisé : notes renvoyées', async (t) => {
  t.mock.method(notesDemandeDpaeService, 'listerNotes', async () => [{ id: 55, contenu: 'Client relancé' }]);
  for (const roleCode of ['admin', 'rh', 'planning']) {
    const { res } = await appelerGestionnaire('get', '/:id/notes', { params: { id: '7' }, roleCode });
    assert.deepEqual(res.corps, [{ id: 55, contenu: 'Client relancé' }], roleCode);
  }
});

test('Notes d’une demande d’une autre entité : 404 en lecture comme en ajout, aucune note renvoyée ni tracée', async (t) => {
  const auditMock = mockerAudit(t);
  const introuvable = async () => {
    throw new demandeDpaeService.ErreurDemandeIntrouvable('introuvable');
  };
  t.mock.method(notesDemandeDpaeService, 'listerNotes', introuvable);
  t.mock.method(notesDemandeDpaeService, 'ajouterNote', introuvable);
  const lecture = await appelerGestionnaire('get', '/:id/notes', { params: { id: '8' } });
  assert.equal(lecture.res.statut, 404);
  assert.equal(Array.isArray(lecture.res.corps), false);
  const ajout = await appelerGestionnaire('post', '/:id/notes', { params: { id: '8' }, body: { contenu: 'x' } });
  assert.equal(ajout.res.statut, 404);
  assert.equal(auditMock.mock.calls.length, 0);
});
