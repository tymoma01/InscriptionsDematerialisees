const test = require('node:test');
const assert = require('node:assert/strict');
const knex = require('knex');

const db = require('../../db/knex');
const siteAffectationRepository = require('./siteAffectationRepository');
const siteAffectationService = require('./siteAffectationService');
const demandeDpaeService = require('./demandeDpaeService');
const demandeDpaeRepository = require('./demandeDpaeRepository');
const { genererPdfDemande, sectionsDemande, recapitulatif } = require('./pdfDemandeDpae');
const formulaireTertiaire = require('./formulaireTertiaire');
const { CONFIG_TERTIAIRE } = require('../../db/migrations/096_formulaire_dpae_tertiaire');

const ENTITE = { id: 1, code: 'accecit', dpae_config: { tertiaire: CONFIG_TERTIAIRE } };
const bd = knex({ client: 'pg' });

// --- Sites du Tertiaire -------------------------------------------------------------------------------
test('Nom proche : casse, accents et espaces ignorés = identique ; une faute de frappe = proche ; sinon aucun', () => {
  const sites = [{ nom: 'Tour Horizon' }, { nom: 'Gare de l’Est' }, { nom: 'Bâtiment A' }];
  assert.equal(siteAffectationService.trouverSitesProches(sites, '  tour   HORIZON ').identique, true);
  assert.equal(siteAffectationService.trouverSitesProches(sites, 'Batiment a').identique, true);
  const proche = siteAffectationService.trouverSitesProches(sites, 'Tour Horizo');
  assert.equal(proche.identique, false);
  assert.deepEqual(proche.sitesProches, [{ nom: 'Tour Horizon' }]);
  assert.deepEqual(siteAffectationService.trouverSitesProches(sites, 'Centre commercial'), { sitesProches: [], identique: false });
  // Noms courts : pas de rapprochement sur une faute de frappe (trop de faux positifs).
  assert.equal(siteAffectationService.trouverSitesProches([{ nom: 'B55' }], 'B56').sitesProches.length, 0);
});

function monterSites(t, existants = []) {
  t.mock.method(db, 'obtenirKnex', async () => ({ transaction: async (callback) => callback({}) }));
  t.mock.method(siteAffectationRepository, 'listerSitesGestion', async () => existants);
  return t.mock.method(siteAffectationRepository, 'creerSite', async (_bd, valeurs) => ({ id: 90, nom: valeurs.nom, initiales: null, adresse: valeurs.adresse }));
}

test('Création d’un site du Tertiaire : secteur Tertiaire, adresse facultative, auteur enregistré', async (t) => {
  const creer = monterSites(t);
  const site = await siteAffectationService.creerSiteTertiaire(ENTITE, { nom: 'Tour Horizon', adresse: null, creeParId: 4 });
  assert.equal(site.id, 90);
  assert.deepEqual(creer.mock.calls[0].arguments[1], { entiteId: 1, nom: 'Tour Horizon', adresse: null, secteur: 'tertiaire', creeParId: 4 });
});

test('Création : un nom identique à un site existant (même désactivé) est refusé avec le site à choisir ; un nom proche l’est jusqu’à confirmation', async (t) => {
  const creer = monterSites(t, [{ id: 5, nom: 'Tour Horizon', actif: false }]);
  await assert.rejects(
    () => siteAffectationService.creerSiteTertiaire(ENTITE, { nom: 'tour horizon', creeParId: 4 }),
    (e) => e instanceof siteAffectationService.ErreurSiteProche && e.identique === true && e.sitesProches[0].id === 5 && /Choisissez-le plutôt/.test(e.message),
  );
  await assert.rejects(
    () => siteAffectationService.creerSiteTertiaire(ENTITE, { nom: 'Tour Horizo', creeParId: 4 }),
    (e) => e instanceof siteAffectationService.ErreurSiteProche && e.identique === false,
  );
  assert.equal(creer.mock.callCount(), 0);
  await siteAffectationService.creerSiteTertiaire(ENTITE, { nom: 'Tour Horizo', creeParId: 4, confirmerProche: true });
  assert.equal(creer.mock.callCount(), 1);
});

