const test = require('node:test');
const assert = require('node:assert/strict');

const {
  genererPdfDemande,
  sectionsDemande,
  statutEtDate,
  sousMarqueDemande,
  nomFichierPdf,
} = require('./pdfDemandeDpae');

// Demande telle que la renvoie demandeDpaeService.obtenirDemande (colonnes `date` : Date à minuit
// heure de Paris ; horodatages : instants UTC).
function demande(surcharges = {}) {
  return {
    id: 37,
    statut: 'validee',
    type_demande: 'nouvelle_embauche',
    salarie_nom: 'MARTIN',
    salarie_prenom: 'Léa',
    salarie_telephone: '0612345678',
    salarie_deja_employe: false,
    hotel: null,
    type_contrat: 'cdd',
    motif_cdd: 'surcroit_activite',
    salarie_remplace_nom: null,
    date_fin_absence: null,
    raison_surcroit: 'Salon',
    division: null,
    division_autre: null,
    poste: 'equipier',
    poste_autre: null,
    date_debut: new Date('2026-10-09T22:00:00Z'),
    date_fin: null,
    heure_arrivee_j1: '08:00:00',
    heures_par_mois: '151.67',
    modifications_demandees: false,
    jours_concernes: [],
    semaine_type: [],
    autre_chose_signaler: null,
    motif_rejet: null,
    motif_mise_en_attente: null,
    date_mise_en_attente: null,
    date_creation: new Date('2026-09-30T12:34:07Z'),
    date_traitement: new Date('2026-09-30T15:48:43Z'),
    demandeur_nom: 'Durand',
    demandeur_prenom: 'Paul',
    traitant_nom: 'Leroy',
    traitant_prenom: 'Anne',
    // Champs NON affichés par la fiche : ne doivent jamais apparaître dans le PDF.
    verif_besoin_hotel: true,
    candidat_id: 812,
    dossier_id: 140,
    demandeur_id: 9,
    sites_affectation: [{ id: 51, nom: 'MONGE', initiales: 'MG' }],
    ...surcharges,
  };
}

const QUATRE_SITES = [
  { id: 51, nom: 'MONGE', initiales: 'MG' },
  { id: 52, nom: 'NOVOTEL PARIS GARE DE LYON', initiales: 'NGL' },
  { id: 53, nom: 'IBIS STYLES BERCY', initiales: 'ISB' },
  { id: 54, nom: 'MERCURE PORTE DE VERSAILLES EXPO', initiales: 'MPV' },
];

const section = (sections, titre) => sections.find((s) => s.titre === titre);

test('Sections : mêmes sections et mêmes champs que la fiche, dans le même ordre, dates à l’heure de Paris', () => {
  const sections = sectionsDemande(demande());
  assert.deepEqual(sections.map((s) => s.titre), ['Demande', 'Salarié', 'Contrat', 'Semaine type']);
  assert.deepEqual(section(sections, 'Demande').lignes, [
    ['Type', 'Nouvelle embauche'],
    ['Reçue le', '30/09/2026 14:34'],
    ['Demandée par', 'Paul Durand'],
    ['Traitée le', '30/09/2026 17:48 par Anne Leroy'],
  ]);
  assert.deepEqual(section(sections, 'Contrat').lignes, [
    ['Type de contrat', 'CDD'],
    ['Motif CDD', "Surcroît d'activité"],
    ['Raison du surcroît', 'Salon'],
    ['Poste', 'Équipier'],
    ['Premier jour', '10/10/2026'],
    ['Heure d’arrivée jour 1', '08:00:00'],
    ['Heures/mois', '151.67'],
  ]);
  assert.deepEqual(section(sections, 'Semaine type'), { titre: 'Semaine type', lignes: [], texte: 'Aucun jour de travail renseigné.' });
});

test('Sections : aucune donnée absente de la fiche (vérifications, candidat, dossier, identifiants)', () => {
  const texte = JSON.stringify(sectionsDemande(demande()));
  for (const absent of ['812', '140', 'verif', 'Vérif', 'candidat']) assert.ok(!texte.includes(absent), absent);
});

test("Sections : 4 sites d'affectation, tous présents « NOM (INITIALES) », un par ligne", () => {
  const [libelle, valeur] = section(sectionsDemande(demande({ sites_affectation: QUATRE_SITES })), 'Salarié').lignes[2];
  assert.equal(libelle, "Sites d'affectation");
  assert.deepEqual(valeur.split('\n'), [
    'MONGE (MG)',
    'NOVOTEL PARIS GARE DE LYON (NGL)',
    'IBIS STYLES BERCY (ISB)',
    'MERCURE PORTE DE VERSAILLES EXPO (MPV)',
  ]);
});

