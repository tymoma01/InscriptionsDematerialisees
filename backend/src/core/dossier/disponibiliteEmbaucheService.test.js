const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const dossierRepository = require('./dossierRepository');
const disponibiliteEmbaucheRepository = require('./disponibiliteEmbaucheRepository');
const journalAudit = require('../audit/journalAudit');
const disponibiliteEmbaucheService = require('./disponibiliteEmbaucheService');

const ENTITE = { id: 1, code: 'accecit' };
const TRX_FACTICE = { estUnTrx: true };

// db.obtenirKnex() n'est jamais déstructuré dans disponibiliteEmbaucheService.js (voir son
// commentaire d'en-tête) : mocker `db.obtenirKnex` directement atteint bien le module, même
// précaution documentée dans dossierService.test.js pour l'écueil inverse (déstructuration).
function mockerKnex(t) {
  t.mock.method(db, 'obtenirKnex', async () => ({ transaction: async (callback) => callback(TRX_FACTICE) }));
}

const DOSSIER_VALIDE_PRET_EMBAUCHE = {
  id: 128,
  statut_code: 'valide_pret_embauche',
  statut_libelle: 'Validé - prêt à l’embauche',
  donnees_disponibilites: { disponibiliteImmediate: true, dateDebut: '', dateFin: '' },
};

function mockerDependancesBase(t, overrides = {}) {
  t.mock.method(
    dossierRepository,
    'trouverDossierAvecStatutParId',
    overrides.trouverDossierAvecStatutParId ?? (async () => DOSSIER_VALIDE_PRET_EMBAUCHE),
  );
  t.mock.method(
    disponibiliteEmbaucheRepository,
    'trouverDerniereCorrection',
    overrides.trouverDerniereCorrection ?? (async () => null),
  );
  const enregistrerCorrectionMock = t.mock.method(
    disponibiliteEmbaucheRepository,
    'enregistrerCorrection',
    overrides.enregistrerCorrection ??
      (async (trx, donnees) => [{ id: 1, date_debut: donnees.dateDebut, date_fin: donnees.dateFin, commentaire: donnees.commentaire, created_at: '2026-09-28T10:00:00.000Z' }]),
  );
  const enregistrerActionMock = t.mock.method(journalAudit, 'enregistrerAction', async () => {});
  return { enregistrerCorrectionMock, enregistrerActionMock };
}

test('corrigerDisponibiliteEmbauche rejette un commentaire vide (ZodError)', async (t) => {
  mockerKnex(t);
  mockerDependancesBase(t);

  await assert.rejects(
    () =>
      disponibiliteEmbaucheService.corrigerDisponibiliteEmbauche(
        ENTITE,
        128,
        { dateDebut: '2026-10-15', dateFin: '', commentaire: '   ' },
        { utilisateurId: 9, adresseIp: '127.0.0.1' },
      ),
    /commentaire est obligatoire/,
  );
});

test('corrigerDisponibiliteEmbauche rejette une date de début manquante (ZodError)', async (t) => {
  mockerKnex(t);
  mockerDependancesBase(t);

  await assert.rejects(
    () =>
      disponibiliteEmbaucheService.corrigerDisponibiliteEmbauche(
        ENTITE,
        128,
        { dateDebut: '', dateFin: '', commentaire: 'Confirmé par téléphone' },
        { utilisateurId: 9, adresseIp: '127.0.0.1' },
      ),
    /date de début est obligatoire/,
  );
});

test('corrigerDisponibiliteEmbauche rejette une date de fin antérieure à la date de début (contrôle serveur)', async (t) => {
  mockerKnex(t);
  mockerDependancesBase(t);

  await assert.rejects(
    () =>
      disponibiliteEmbaucheService.corrigerDisponibiliteEmbauche(
        ENTITE,
        128,
        { dateDebut: '2026-10-15', dateFin: '2026-10-01', commentaire: 'Confirmé par téléphone' },
        { utilisateurId: 9, adresseIp: '127.0.0.1' },
      ),
    /date de fin ne peut pas être antérieure/,
  );
});

test('corrigerDisponibiliteEmbauche accepte une date de fin ÉGALE à la date de début (borne incluse)', async (t) => {
  mockerKnex(t);
  const { enregistrerCorrectionMock } = mockerDependancesBase(t);

  await assert.doesNotReject(() =>
    disponibiliteEmbaucheService.corrigerDisponibiliteEmbauche(
      ENTITE,
      128,
      { dateDebut: '2026-10-15', dateFin: '2026-10-15', commentaire: 'Un seul jour' },
      { utilisateurId: 9, adresseIp: '127.0.0.1' },
    ),
  );
  assert.equal(enregistrerCorrectionMock.mock.calls.length, 1);
});

test('corrigerDisponibiliteEmbauche accepte une date de fin absente (disponibilité sans fin connue)', async (t) => {
  mockerKnex(t);
  const { enregistrerCorrectionMock } = mockerDependancesBase(t);

  await disponibiliteEmbaucheService.corrigerDisponibiliteEmbauche(
    ENTITE,
    128,
    { dateDebut: '2026-10-15', dateFin: '', commentaire: 'Pas de fin connue' },
    { utilisateurId: 9, adresseIp: '127.0.0.1' },
  );
  assert.equal(enregistrerCorrectionMock.mock.calls[0].arguments[1].dateFin, null);
});