test('Site réutilisé : proposé tant qu’il est actif, dans le secteur Tertiaire seulement ; valide pour une demande suivante', async () => {
  const liste = siteAffectationRepository.listerSitesActifs(bd, 1, 'tertiaire').toString();
  assert.match(liste, /"actif" = true/);
  assert.match(liste, /"secteur" = 'tertiaire'/);
  const hotel = siteAffectationRepository.listerSitesActifs(bd, 1).toString();
  assert.match(hotel, /"secteur" = 'hotellerie'/);
  // Validation d'une demande : filtre sur l'état actif et le secteur (requête enregistrée par un faux trx).
  const enregistre = [];
  const chaine = { where: (filtre) => (enregistre.push(filtre), chaine), whereIn: () => chaine, select: () => Promise.resolve([{ id: 4 }]) };
  assert.deepEqual(await siteAffectationRepository.listerIdsSitesValides(() => chaine, 1, [4, 5], 'tertiaire'), [4]);
  assert.deepEqual(enregistre[0], { entite_id: 1, actif: true, secteur: 'tertiaire' });
});

test('Site désactivé : plus proposé, mais toujours affiché sur les anciennes demandes', () => {
  // Les sites d'une demande ne sont filtrés ni sur l'état ni sur le secteur.
  for (const sql of [siteAffectationRepository.listerSitesDemande(bd, 7).toString(), siteAffectationRepository.listerSitesParDemandes(bd, [7, 8]).toString()]) {
    assert.doesNotMatch(sql, /"actif"/);
    assert.doesNotMatch(sql, /"secteur"/);
  }
});

test('Une demande du Tertiaire n’accepte que des sites actifs du Tertiaire (et inversement pour l’Hôtellerie)', async (t) => {
  const valides = t.mock.method(siteAffectationRepository, 'listerIdsSitesValides', async () => []);
  t.mock.method(db, 'obtenirKnex', async () => ({ transaction: async (callback) => callback({}) }));
  await assert.rejects(
    () => demandeDpaeService.creerEtEnvoyer(ENTITE, 2, { salarieNom: 'M', salariePrenom: 'L', division: 'tertiaire', sitesAffectationIds: [10] }, { roleCode: 'planning_tertiaire' }),
    (e) => e instanceof demandeDpaeService.ErreurSitesAffectationInvalides && /hors des sites du Tertiaire/.test(e.message),
  );
  assert.equal(valides.mock.calls[0].arguments[3], 'tertiaire');
  await assert.rejects(() => demandeDpaeService.creerEtEnvoyer(ENTITE, 2, { salarieNom: 'M', salariePrenom: 'L', division: 'hotellerie', sitesAffectationIds: [10] }, { roleCode: 'planning' }));
  assert.equal(valides.mock.calls[1].arguments[3], 'hotellerie');
});

function monterRenommage(t, sites) {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(siteAffectationRepository, 'trouverSite', async (_bd, _e, id) => ({ ...sites.find((site) => site.id === id) }));
  t.mock.method(siteAffectationRepository, 'listerSitesGestion', async () => sites.filter((site) => site.secteur === 'tertiaire'));
  return t.mock.method(siteAffectationRepository, 'mettreAJourSite', async (_bd, _e, id, valeurs) => {
    Object.assign(sites.find((site) => site.id === id), valeurs);
  });
}

test('Renommage : refusé si le nom est identique OU très proche d’un autre site (casse, accents, espaces ignorés), accepté sinon', async (t) => {
  const sites = [
    { id: 1, nom: 'Tour Horizon', secteur: 'tertiaire' },
    { id: 2, nom: 'Gare Nord', secteur: 'tertiaire' },
    { id: 3, nom: 'Hôtel', secteur: 'hotellerie' },
  ];
  const maj = monterRenommage(t, sites);
  await assert.rejects(() => siteAffectationService.renommerSiteTertiaire(ENTITE, 1, { nom: ' GARE   nord ' }), (e) => e instanceof siteAffectationService.ErreurSiteAffectationDoublon && /existe déjà/.test(e.message));
  await assert.rejects(() => siteAffectationService.renommerSiteTertiaire(ENTITE, 1, { nom: 'Gare Nor' }), /très proche/);
  await assert.rejects(() => siteAffectationService.renommerSiteTertiaire(ENTITE, 3, { nom: 'Autre' }), siteAffectationService.ErreurSiteIntrouvable);
  assert.equal(maj.mock.callCount(), 0);
  // Un site peut changer la casse de son propre nom.
  assert.deepEqual(await siteAffectationService.renommerSiteTertiaire(ENTITE, 1, { nom: 'TOUR HORIZON' }), { avant: { nom: 'Tour Horizon' }, apres: { nom: 'TOUR HORIZON' } });
  assert.deepEqual(await siteAffectationService.renommerSiteTertiaire(ENTITE, 1, { nom: 'Centre Nord' }), { avant: { nom: 'TOUR HORIZON' }, apres: { nom: 'Centre Nord' } });
});

