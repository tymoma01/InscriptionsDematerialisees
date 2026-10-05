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
  dateDebut: '2026-10-12',
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

// Premier jour : obligatoire pour TOUS les types de demande (le formulaire l'affiche sans
// distinction de typeDemande).
const MESSAGE_DATE_DEBUT_OBLIGATOIRE = 'Le premier jour est obligatoire.';

test('POST /api/dpae : premier jour absent ou vide -> refus « Le premier jour est obligatoire. », quel que soit le type de demande', () => {
  const { dateDebut: _date, ...sansDateDebut } = DEMANDE_VALIDE;
  for (const typeDemande of [
    'nouvelle_embauche',
    'prolongation',
    'ajout_retrait_jours',
    'passage_cdi',
    'changement_horaires_affectation',
  ]) {
    for (const [cas, donnees] of [
      ['absent', { ...sansDateDebut, typeDemande }],
      ['vide', { ...DEMANDE_VALIDE, typeDemande, dateDebut: '' }],
    ]) {
      const resultat = demandeBodySchema.safeParse(donnees);
      assert.equal(resultat.success, false, `${typeDemande} / ${cas}`);
      assert.deepEqual(resultat.error.flatten().fieldErrors.dateDebut, [MESSAGE_DATE_DEBUT_OBLIGATOIRE], `${typeDemande} / ${cas}`);
    }
  }
});