test("Sections : demande antérieure au référentiel -> « Site d'affectation » = ancien texte libre, comme la fiche", () => {
  const lignes = section(sectionsDemande(demande({ sites_affectation: [], hotel: 'Hôtel du Parc' })), 'Salarié').lignes;
  assert.deepEqual(lignes.at(-1), ["Site d'affectation", 'Hôtel du Parc']);
});

test('Sections conditionnelles : mêmes conditions que la fiche (rejet, attente, modifications, jours, semaine, autre chose)', () => {
  const rejetee = sectionsDemande(demande({ statut: 'rejetee', motif_rejet: 'Doublon' }));
  assert.deepEqual(section(rejetee, 'Demande').lignes.at(-1), ['Motif de rejet', 'Doublon']);

  const enAttente = sectionsDemande(
    demande({ statut: 'en_attente', date_traitement: null, date_mise_en_attente: new Date('2026-10-01T14:20:00Z'), motif_mise_en_attente: 'Client' }),
  );
  assert.deepEqual(section(enAttente, 'Demande').lignes.slice(-2), [
    ['Mise en attente le', '01/10/2026 16:20'],
    ['Motif de mise en attente', 'Client'],
  ]);

  const complete = sectionsDemande(
    demande({
      type_demande: 'ajout_retrait_jours',
      type_changement_jours: 'retirer',
      jours_concernes: [{ date: '2026-10-12' }, { date: '' }],
      modifications_demandees: true,
      modification_horaires: true,
      modification_jours_repos: false,
      semaine_type: [
        { jour: 'lundi', statut: 'travail', heureDebut: '08:00', heureFin: '15:00' },
        { jour: 'mardi', statut: 'repos' },
        { jour: 'samedi', statut: 'travail' },
      ],
      autre_chose_signaler: 'Badge à prévoir',
    }),
  );
  assert.deepEqual(complete.map((s) => s.titre), [
    'Demande', 'Salarié', 'Contrat', 'Modifications demandées', 'Gestion des jours', 'Semaine type', 'Autre chose à signaler',
  ]);
  assert.deepEqual(section(complete, 'Modifications demandées').lignes, [['Horaires', 'Oui']]);
  assert.deepEqual(section(complete, 'Gestion des jours').lignes, [['Type', 'Retirer des jours'], ['Jours concernés', '12/10/2026']]);
  assert.deepEqual(section(complete, 'Semaine type').liste, ['Lundi : 08:00 – 15:00', 'Samedi']);
  assert.equal(section(complete, 'Autre chose à signaler').texte, 'Badge à prévoir');
});

test('Statut et sa date : réception, mise en attente, traitement', () => {
  assert.deepEqual(statutEtDate(demande({ statut: 'envoyee', date_traitement: null })), { libelle: 'À traiter', date: '30/09/2026 14:34' });
  assert.deepEqual(statutEtDate(demande({ statut: 'en_attente', date_mise_en_attente: new Date('2026-10-01T14:20:00Z') })), {
    libelle: 'En attente',
    date: '01/10/2026 16:20',
  });
  assert.deepEqual(statutEtDate(demande()), { libelle: 'Validée', date: '30/09/2026 17:48' });
  assert.deepEqual(statutEtDate(demande({ statut: 'rejetee' })), { libelle: 'Rejetée', date: '30/09/2026 17:48' });
});

test("Logo : ACCHOT -> sous-marque Hôtellerie ; RM, Autre ou non renseigné -> logo ACCECIT général (jamais deviné)", () => {
  assert.equal(sousMarqueDemande(demande({ division: 'acchot' })), 'hotellerie');
  for (const division of ['rm', 'autre', null, undefined]) assert.equal(sousMarqueDemande(demande({ division })), null);
});

test('Nom de fichier : « DPAE <n°> - <NOM> <Prénom>.pdf », « / » et « \\ » remplacés comme dans l’export ZIP des pièces', () => {
  assert.equal(nomFichierPdf(demande()), 'DPAE 37 - MARTIN Léa.pdf');
  assert.equal(nomFichierPdf(demande({ salarie_nom: 'AB/CD', salarie_prenom: 'E\\F' })), 'DPAE 37 - AB-CD E-F.pdf');
});

test('PDF généré : document PDF A4, avec ou sans sous-marque, 4 sites et toutes les sections', async () => {
  for (const division of ['acchot', null]) {
    const pdf = await genererPdfDemande(
      demande({ division, sites_affectation: QUATRE_SITES, modifications_demandees: true, autre_chose_signaler: 'x'.repeat(2000) }),
      { dateGeneration: new Date('2026-10-02T08:45:00Z') },
    );
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.match(pdf.toString('latin1'), /\/MediaBox \[0 0 595\.28 841\.89\]/);
  }
});