test("corrigerDisponibiliteEmbauche rejette un dossier qui n'est pas au statut valide_pret_embauche", async (t) => {
  mockerKnex(t);
  mockerDependancesBase(t, {
    trouverDossierAvecStatutParId: async () => ({ ...DOSSIER_VALIDE_PRET_EMBAUCHE, statut_code: 'test_planifie', statut_libelle: 'Test planifié' }),
  });

  await assert.rejects(
    () =>
      disponibiliteEmbaucheService.corrigerDisponibiliteEmbauche(
        ENTITE,
        128,
        { dateDebut: '2026-10-15', dateFin: '', commentaire: 'RAS' },
        { utilisateurId: 9, adresseIp: '127.0.0.1' },
      ),
    (erreur) => erreur instanceof disponibiliteEmbaucheService.ErreurDisponibiliteEmbaucheInvalide && /prêt à l'embauche/.test(erreur.message),
  );
});

test('corrigerDisponibiliteEmbauche renvoie undefined (jamais une exception) pour un dossier introuvable — la route traduit ça en 404', async (t) => {
  mockerKnex(t);
  mockerDependancesBase(t, { trouverDossierAvecStatutParId: async () => undefined });

  const resultat = await disponibiliteEmbaucheService.corrigerDisponibiliteEmbauche(
    ENTITE,
    999,
    { dateDebut: '2026-10-15', dateFin: '', commentaire: 'RAS' },
    { utilisateurId: 9, adresseIp: '127.0.0.1' },
  );
  assert.equal(resultat, undefined);
});

test('corrigerDisponibiliteEmbauche écrit une entrée journal_audit avec ancienne (déclaration) et nouvelle période, dans la MÊME transaction', async (t) => {
  mockerKnex(t);
  const { enregistrerActionMock } = mockerDependancesBase(t, {
    trouverDossierAvecStatutParId: async () => ({
      ...DOSSIER_VALIDE_PRET_EMBAUCHE,
      donnees_disponibilites: { disponibiliteImmediate: false, dateDebut: '2026-01-01', dateFin: '2026-02-01' },
    }),
  });

  await disponibiliteEmbaucheService.corrigerDisponibiliteEmbauche(
    ENTITE,
    128,
    { dateDebut: '2026-10-15', dateFin: '2026-11-30', commentaire: 'Confirmé par téléphone' },
    { utilisateurId: 9, adresseIp: '127.0.0.1' },
  );

  assert.equal(enregistrerActionMock.mock.calls.length, 1);
  const [trxRecu, donneesAppel] = enregistrerActionMock.mock.calls[0].arguments;
  assert.equal(trxRecu, TRX_FACTICE, 'doit écrire dans la même transaction que la correction');
  assert.equal(donneesAppel.action, 'disponibilite_embauche_corrigee');
  assert.equal(donneesAppel.tableCible, 'disponibilites_embauche_corrigees');
  assert.equal(donneesAppel.utilisateurId, 9);
  assert.equal(donneesAppel.adresseIp, '127.0.0.1');
  assert.deepEqual(donneesAppel.donnees, {
    dossierId: 128,
    dateDebutAvant: '2026-01-01',
    dateFinAvant: '2026-02-01',
    dateDebutApres: '2026-10-15',
    dateFinApres: '2026-11-30',
    commentaire: 'Confirmé par téléphone',
  });
});

test("corrigerDisponibiliteEmbauche calcule l'ancienne période à partir de la DERNIÈRE correction déjà existante, pas de la déclaration d'origine, quand une correction précédente existe", async (t) => {
  mockerKnex(t);
  const { enregistrerActionMock } = mockerDependancesBase(t, {
    trouverDerniereCorrection: async () => ({ date_debut: '2026-05-01', date_fin: null, commentaire: 'Première correction' }),
  });

  await disponibiliteEmbaucheService.corrigerDisponibiliteEmbauche(
    ENTITE,
    128,
    { dateDebut: '2026-10-15', dateFin: '2026-11-30', commentaire: 'Deuxième correction' },
    { utilisateurId: 9, adresseIp: '127.0.0.1' },
  );

  const donneesAppel = enregistrerActionMock.mock.calls[0].arguments[1].donnees;
  assert.equal(donneesAppel.dateDebutAvant, '2026-05-01');
  assert.equal(donneesAppel.dateFinAvant, null);
});

// La déclaration d'origine du candidat (bloc 'disponibilites', dossier_donnees_formulaire) n'est
// JAMAIS modifiée par ce service — garantie structurelle, pas seulement comportementale :
// disponibiliteEmbaucheService.js n'importe même pas dossierRepository.mettreAJourDonneesBloc/
// enregistrerDonneesBloc (seule dossierService.modifierInscription, chemin totalement distinct,
// les appelle). Rien à mocker/vérifier à l'exécution : c'est structurellement impossible d'y
// écrire depuis ce fichier.
test("corrigerDisponibiliteEmbauche n'importe aucune fonction d'écriture du bloc 'disponibilites' (garantie structurelle, pas seulement comportementale)", () => {
  const codeSource = require('fs').readFileSync(require.resolve('./disponibiliteEmbaucheService.js'), 'utf8');
  assert.doesNotMatch(codeSource, /mettreAJourDonneesBloc|enregistrerDonneesBloc/);
});