test('POST /api/dpae : premier jour renseigné -> accepté', () => {
  const resultat = demandeBodySchema.safeParse(DEMANDE_VALIDE);
  assert.equal(resultat.success, true);
  assert.equal(resultat.data.dateDebut, '2026-10-12');
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

// "Nom du salarié remplacé" obligatoire uniquement pour un CDD de remplacement.
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
// Périmètre des rôles DPAE — testé sur les VRAIES gardes montées sur chaque route :
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
// Tableau de bord DPAE — garde réellement montée et filtres. Les indicateurs eux-mêmes
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
// Statut « En attente » — garde, motif obligatoire, traçabilité.
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

test('PATCH /:id/mettre-en-attente : motif ou version absents ou invalides -> 400, rien n’est fait', async (t) => {
  const auditMock = mockerAudit(t);
  const serviceMock = t.mock.method(demandeDpaeService, 'mettreEnAttente', async () => {});
  for (const body of [{}, { version: 1 }, { motif: 'x' }, { motif: '', version: 1 }, { motif: '   ', version: 1 }, { motif: 'x', version: 0 }, { motif: 'x', version: 'abc' }]) {
    const { res } = await appelerGestionnaire('patch', '/:id/mettre-en-attente', { params: { id: '7' }, body });
    assert.equal(res.statut, 400, JSON.stringify(body));
  }
  assert.equal(serviceMock.mock.calls.length, 0);
  assert.equal(auditMock.mock.calls.length, 0);
});

// La trace journal_audit et la notification sont écrites par le service, dans la même transaction
// que la décision (voir demandeDpaeService.test.js et demandeDpaeTransitions.test.js) : la route
// ne les écrit plus elle-même, elle transmet l'auteur (session), la version lue et l'adresse IP.
test('PATCH /:id/mettre-en-attente avec motif et version : 204, service appelé avec l’auteur de la session, la version et l’IP', async (t) => {
  const auditMock = mockerAudit(t);
  const serviceMock = t.mock.method(demandeDpaeService, 'mettreEnAttente', async () => {});
  const { res } = await appelerGestionnaire('patch', '/:id/mettre-en-attente', {
    params: { id: '7' },
    body: { motif: ' Attente du planning client ', version: 4 },
    utilisateurId: 9,
  });
  assert.equal(res.statut, 204);
  assert.deepEqual(serviceMock.mock.calls[0].arguments.slice(1), [7, 9, 'Attente du planning client', { version: 4, adresseIp: '127.0.0.1' }]);
  assert.equal(auditMock.mock.calls.length, 0);
});

test('Décisions (valider, rejeter, mettre en attente) : transition refusée -> 409 ; demande modifiée entre-temps -> 409 avec son message ; introuvable -> 404', async (t) => {
  mockerAudit(t);
  const appels = [
    ['patch', '/:id/valider', 'valider', { version: 2 }],
    ['patch', '/:id/rejeter', 'rejeter', { motifRejet: 'x', version: 2 }],
    ['patch', '/:id/mettre-en-attente', 'mettreEnAttente', { motif: 'x', version: 2 }],
  ];
  for (const [methode, chemin, methodeService, body] of appels) {
    const serviceMock = t.mock.method(demandeDpaeService, methodeService, async () => {
      throw new demandeDpaeService.ErreurDemandeDejaTraitee('déjà traitée');
    });
    let { res } = await appelerGestionnaire(methode, chemin, { params: { id: '7' }, body });
    assert.equal(res.statut, 409, `${chemin} transition refusée`);

    serviceMock.mock.mockImplementation(async () => {
      throw new demandeDpaeService.ErreurDemandeModifiee();
    });
    ({ res } = await appelerGestionnaire(methode, chemin, { params: { id: '7' }, body }));
    assert.equal(res.statut, 409, `${chemin} version obsolète`);
    assert.deepEqual(res.corps, { erreur: 'Cette demande a été modifiée entre-temps. Rechargez-la.' });

    serviceMock.mock.mockImplementation(async () => {
      throw new demandeDpaeService.ErreurDemandeIntrouvable('introuvable');
    });
    ({ res } = await appelerGestionnaire(methode, chemin, { params: { id: '7' }, body }));
    assert.equal(res.statut, 404, `${chemin} introuvable`);
  }
});

test('PATCH /:id/valider et /:id/rejeter : version obligatoire (400 sinon), transmise au service avec l’auteur et l’IP', async (t) => {
  mockerAudit(t);
  const validerMock = t.mock.method(demandeDpaeService, 'valider', async () => {});
  const rejeterMock = t.mock.method(demandeDpaeService, 'rejeter', async () => {});

  for (const body of [{}, { version: 0 }, { version: 'x' }]) {
    const { res } = await appelerGestionnaire('patch', '/:id/valider', { params: { id: '7' }, body });
    assert.equal(res.statut, 400, JSON.stringify(body));
  }
  for (const body of [{ motifRejet: 'x' }, { version: 1 }, { motifRejet: '  ', version: 1 }]) {
    const { res } = await appelerGestionnaire('patch', '/:id/rejeter', { params: { id: '7' }, body });
    assert.equal(res.statut, 400, JSON.stringify(body));
  }
  assert.equal(validerMock.mock.calls.length + rejeterMock.mock.calls.length, 0);

  let { res } = await appelerGestionnaire('patch', '/:id/valider', { params: { id: '7' }, body: { version: '3' }, utilisateurId: 9 });
  assert.equal(res.statut, 204);
  assert.deepEqual(validerMock.mock.calls[0].arguments.slice(1), [7, 9, { version: 3, adresseIp: '127.0.0.1' }]);

  ({ res } = await appelerGestionnaire('patch', '/:id/rejeter', { params: { id: '7' }, body: { motifRejet: ' Doublon ', version: 3 }, utilisateurId: 9 }));
  assert.equal(res.statut, 204);
  assert.deepEqual(rejeterMock.mock.calls[0].arguments.slice(1), [7, 9, 'Doublon', { version: 3, adresseIp: '127.0.0.1' }]);
});

test('Schéma de la mise en attente : exporté, motif nettoyé et obligatoire, version obligatoire', () => {
  const { miseEnAttenteBodySchema } = dpaeRouter;
  assert.deepEqual(miseEnAttenteBodySchema.parse({ motif: '  Pièce manquante ', version: '2' }), { motif: 'Pièce manquante', version: 2 });
  assert.equal(miseEnAttenteBodySchema.safeParse({ motif: '  ', version: 1 }).success, false);
  assert.equal(miseEnAttenteBodySchema.safeParse({ motif: 'x' }).success, false);
});

test('Filtre Statut du tableau de bord : « en_attente » accepté', () => {
  assert.equal(dpaeRouter.filtresTableauDeBordSchema.parse({ statut: 'en_attente' }).statut, 'en_attente');
});

// ---------------------------------------------------------------------------------------------
// Notes d'une demande DPAE.
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

// ---------------------------------------------------------------------------------------------
// Téléchargement PDF — GET /:id/pdf (une demande) et POST /export-pdf (ZIP). Mêmes
// règles d'accès que la fiche GET /:id ; journal_audit comme l'export ZIP des pièces.
// ---------------------------------------------------------------------------------------------
const { PassThrough } = require('node:stream');
const pdfDemandeDpae = require('../../core/dpae/pdfDemandeDpae');

const ROLES_CONSULTATION_DPAE = ['admin', 'rh', 'planning', 'inspecteur_hotellerie'];
const ROLES_SANS_DPAE = ['accueil_coordination', 'formateur', 'inspecteur'];

function demandeFiche(id, surcharges = {}) {
  return {
    id,
    statut: 'envoyee',
    type_demande: 'nouvelle_embauche',
    salarie_nom: `NOM${id}`,
    salarie_prenom: 'Léa',
    salarie_deja_employe: false,
    date_creation: new Date('2026-09-30T12:34:07Z'),
    demandeur_id: 9,
    demandeur_nom: 'Durand',
    demandeur_prenom: 'Paul',
    sites_affectation: [{ id: 51, nom: 'MONGE', initiales: 'MG' }],
    ...surcharges,
  };
}

// Réponse factice qui est aussi un flux (le ZIP y est « pipé ») : en-têtes et corps enregistrés.
function reponseTelechargement() {
  const res = new PassThrough();
  const morceaux = [];
  res.on('data', (morceau) => morceaux.push(morceau));
  res.termine = new Promise((resoudre) => res.on('end', resoudre));
  Object.assign(res, { statut: 200, corps: null, nomFichier: null, typeContenu: null });
  res.status = (code) => {
    res.statut = code;
    return res;
  };
  res.json = (corps) => {
    res.corps = corps;
    return res;
  };
  res.attachment = (nom) => {
    res.nomFichier = nom;
    return res;
  };
  res.type = (type) => {
    res.typeContenu = type;
    return res;
  };
  res.send = (contenu) => {
    res.end(contenu);
    return res;
  };
  res.contenu = () => Buffer.concat(morceaux);
  return res;
}

async function telecharger(methode, chemin, { params = {}, body, roleCode = 'rh', utilisateurId = 9 }) {
  const res = reponseTelechargement();
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

// Noms des fichiers d'une archive ZIP, lus dans son répertoire central (aucune dépendance de
// décompression dans ce projet).
function nomsEntreesZip(zip) {
  const finRepertoire = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const nombre = zip.readUInt16LE(finRepertoire + 10);
  let position = zip.readUInt32LE(finRepertoire + 16);
  const noms = [];
  for (let i = 0; i < nombre; i += 1) {
    const longueurNom = zip.readUInt16LE(position + 28);
    noms.push(zip.subarray(position + 46, position + 46 + longueurNom).toString('utf8'));
    position += 46 + longueurNom + zip.readUInt16LE(position + 30) + zip.readUInt16LE(position + 32);
  }
  return noms;
}

test('Téléchargement PDF (fiche et ZIP) : Admin, RH, Planning, Inspecteur Hôtellerie autorisés ; tout autre rôle -> 403', () => {
  for (const [methode, chemin] of [['get', '/:id/pdf'], ['post', '/export-pdf']]) {
    for (const roleCode of ROLES_CONSULTATION_DPAE) {
      assert.equal(executerGarde(gardeRoute(methode, chemin), roleCode).autorise, true, `${roleCode} ${chemin}`);
    }
    for (const roleCode of ROLES_SANS_DPAE) {
      assert.deepEqual(executerGarde(gardeRoute(methode, chemin), roleCode), { autorise: false, statut: 403 }, `${roleCode} ${chemin}`);
    }
  }
});

test('Téléchargement PDF : mêmes rôles que la fiche GET /:id (garde identique)', () => {
  for (const roleCode of [...ROLES_CONSULTATION_DPAE, ...ROLES_SANS_DPAE]) {
    const fiche = executerGarde(gardeRoute('get', '/:id'), roleCode).autorise;
    assert.equal(executerGarde(gardeRoute('get', '/:id/pdf'), roleCode).autorise, fiche, roleCode);
    assert.equal(executerGarde(gardeRoute('post', '/export-pdf'), roleCode).autorise, fiche, roleCode);
  }
});

test('GET /:id/pdf autorisé : PDF « DPAE <n°> - <NOM> <Prénom>.pdf », téléchargement tracé dans journal_audit', async (t) => {
  const audit = mockerAudit(t);
  t.mock.method(demandeDpaeService, 'obtenirDemande', async (_entite, id) => demandeFiche(id));
  for (const roleCode of ROLES_CONSULTATION_DPAE) {
    audit.mock.resetCalls();
    const { res, erreurTransmise } = await telecharger('get', '/:id/pdf', { params: { id: '36' }, roleCode, utilisateurId: 4 });
    assert.equal(erreurTransmise, null);
    assert.equal(res.statut, 200, roleCode);
    assert.equal(res.typeContenu, 'application/pdf');
    assert.equal(res.nomFichier, 'DPAE 36 - NOM36 Léa.pdf');
    await res.termine;
    assert.equal(res.contenu().subarray(0, 5).toString(), '%PDF-');
    assert.equal(audit.mock.callCount(), 1);
    assert.deepEqual(audit.mock.calls[0].arguments[1], {
      utilisateurId: 4,
      entiteId: 1,
      action: 'demande_dpae_export_pdf',
      tableCible: 'demandes_dpae',
      cibleId: 36,
      donnees: {},
      adresseIp: '127.0.0.1',
    });
  }
});

test('GET /:id/pdf hors périmètre : demande non consultable -> 403, demande d’une autre entité -> 404 (comme la fiche) ; aucun PDF, rien de tracé', async (t) => {
  const audit = mockerAudit(t);
  const generation = t.mock.method(pdfDemandeDpae, 'genererPdfDemande');
  t.mock.method(demandeDpaeService, 'obtenirDemande', async (_entite, id) => demandeFiche(id));
  t.mock.method(demandeDpaeService, 'peutConsulterDemande', () => false);
  const refuse = await telecharger('get', '/:id/pdf', { params: { id: '36' } });
  assert.equal(refuse.res.statut, 403);
  assert.equal(refuse.res.nomFichier, null);

  demandeDpaeService.obtenirDemande.mock.mockImplementation(async () => {
    throw new demandeDpaeService.ErreurDemandeIntrouvable('Demande DPAE "36" introuvable.');
  });
  const autreEntite = await telecharger('get', '/:id/pdf', { params: { id: '36' } });
  assert.equal(autreEntite.res.statut, 404);
  assert.equal(autreEntite.res.nomFichier, null);

  assert.equal(generation.mock.callCount(), 0);
  assert.equal(audit.mock.callCount(), 0);
});

test('POST /export-pdf : ZIP « Demandes DPAE - <date du jour>.zip », un PDF par demande, téléchargement tracé', async (t) => {
  const audit = mockerAudit(t);
  t.mock.method(demandeDpaeService, 'obtenirDemande', async (_entite, id) =>
    demandeFiche(id, id === 40 ? { salarie_nom: 'AB/CD', salarie_prenom: 'Éva' } : {}),
  );
  const { res, erreurTransmise } = await telecharger('post', '/export-pdf', { body: { demandeIds: [36, 40, 36, 41] }, roleCode: 'planning' });
  await res.termine;
  assert.equal(erreurTransmise, null);
  assert.equal(res.statut, 200);
  assert.equal(res.typeContenu, 'application/zip');
  assert.equal(res.nomFichier, `Demandes DPAE - ${dpaeRouter.dateDuJourPourNomFichier(new Date())}.zip`);
  assert.match(res.nomFichier, /^Demandes DPAE - \d{2}-\d{2}-\d{4}\.zip$/);
  // Doublon (36) ignoré ; « / » d'un nom remplacé comme dans l'export ZIP des pièces.
  assert.deepEqual(nomsEntreesZip(res.contenu()), ['DPAE 36 - NOM36 Léa.pdf', 'DPAE 40 - AB-CD Éva.pdf', 'DPAE 41 - NOM41 Léa.pdf']);
  assert.equal(audit.mock.callCount(), 1);
  assert.deepEqual(audit.mock.calls[0].arguments[1], {
    utilisateurId: 9,
    entiteId: 1,
    action: 'demandes_dpae_export_pdf_zip',
    tableCible: 'demandes_dpae',
    cibleId: 0,
    donnees: { demandeIds: [36, 40, 41], nombreDemandes: 3 },
    adresseIp: '127.0.0.1',
  });
});

test('POST /export-pdf : une seule demande hors périmètre (autre entité, ou non consultable) -> 403 pour toute la requête, aucun ZIP, rien de tracé', async (t) => {
  const audit = mockerAudit(t);
  const generation = t.mock.method(pdfDemandeDpae, 'genererPdfDemande');
  t.mock.method(demandeDpaeService, 'obtenirDemande', async (_entite, id) => {
    if (id === 99) throw new demandeDpaeService.ErreurDemandeIntrouvable(`Demande DPAE "${id}" introuvable.`);
    return demandeFiche(id);
  });
  const autreEntite = await telecharger('post', '/export-pdf', { body: { demandeIds: [36, 99, 41] } });
  assert.equal(autreEntite.res.statut, 403);
  assert.match(autreEntite.res.corps.erreur, /n° 99 hors de votre périmètre/);
  assert.equal(autreEntite.res.nomFichier, null);
  assert.equal(autreEntite.res.contenu().length, 0);

  t.mock.method(demandeDpaeService, 'peutConsulterDemande', ({ demande }) => demande.id !== 41);
  const nonConsultable = await telecharger('post', '/export-pdf', { body: { demandeIds: [36, 41] } });
  assert.equal(nonConsultable.res.statut, 403);
  assert.equal(nonConsultable.res.nomFichier, null);

  assert.equal(generation.mock.callCount(), 0);
  assert.equal(audit.mock.callCount(), 0);
});

test('POST /export-pdf : au-delà de 50 demandes -> 400 avec un message clair ; 50 acceptées ; liste vide refusée', async (t) => {
  const audit = mockerAudit(t);
  const service = t.mock.method(demandeDpaeService, 'obtenirDemandesPourExport', async (_entite, ids) => ids.map((id) => demandeFiche(id)));
  t.mock.method(pdfDemandeDpae, 'genererPdfDemande', async () => Buffer.from('%PDF-1.3'));
  assert.equal(dpaeRouter.LIMITE_DEMANDES_PAR_ZIP, 50);
  const ids = (n) => Array.from({ length: n }, (_, i) => i + 1);

  const tropNombreuses = await telecharger('post', '/export-pdf', { body: { demandeIds: ids(51) } });
  assert.equal(tropNombreuses.res.statut, 400);
  assert.equal(
    tropNombreuses.res.corps.erreur,
    '51 demandes sélectionnées : le téléchargement est limité à 50 demandes par fichier ZIP. Réduisez la sélection.',
  );
  assert.equal(service.mock.callCount(), 0);
  assert.equal(tropNombreuses.res.nomFichier, null);

  const cinquante = await telecharger('post', '/export-pdf', { body: { demandeIds: ids(50) } });
  await cinquante.res.termine;
  assert.equal(nomsEntreesZip(cinquante.res.contenu()).length, 50);

  const vide = await telecharger('post', '/export-pdf', { body: { demandeIds: [] } });
  assert.equal(vide.res.statut, 400);
  assert.equal(audit.mock.callCount(), 1);
});
