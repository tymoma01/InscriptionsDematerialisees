// Tests du script de rétablissement des rendez-vous annulés à tort par la synchronisation Outlook
// (incident 2026-09-30/10-01). Aucune base requise : l'accès aux données et la lecture Outlook sont
// remplacés par des doublures en mémoire. Hors du glob de `npm test` (comme
// reparerRendezvousEvaluesRemplaces.test.js) : node --test scripts/retablirRendezvousAnnulesSync.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const graphMailProvider = require('../src/integrations/notifications/graphMailProvider');
const allMySmsProvider = require('../src/integrations/notifications/allMySmsProvider');
const {
  RENDEZVOUS_CIBLES,
  ACTION_JOURNAL_AUDIT,
  RAISON_JOURNAL_AUDIT,
  construireNote,
  executerRetablissement,
} = require('./retablirRendezvousAnnulesSync');

const SORTIE_MUETTE = { log: () => {}, error: () => {} };

// Base en mémoire reproduisant le cas réel du dossier #135 (rendez-vous #122).
function creerEtat({ colonne072 = true, ...surcharges } = {}) {
  return {
    colonne072,
    rendezvous: {
      id: 122,
      dossier_id: 135,
      statut: 'annule',
      type_rdv: 'test',
      date_heure: '2026-10-02T07:30:00.000Z',
      outlook_event_id: 'AAMk-anni-122',
      outlook_calendrier: 'adeville@accecit.com',
      motif_code: 'annule_depuis_outlook',
      entite_id: 1,
      statut_dossier: 'test_non_realise',
      ...surcharges,
    },
    dateAnnulationSync: '2026-09-30T09:00:04.644Z',
    journal: [],
    historique: [],
    notes: [],
  };
}

function creerAcces(etat) {
  const contexte = () => ({
    rendezvous: { ...etat.rendezvous },
    dateAnnulationSync: etat.dateAnnulationSync,
    dejaRetabli: etat.journal.some((l) => l.action === ACTION_JOURNAL_AUDIT && l.cibleId === etat.rendezvous.id),
    rendezvousTestPlusRecent: false,
  });
  return {
    colonneBoiteExiste: async () => etat.colonne072,
    chargerContexte: async () => contexte(),
    resoudreUtilisateurSysteme: async () => 99,
    resoudreStatutId: async () => 30,
    enTransaction: async (fn) =>
      fn({
        chargerContexte: async () => contexte(),
        retablir: async ({ contexte: c, utilisateurSystemeId, statutTestPlanifieId }) => {
          etat.rendezvous.statut = 'prevu';
          etat.rendezvous.motif_code = null;
          etat.rendezvous.statut_dossier = 'test_planifie';
          etat.historique.push({ statutId: statutTestPlanifieId, utilisateurId: utilisateurSystemeId });
          etat.journal.push({ action: ACTION_JOURNAL_AUDIT, cibleId: c.rendezvous.id, raison: RAISON_JOURNAL_AUDIT });
          etat.notes.push(construireNote(c.rendezvous, c.dateAnnulationSync));
        },
      }),
  };
}

const PRESENT = async () => ({ etat: 'present', debutIso: '2026-10-02T07:30:00.0000000Z', annule: false });

async function lancer(t, etat, { appliquer, lireEvenement = PRESENT }) {
  const lecture = t.mock.fn(lireEvenement);
  const resultat = await executerRetablissement({ acces: creerAcces(etat), lireEvenement: lecture, appliquer, cibles: [122], sortie: SORTIE_MUETTE });
  return { resultat, lecture };
}

test('Cibles figées : rendez-vous #122 (dossier #135), #126 (#139), #135 (#132)', () => {
  assert.deepEqual(RENDEZVOUS_CIBLES, [122, 126, 135]);
});

test('Simulation : signale le rendez-vous comme rétablissable, vérifie Outlook dans SA boîte, n’écrit rien', async (t) => {
  const etat = creerEtat();
  const { resultat, lecture } = await lancer(t, etat, { appliquer: false });
  assert.equal(resultat.eligibles.length, 1);
  assert.equal(resultat.appliques, 0);
  assert.deepEqual(lecture.mock.calls[0].arguments, ['adeville@accecit.com', 'AAMk-anni-122']);
  assert.equal(etat.rendezvous.statut, 'annule');
  assert.equal(etat.journal.length + etat.historique.length + etat.notes.length, 0);
});

