const test = require('node:test');
const assert = require('node:assert/strict');

const PDFDocument = require('pdfkit');
const {
  genererPdfDemande,
  sectionsDemande,
  recapitulatif,
  texteReception,
  textesPiedDePage,
  nomFichierPdf,
  dessinerBandeau,
  largeurMotAccecit,
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
    ['Heure d’arrivée jour 1', '08h00'],
    ['Heures/mois', '151,67 h'],
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
  assert.deepEqual(section(complete, 'Semaine type').tableau, [
    ['Lundi', 'de 08h00 à 15h00', 'Non précisé'],
    ['Samedi', 'Horaires non précisés', 'Non précisé'],
  ]);
  assert.equal(section(complete, 'Autre chose à signaler').texte, 'Badge à prévoir');
});

test('Réception : « Reçue le JJ/MM/AAAA à HH:MM » en heure de Paris', () => {
  assert.equal(texteReception(demande()), 'Reçue le 30/09/2026 à 14:34');
});

test('Encadré récapitulatif : salarié, poste, type de contrat, premier jour ; valeur absente : « Non renseigné »', () => {
  assert.deepEqual(recapitulatif(demande()), [
    ['Salarié', 'Léa MARTIN'],
    ['Poste', 'Équipier'],
    ['Type de contrat', 'CDD'],
    ['Premier jour', '10/10/2026'],
  ]);
  const incomplet = recapitulatif(demande({ poste: null, type_contrat: null, date_debut: null }));
  assert.deepEqual(incomplet.slice(1).map(([, valeur]) => valeur), ['Non renseigné', 'Non renseigné', 'Non renseigné']);
  assert.equal(recapitulatif(demande({ poste: 'autre', poste_autre: 'Voiturier' }))[1][1], 'Voiturier');
});

test('Nom de fichier : « DPAE <n°> - <NOM> <Prénom>.pdf », « / » et « \\ » remplacés comme dans l’export ZIP des pièces', () => {
  assert.equal(nomFichierPdf(demande()), 'DPAE 37 - MARTIN Léa.pdf');
  assert.equal(nomFichierPdf(demande({ salarie_nom: 'AB/CD', salarie_prenom: 'E\\F' })), 'DPAE 37 - AB-CD E-F.pdf');
});

test('PDF généré : document PDF A4, quelle que soit l’entité (même bandeau), 4 sites et toutes les sections', async () => {
  for (const division of ['acchot', 'rm', null]) {
    const pdf = await genererPdfDemande(
      demande({ division, sites_affectation: QUATRE_SITES, modifications_demandees: true, autre_chose_signaler: 'x'.repeat(2000) }),
      { dateGeneration: new Date('2026-10-02T08:45:00Z') },
    );
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.match(pdf.toString('latin1'), /\/MediaBox \[0 0 595\.28 841\.89\]/);
  }
});

test('Pied de page : coordonnées ACCECIT, confidentialité, date de génération (heure de Paris) et pagination', () => {
  assert.deepEqual(textesPiedDePage(new Date('2026-10-02T08:45:00Z'), 2, 3), {
    coordonnees: 'ACCECIT | 47 avenue Paul Vaillant Couturier, 94250 Gentilly | 01 56 56 69 56 | www.accecit.com',
    confidentialite: 'Document confidentiel | usage interne',
    generation: 'PDF généré le 02/10/2026 à 10:45',
    pagination: 'Page 2/3',
  });
});

test('Aucun tiret long ni demi-cadratin dans les textes du PDF (sections, réception, pied de page)', () => {
  const complete = demande({
    statut: 'en_attente',
    date_mise_en_attente: new Date('2026-10-01T14:20:00Z'),
    motif_mise_en_attente: 'Client',
    type_demande: 'ajout_retrait_jours',
    modifications_demandees: true,
    modification_horaires: true,
    semaine_type: [{ jour: 'lundi', statut: 'travail', heureDebut: '08:00', heureFin: '15:00' }],
    autre_chose_signaler: 'Badge',
    sites_affectation: QUATRE_SITES,
  });
  const textes = JSON.stringify([sectionsDemande(complete), texteReception(complete), textesPiedDePage(new Date(), 1, 2)]);
  assert.ok(!textes.includes('—') && !textes.includes('–'), textes);
});