test('Renommage : le nouveau nom s’applique à une demande existante et à son PDF (les demandes référencent le site par son identifiant)', async (t) => {
  const sites = [{ id: 51, nom: 'Tour Horizon', initiales: null, secteur: 'tertiaire' }];
  monterRenommage(t, sites);
  t.mock.method(demandeDpaeRepository, 'trouverDemandeParId', async () => demandeTertiaire({ sites_affectation: undefined }));
  t.mock.method(siteAffectationRepository, 'listerSitesDemande', async () => sites.map(({ id, nom, initiales }) => ({ id, nom, initiales })));
  const avant = await demandeDpaeService.obtenirDemande(ENTITE, 52);
  assert.equal(valeur(sectionsDemande(avant), 'Salarié et contrat', 'Site(s) d’affectation'), 'Tour Horizon');

  await siteAffectationService.renommerSiteTertiaire(ENTITE, 51, { nom: 'Tour Horizon Nord' });

  const apres = await demandeDpaeService.obtenirDemande(ENTITE, 52);
  assert.equal(valeur(sectionsDemande(apres), 'Salarié et contrat', 'Site(s) d’affectation'), 'Tour Horizon Nord');
  assert.equal(apres.sites_affectation[0].id, 51);
  assert.equal((await genererPdfDemande(apres)).subarray(0, 5).toString(), '%PDF-');
});

// --- Fiche et PDF du Tertiaire ------------------------------------------------------------------------
function demandeTertiaire(surcharges = {}) {
  return {
    id: 52,
    statut: 'envoyee',
    division: 'tertiaire',
    type_demande: 'nouvelle_embauche',
    salarie_nom: 'MARTIN',
    salarie_prenom: 'Léa',
    type_contrat: 'cdd',
    motif_cdd: 'remplacement_absent',
    salarie_remplace_nom: 'Paul DURAND',
    motif_absence: 'Congé maladie',
    poste: 'chef_equipe',
    categorie_qualification: 'chef_equipe',
    echelon: 'CE2',
    qualification_libelle: 'Chef d’équipe - CE2',
    motif_cdd_libelle: 'Remplacement d’un salarié',
    libelle_date_debut: 'Date d’embauche (ou journée de doublon)',
    date_debut: new Date('2026-11-01T23:00:00Z'),
    date_fin: new Date('2026-12-01T23:00:00Z'),
    semaine_type: [{ jour: 'lundi', statut: 'travail', heureDebut: '08:00', heureFin: '16:00', pauseMinutes: 60, siteIds: [51] }],
    sites_affectation: [{ id: 51, nom: 'Tour Horizon', initiales: null }],
    date_creation: new Date('2026-10-30T12:00:00Z'),
    demandeur_nom: 'Durand',
    demandeur_prenom: 'Paul',
    ...surcharges,
  };
}
const valeur = (sections, titre, libelle) => sections.find((s) => s.titre === titre)?.lignes.find(([l]) => l === libelle)?.[1];

test('Fiche et PDF du Tertiaire : sections dans l’ordre du formulaire, qualification « Catégorie - Échelon », remplacement détaillé', () => {
  const sections = sectionsDemande(demandeTertiaire());
  assert.deepEqual(sections.map((s) => s.titre), ['Demande', 'Salarié et contrat', 'Semaine type']);
  // Ordre du bloc : nom, prénom, embauche, fin, contrat, motif, qualification, sites.
  assert.deepEqual(sections[1].lignes.map(([libelle]) => libelle), ['Nom', 'Prénom', 'Date d’embauche (ou journée de doublon)', 'Date de fin', 'Type de contrat', 'Motif du CDD', 'Catégorie - Échelon', 'Site(s) d’affectation']);
  assert.equal(valeur(sections, 'Salarié et contrat', 'Catégorie - Échelon'), 'Chef d’équipe - CE2');
  assert.equal(valeur(sections, 'Salarié et contrat', 'Motif du CDD'), 'Remplacement de Paul DURAND - Congé maladie');
  assert.equal(valeur(sections, 'Salarié et contrat', 'Date d’embauche (ou journée de doublon)'), '02/11/2026');
  assert.equal(valeur(sections, 'Salarié et contrat', 'Date de fin'), '02/12/2026');
  assert.equal(valeur(sections, 'Salarié et contrat', 'Site(s) d’affectation'), 'Tour Horizon');
  assert.deepEqual(sections.find((s) => s.titre === 'Semaine type').tableau[0].slice(0, 3), ['Lundi', 'de 08h00 à 16h00', '1h00']);
  assert.equal(recapitulatif(demandeTertiaire())[1][1], 'Chef d’équipe - CE2');
});