test('Application : rendez-vous « prevu » sans motif, dossier « test_planifie » par le compte système, trace et note', async (t) => {
  const etat = creerEtat();
  const { resultat } = await lancer(t, etat, { appliquer: true });
  assert.equal(resultat.appliques, 1);
  assert.equal(etat.rendezvous.statut, 'prevu');
  assert.equal(etat.rendezvous.motif_code, null);
  assert.equal(etat.rendezvous.statut_dossier, 'test_planifie');
  assert.deepEqual(etat.historique, [{ statutId: 30, utilisateurId: 99 }]);
  assert.equal(etat.journal[0].raison, 'annulation automatique erronée (synchronisation Outlook, calendrier personnel)');
  assert.deepEqual(etat.notes, ["Rendez-vous du 02/10 rétabli : l'annulation automatique du 30/09/2026 à 11:00 était une erreur de synchronisation."]);
});

test('Relance après application : ne fait rien de plus (aucune nouvelle trace, aucune relecture Outlook)', async (t) => {
  const etat = creerEtat();
  await lancer(t, etat, { appliquer: true });
  const { resultat, lecture } = await lancer(t, etat, { appliquer: true });
  assert.equal(resultat.appliques, 0);
  assert.equal(lecture.mock.callCount(), 0);
  assert.equal(etat.journal.length, 1);
  assert.equal(etat.historique.length, 1);
  assert.equal(etat.notes.length, 1);
});

test('Refus si la colonne de la migration 072 est absente : aucune lecture Outlook, aucune écriture', async (t) => {
  const etat = creerEtat({ colonne072: false });
  for (const appliquer of [false, true]) {
    const { resultat, lecture } = await lancer(t, etat, { appliquer });
    assert.equal(resultat.refuse, true);
    assert.equal(lecture.mock.callCount(), 0);
  }
  assert.equal(etat.rendezvous.statut, 'annule');
  assert.equal(etat.journal.length, 0);
});

for (const [cas, lecture] of [
  ['introuvable', async () => ({ etat: 'introuvable' })],
  ['annulé dans Outlook', async () => ({ etat: 'present', debutIso: '2026-10-02T07:30:00.0000000Z', annule: true })],
  ['lecture impossible (403)', async () => ({ etat: 'erreur', message: '403 ErrorAccessDenied' })],
  ['à un autre horaire', async () => ({ etat: 'present', debutIso: '2026-10-02T09:00:00.0000000Z', annule: false })],
]) {
  test(`Événement Outlook ${cas} : rendez-vous NON touché, même avec --appliquer`, async (t) => {
    const etat = creerEtat();
    const { resultat } = await lancer(t, etat, { appliquer: true, lireEvenement: lecture });
    assert.equal(resultat.appliques, 0);
    assert.equal(etat.rendezvous.statut, 'annule');
    assert.equal(etat.journal.length + etat.historique.length + etat.notes.length, 0);
  });
}

for (const [cas, surcharges] of [
  ['annulé pour un autre motif (pas par la synchronisation)', { motif_code: 'candidat_desiste' }],
  ['dossier qui n’est plus « Test non réalisé »', { statut_dossier: 'test_planifie' }],
  ['rendez-vous qui n’est pas annulé', { statut: 'prevu' }],
]) {
  test(`Hors périmètre — ${cas} : rendez-vous non touché, Outlook même pas interrogé`, async (t) => {
    const etat = creerEtat(surcharges);
    const { resultat, lecture } = await lancer(t, etat, { appliquer: true });
    assert.equal(resultat.appliques, 0);
    assert.equal(lecture.mock.callCount(), 0);
  });
}

test('Aucun courriel ni SMS : ni le fournisseur email (Graph) ni le fournisseur SMS (AllMySMS) ne sont appelés', async (t) => {
  const email = t.mock.method(graphMailProvider, 'envoyer', async () => {});
  const sms = t.mock.method(allMySmsProvider, 'envoyer', async () => {});
  await lancer(t, creerEtat(), { appliquer: false });
  await lancer(t, creerEtat(), { appliquer: true });
  assert.equal(email.mock.callCount(), 0);
  assert.equal(sms.mock.callCount(), 0);
});

test('Le script ne charge aucun module de notification et n’écrit jamais dans Outlook (lecture GET uniquement)', () => {
  const source = fs.readFileSync(path.join(__dirname, 'retablirRendezvousAnnulesSync.js'), 'utf8');
  const requires = [...source.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);
  assert.equal(requires.some((r) => /notification|invitationTest|rappel|relance/i.test(r)), false, requires.join(', '));
  assert.doesNotMatch(source, /\.(post|patch|put|delete)\(/);
  assert.doesNotMatch(source, /creerEvenement|supprimerEvenement/);
});