test('Bandeau : le filet sous « ACCECIT » a EXACTEMENT la largeur du mot (lettres et espacements entre elles), pour chaque sous-marque', () => {
  const doc = new PDFDocument({ size: 'A4' });
  const filets = [];
  const lineTo = doc.lineTo.bind(doc);
  let origine = null;
  const moveTo = doc.moveTo.bind(doc);
  doc.moveTo = (x, y) => {
    origine = [x, y];
    return moveTo(x, y);
  };
  doc.lineTo = (x, y) => {
    if (origine && origine[1] === y) filets.push(x - origine[0]);
    return lineTo(x, y);
  };

  dessinerBandeau(doc);

  const attendue = largeurMotAccecit(doc);
  assert.equal(filets.length, 2);
  for (const longueur of filets) assert.ok(Math.abs(longueur - attendue) < 1e-9, `${longueur} != ${attendue}`);
  // Le mot lui-même : largeur des lettres + 6 espacements, sans espacement après la dernière lettre.
  doc.font('Helvetica').fontSize(9);
  assert.ok(Math.abs(attendue - (doc.widthOfString('ACCECIT') + 2.2 * 6)) < 1e-9);
});

test('Une section sans aucune ligne n’est pas affichée (sections vides ignorées) ; demande très longue : plusieurs pages, jamais de page vide', async () => {
  const pdf = await genererPdfDemande(
    demande({ sites_affectation: QUATRE_SITES, autre_chose_signaler: 'mot '.repeat(1800), modifications_demandees: true, modification_horaires: true }),
    { dateGeneration: new Date('2026-10-02T08:45:00Z') },
  );
  const pages = (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
  assert.ok(pages >= 2 && pages <= 4, `pages : ${pages}`);
});

test('Semaine type : colonne « Site » après « Horaires », au format « NOM (INITIALES) » ; « Non précisé » pour une demande sans site par jour', () => {
  const sites = [{ id: 51, nom: 'AIGLON', initiales: 'AIG' }, { id: 52, nom: 'ALBE', initiales: 'AL' }];
  const tableau = section(
    sectionsDemande(
      demande({
        sites_affectation: sites,
        semaine_type: [
          { jour: 'lundi', statut: 'travail', heureDebut: '08:00', heureFin: '15:00', siteId: 51 },
          { jour: 'mardi', statut: 'repos' },
          { jour: 'jeudi', statut: 'travail', heureDebut: '09:00', heureFin: '17:00', siteId: 52 },
          { jour: 'vendredi', statut: 'travail', heureDebut: '09:00', heureFin: '17:00' },
        ],
      }),
    ),
    'Semaine type',
  ).tableau;
  assert.deepEqual(tableau, [
    ['Lundi', 'de 08h00 à 15h00', 'AIGLON (AIG)'],
    ['Jeudi', 'de 09h00 à 17h00', 'ALBE (AL)'],
    ['Vendredi', 'de 09h00 à 17h00', 'Non précisé'],
  ]);
});

test('Contrat : « Nombre total de jours calendaires » à côté du dernier jour, pour un CDD seulement (jours inclus)', () => {
  const lignes = (surcharges) => section(sectionsDemande(demande(surcharges)), 'Contrat').lignes;
  // Du 10/10 au 17/10 (minuit à Paris) : 8 jours.
  const cdd = lignes({ date_fin: new Date('2026-10-16T22:00:00Z') });
  const indice = cdd.findIndex(([libelle]) => libelle === 'Dernier jour');
  assert.deepEqual(cdd[indice], ['Dernier jour', '17/10/2026']);
  assert.deepEqual(cdd[indice + 1], ['Nombre total de jours calendaires', '8 jours']);
  assert.deepEqual(lignes({ date_fin: new Date('2026-10-09T22:00:00Z') }).find(([l]) => l.startsWith('Nombre')), ['Nombre total de jours calendaires', '1 jour']);
  // CDI, ou CDD sans dernier jour : aucune ligne.
  assert.equal(lignes({ type_contrat: 'cdi', date_fin: new Date('2026-10-16T22:00:00Z') }).some(([l]) => l.startsWith('Nombre')), false);
  assert.equal(lignes({ date_fin: null }).some(([l]) => l.startsWith('Nombre')), false);
});

test('PDF généré avec la colonne Site et le nombre de jours : document valide', async () => {
  const pdf = await genererPdfDemande(
    demande({
      sites_affectation: QUATRE_SITES,
      date_fin: new Date('2026-10-16T22:00:00Z'),
      semaine_type: [{ jour: 'lundi', statut: 'travail', heureDebut: '08:00', heureFin: '15:00', siteId: 52 }],
    }),
    { dateGeneration: new Date('2026-10-02T08:45:00Z') },
  );
  assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
});