test('Fiche du Tertiaire : CDD de surcroît, CDI sans date de fin', () => {
  const surcroit = sectionsDemande(demandeTertiaire({ motif_cdd: 'surcroit_activite', motif_cdd_libelle: 'Surcroît d’activité', salarie_remplace_nom: null, motif_absence: null }));
  assert.equal(valeur(surcroit, 'Salarié et contrat', 'Motif du CDD'), 'Surcroît d’activité');
  const cdi = sectionsDemande(demandeTertiaire({ type_contrat: 'cdi', motif_cdd: null, date_fin: null }));
  assert.equal(valeur(cdi, 'Salarié et contrat', 'Date de fin'), '–');
  assert.equal(cdi.find((s) => s.titre === 'Salarié et contrat').lignes.some(([l]) => l === 'Motif du CDD'), false);
});

test('Ancienne demande du Tertiaire sans ces champs : « – », sans erreur (fiche et PDF)', async () => {
  const ancienne = demandeTertiaire({ poste: 'nettoyage', categorie_qualification: null, echelon: null, qualification_libelle: null, motif_absence: null, salarie_remplace_nom: null, motif_cdd: null, motif_cdd_libelle: null, type_contrat: 'cdd', sites_affectation: [], hotel: null });
  const sections = sectionsDemande(ancienne);
  assert.equal(valeur(sections, 'Salarié et contrat', 'Catégorie - Échelon'), '–');
  assert.equal(valeur(sections, 'Salarié et contrat', 'Motif du CDD'), '–');
  assert.equal(valeur(sections, 'Salarié et contrat', 'Site(s) d’affectation'), '–');
  const pdf = await genererPdfDemande(ancienne);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});

test('PDF du Tertiaire généré', async () => {
  const pdf = await genererPdfDemande(demandeTertiaire());
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 1000);
});

test('PDF et fiche de l’Hôtellerie inchangés : mêmes sections qu’avant, « Poste » et « Échelon »', () => {
  const hotel = demandeTertiaire({ division: 'hotellerie', poste: 'equipier', echelon: 'AS', type_contrat: 'cdi', sites_affectation: [{ id: 51, nom: 'MONGE', initiales: 'MG' }], motif_cdd: null });
  const titres = sectionsDemande(hotel).map((s) => s.titre);
  assert.deepEqual(titres, ['Demande', 'Salarié', 'Contrat', 'Semaine type']);
  assert.equal(valeur(sectionsDemande(hotel), 'Salarié', "Sites d'affectation"), 'MONGE (MG)');
  assert.equal(valeur(sectionsDemande(hotel), 'Contrat', 'Échelon'), 'AS');
});

test('obtenirDemande : libellés du Tertiaire issus de la configuration (qualification, motif du CDD, libellé de la date d’embauche)', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(demandeDpaeRepository, 'trouverDemandeParId', async () => ({ id: 52, division: 'tertiaire', statut: 'envoyee', poste: 'agent_maitrise', echelon: 'MP2', motif_cdd: 'surcroit_activite' }));
  t.mock.method(siteAffectationRepository, 'listerSitesDemande', async () => []);
  const demande = await demandeDpaeService.obtenirDemande(ENTITE, 52);
  assert.equal(demande.qualification_libelle, 'Agent de maîtrise - MP2');
  assert.equal(demande.motif_cdd_libelle, 'Surcroît d’activité');
  assert.equal(demande.libelle_date_debut, 'Date d’embauche (ou journée de doublon)');

  demandeDpaeRepository.trouverDemandeParId.mock.mockImplementation(async () => ({ id: 53, division: 'hotellerie', statut: 'envoyee', poste: 'equipier' }));
  assert.equal((await demandeDpaeService.obtenirDemande(ENTITE, 53)).qualification_libelle, undefined);
});

test('Libellé de qualification : ancienne catégorie (poste d’avant) ou catégorie inconnue -> null', () => {
  assert.equal(formulaireTertiaire.libelleQualification(ENTITE, { poste: 'nettoyage', echelon: null }), null);
  assert.equal(formulaireTertiaire.libelleQualification(ENTITE, { categorie_qualification: 'agent_service', echelon: 'AS3' }), 'Agent de service - AS3');
});
