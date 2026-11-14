import { describe, expect, it } from 'vitest';
import {
  JOURS_SEMAINE,
  affecterSitesSemaine,
  analyserHeuresParMois,
  donneesFormulaireDepuisDemande,
  divisionDuCandidat,
  donneesApresChangementPoste,
  donneesInitiales,
  echelonsDeLaDivision,
  echelonsDuPoste,
  postesProposes,
  qualificationsTertiaire,
  champsPropresRenseignes,
  donneesApresChangementEntite,
  joursPrivesDeSite,
  validerFormulaire,
} from './formulaireDemandeDpae';

// Demande telle que l'API la renvoie (colonnes en snake_case, date en instant UTC, time en
// 'HH:MM:SS', decimal en chaîne, sites liés).
const DEMANDE = {
  id: 7,
  version: 3,
  statut: 'en_attente',
  type_demande: 'nouvelle_embauche',
  salarie_nom: 'Martin',
  salarie_prenom: 'Sophie',
  salarie_telephone: null,
  salarie_deja_employe: true,
  candidat_id: 12,
  type_contrat: 'cdd',
  motif_cdd: 'remplacement_absent',
  salarie_remplace_nom: 'Durand',
  date_debut: new Date(2026, 9, 12).toISOString(),
  date_fin: new Date(2026, 9, 30).toISOString(),
  heure_arrivee_j1: '07:30:00',
  heures_par_mois: '151.67',
  poste: 'equipier',
  sites_affectation: [
    { id: 10, nom: 'AIGLON', initiales: 'AIG' },
    { id: 11, nom: 'ALBE', initiales: 'AL' },
  ],
  jours_concernes: [{ date: '2026-10-14' }],
  semaine_type: [
    { jour: 'mardi', statut: 'travail', heureDebut: '07:00', heureFin: '15:00' },
    { jour: 'lundi', statut: 'travail', heureDebut: '07:00', heureFin: '15:00' },
  ],
  horaires_differents_par_jour: false,
  verif_besoin_hotel: true,
  verif_tous_jours_inclus: true,
  verif_non_planification: true,
};

describe('donneesFormulaireDepuisDemande', () => {
  const donnees = donneesFormulaireDepuisDemande(DEMANDE);

  it('reprend les champs en camelCase, avec les formes attendues par les champs du formulaire', () => {
    expect(donnees).toMatchObject({
      typeDemande: 'nouvelle_embauche',
      salarieNom: 'Martin',
      salariePrenom: 'Sophie',
      salarieTelephone: '',
      salarieDejaEmploye: true,
      candidatId: 12,
      typeContrat: 'cdd',
      motifCdd: 'remplacement_absent',
      salarieRemplaceNom: 'Durand',
      dateDebut: '2026-10-12',
      dateFin: '2026-10-30',
      heureArriveeJ1: '07:30',
      heuresParMois: '151,67',
      poste: 'equipier',
      sitesAffectationIds: [10, 11],
      joursConcernes: [{ date: '2026-10-14' }],
      verifBesoinHotel: true,
      verifTousJoursInclus: true,
      verifNonPlanification: true,
    });
  });

  it('ramène la semaine type à 7 jours dans l’ordre du formulaire et reprend les heures communes du premier jour travaillé', () => {
    expect(donnees.semaineType.map((jour) => jour.jour)).toEqual(JOURS_SEMAINE.map((jour) => jour.code));
    expect(donnees.semaineType[0]).toEqual({ jour: 'lundi', statut: 'travail', heureDebut: '07:00', heureFin: '15:00', pauseMinutes: 0 });
    expect(donnees.semaineType[2]).toEqual({ jour: 'mercredi', statut: 'repos', heureDebut: '', heureFin: '', pauseMinutes: 0 });
    expect(donnees.heureDebutCommune).toBe('07:00');
    expect(donnees.heureFinCommune).toBe('15:00');
  });

  it('horaires différents par jour : pas d’heures communes', () => {
    const differents = donneesFormulaireDepuisDemande({ ...DEMANDE, horaires_differents_par_jour: true });
    expect(differents.horairesDifferentsParJour).toBe(true);
    expect(differents.heureDebutCommune).toBe('');
  });

  it('la forme d’une demande préremplie est celle d’un formulaire vierge (mêmes champs)', () => {
    expect(Object.keys(donnees).sort()).toEqual(Object.keys(donneesInitiales()).sort());
  });

  it('demande minimale (colonnes absentes ou nulles) : valeurs vides, jamais undefined', () => {
    const vide = donneesFormulaireDepuisDemande({ id: 1, semaine_type: null, jours_concernes: null });
    expect(vide.dateDebut).toBe('');
    expect(vide.heuresParMois).toBe('');
    expect(vide.sitesAffectationIds).toEqual([]);
    expect(vide.semaineType).toHaveLength(7);
    expect(Object.values(vide).includes(undefined)).toBe(false);
  });

  it('nombre décimal sans zéros inutiles', () => {
    expect(donneesFormulaireDepuisDemande({ ...DEMANDE, heures_par_mois: '40.00' }).heuresParMois).toBe('40');
  });
});

const jourTravaille = (jour, siteIds) => ({ jour, statut: 'travail', heureDebut: '08:00', heureFin: '15:00', ...(siteIds ? { siteIds } : {}) });
const jourRepos = (jour, siteIds) => ({ jour, statut: 'repos', heureDebut: '', heureFin: '', ...(siteIds ? { siteIds } : {}) });

describe('affecterSitesSemaine', () => {
  const semaine = [jourTravaille('lundi', [10, 11]), jourRepos('mardi', [10]), jourTravaille('mercredi'), jourTravaille('jeudi', [11])];
  const sitesDe = (resultat) => resultat.map((jour) => jour.siteIds);

  it('un seul site : attribué à tous les jours travaillés, jamais aux jours de repos', () => {
    expect(sitesDe(affecterSitesSemaine(semaine, [12]))).toEqual([[12], undefined, [12], [12]]);
  });

  it('plusieurs sites : les sites choisis sont conservés (plusieurs par jour) ; un jour sans site reste à choisir ; un repos n’en a pas', () => {
    expect(sitesDe(affecterSitesSemaine(semaine, [10, 11]))).toEqual([[10, 11], undefined, undefined, [11]]);
  });

  it('un site retiré de la sélection est retiré des jours qui l’utilisaient ; un jour sans site est signalé', () => {
    const resultat = affecterSitesSemaine(semaine, [11, 12]);
    expect(sitesDe(resultat)).toEqual([[11], undefined, undefined, [11]]);
    expect(joursPrivesDeSite(semaine, resultat, [11, 12])).toEqual([]);
    const sansLeSeulSite = affecterSitesSemaine(semaine, [10, 12]);
    expect(sitesDe(sansLeSeulSite)).toEqual([[10], undefined, undefined, undefined]);
    expect(joursPrivesDeSite(semaine, sansLeSeulSite, [10, 12])).toEqual(['jeudi']);
  });

  it('aucun jour signalé quand il ne reste qu’un site (attribué automatiquement) ou aucun', () => {
    expect(joursPrivesDeSite(semaine, affecterSitesSemaine(semaine, [12]), [12])).toEqual([]);
    expect(joursPrivesDeSite(semaine, affecterSitesSemaine(semaine, []), [])).toEqual([]);
  });

  it('ancienne forme à un seul siteId : lue comme une liste d’un élément', () => {
    const ancienne = [{ jour: 'lundi', statut: 'travail', heureDebut: '', heureFin: '', siteId: 11 }];
    const resultat = affecterSitesSemaine(ancienne, [10, 11]);
    expect(resultat[0].siteIds).toEqual([11]);
    expect('siteId' in resultat[0]).toBe(false);
  });

  it('ne modifie pas la semaine reçue', () => {
    const copie = JSON.parse(JSON.stringify(semaine));
    affecterSitesSemaine(semaine, [12]);
    expect(semaine).toEqual(copie);
  });
});

describe('donneesFormulaireDepuisDemande : sites par jour', () => {
  it('reprend la liste de sites de chaque jour ; une demande sans site par jour reste lisible', () => {
    const avec = donneesFormulaireDepuisDemande({
      ...DEMANDE,
      semaine_type: [{ jour: 'lundi', statut: 'travail', heureDebut: '07:00', heureFin: '15:00', siteIds: [10, 11] }],
    });
    expect(avec.semaineType[0].siteIds).toEqual([10, 11]);
    const sans = donneesFormulaireDepuisDemande(DEMANDE);
    expect(sans.semaineType.every((jour) => !('siteIds' in jour))).toBe(true);
  });

  it('demande enregistrée avec un seul siteId par jour : convertie en liste d’un élément', () => {
    const donnees = donneesFormulaireDepuisDemande({
      ...DEMANDE,
      semaine_type: [{ jour: 'lundi', statut: 'travail', heureDebut: '07:00', heureFin: '15:00', siteId: 11 }],
    });
    expect(donnees.semaineType[0].siteIds).toEqual([11]);
    expect('siteId' in donnees.semaineType[0]).toBe(false);
  });

  it('un seul site : attribué aux jours travaillés dès le chargement', () => {
    const donnees = donneesFormulaireDepuisDemande({ ...DEMANDE, sites_affectation: [{ id: 10, nom: 'AIGLON', initiales: 'AIG' }] });
    expect(donnees.semaineType.filter((jour) => jour.statut === 'travail').every((jour) => jour.siteIds?.[0] === 10)).toBe(true);
    expect(donnees.semaineType.filter((jour) => jour.statut === 'repos').every((jour) => !('siteIds' in jour))).toBe(true);
  });
});

describe('validerFormulaire (mêmes messages que le serveur)', () => {
  const complet = () => ({
    ...donneesInitiales(),
    salarieDejaEmploye: false,
    sitesAffectationIds: [10],
    typeContrat: 'cdi',
    poste: 'equipier',
    dateDebut: '2026-10-12',
  });
  const messages = (donnees) => Object.fromEntries(validerFormulaire(donnees).map(({ champ, message }) => [champ, message]));

  it('formulaire complet (CDI) : aucune erreur', () => {
    expect(validerFormulaire(complet())).toEqual([]);
  });

  it('chaque champ obligatoire manquant a son message ; a déjà travaillé : aucune réponse présélectionnée', () => {
    expect(donneesInitiales().salarieDejaEmploye).toBeNull();
    expect(messages({ ...complet(), salarieDejaEmploye: null })).toEqual({ salarieDejaEmploye: 'Indiquez si le salarié a déjà travaillé chez nous.' });
    expect(messages({ ...complet(), sitesAffectationIds: [] })).toEqual({ sites: "Sélectionnez au moins un site d'affectation avant d'envoyer la demande." });
    expect(messages({ ...complet(), typeContrat: '' })).toEqual({ typeContrat: 'Le type de contrat est obligatoire.' });
    expect(messages({ ...complet(), poste: '' })).toEqual({ poste: 'Le poste est obligatoire.' });
    expect(messages({ ...complet(), dateDebut: '' })).toEqual({ dateDebut: 'Le premier jour est obligatoire.' });
  });

  it('« Oui » et « Non » sont tous deux des réponses valides', () => {
    for (const reponse of [true, false]) expect(validerFormulaire({ ...complet(), salarieDejaEmploye: reponse })).toEqual([]);
  });

  it('CDD : raison du CDD et dernier jour obligatoires ; dernier jour antérieur refusé ; CDI : aucun de ces contrôles', () => {
    const cdd = { ...complet(), typeContrat: 'cdd' };
    expect(messages(cdd)).toEqual({ motifCdd: 'La raison du CDD est obligatoire.', dateFin: 'Le dernier jour est obligatoire pour un CDD.' });
    const avecMotif = { ...cdd, motifCdd: 'surcroit_activite' };
    expect(messages({ ...avecMotif, dateFin: '2026-10-11' })).toEqual({ dateFin: 'Le dernier jour ne peut pas précéder le premier jour.' });
    expect(validerFormulaire({ ...avecMotif, dateFin: '2026-10-12' })).toEqual([]);
    expect(validerFormulaire({ ...avecMotif, dateFin: '2026-10-20' })).toEqual([]);
    expect(validerFormulaire({ ...complet(), motifCdd: '', dateFin: '' })).toEqual([]);
  });

  it('erreurs dans l’ordre du formulaire (la première reçoit le défilement)', () => {
    const vide = { ...donneesInitiales(), typeContrat: 'cdd' };
    expect(validerFormulaire(vide).map((erreur) => erreur.champ)).toEqual(['salarieDejaEmploye', 'sites', 'motifCdd', 'poste', 'dateDebut', 'dateFin']);
  });

  it('sites par jour : un seul site, rien à choisir ; plusieurs sites, au moins un pour chaque jour travaillé (pas pour un repos)', () => {
    const base = complet();
    expect(validerFormulaire({ ...base, semaineType: [jourTravaille('lundi')] })).toEqual([]);
    const plusieurs = { ...base, sitesAffectationIds: [10, 11], semaineType: [jourTravaille('lundi', [10]), jourTravaille('mardi'), jourRepos('mercredi'), jourTravaille('jeudi', [99])] };
    const attendu = 'Au moins un site est obligatoire pour ce jour.';
    expect(messages(plusieurs)).toEqual({ 'semaine:mardi': attendu, 'semaine:jeudi': attendu });
    expect(validerFormulaire({ ...plusieurs, semaineType: [jourTravaille('lundi', [10, 11]), jourTravaille('mardi', [11]), jourRepos('mercredi')] })).toEqual([]);
  });
});

// Formulaire valide de base : un seul jour travaillé, horaires communs.
const formulaireValide = (surcharges = {}) => ({
  ...donneesInitiales(),
  salarieDejaEmploye: false,
  sitesAffectationIds: [10],
  typeContrat: 'cdi',
  poste: 'equipier',
  dateDebut: '2026-10-12',
  ...surcharges,
});
const champsEnErreur = (donnees) => validerFormulaire(donnees).map((erreur) => erreur.champ);
const semaineAvec = (index, champs) => donneesInitiales().semaineType.map((jour, i) => (i === index ? { ...jour, statut: 'travail', ...champs } : jour));

describe('Pause dans la semaine type', () => {
  it('une demande ancienne (sans pause) est lue avec une pause à 0, sans erreur', () => {
    const donnees = donneesFormulaireDepuisDemande(DEMANDE);
    expect(donnees.semaineType.every((jour) => jour.pauseMinutes === 0)).toBe(true);
    expect(donnees.pauseCommuneMinutes).toBe(0);
    expect(validerFormulaire(donnees).some((erreur) => erreur.champ.startsWith('pause'))).toBe(false);
  });

  it('la pause enregistrée est reprise : par jour, et comme pause commune du premier jour travaillé', () => {
    const semaine = [{ jour: 'lundi', statut: 'travail', heureDebut: '08:00', heureFin: '16:00', pauseMinutes: 60 }];
    const donnees = donneesFormulaireDepuisDemande({ ...DEMANDE, semaine_type: semaine });
    expect(donnees.semaineType[0].pauseMinutes).toBe(60);
    expect(donnees.pauseCommuneMinutes).toBe(60);
  });

  it('pause commune plus longue que la journée : refusée avec un message clair ; plus courte : acceptée', () => {
    const base = { semaineType: semaineAvec(0, {}), heureDebutCommune: '08:00', heureFinCommune: '09:00' };
    const refusee = validerFormulaire(formulaireValide({ ...base, pauseCommuneMinutes: 60 }));
    expect(refusee).toEqual([{ champ: 'pause', message: 'La pause doit être inférieure à la durée de la journée.' }]);
    expect(champsEnErreur(formulaireValide({ ...base, pauseCommuneMinutes: 45 }))).toEqual([]);
  });

  it('une pause par jour quand les horaires diffèrent : seul le jour fautif est signalé', () => {
    const semaine = semaineAvec(0, { heureDebut: '08:00', heureFin: '16:00', pauseMinutes: 60 }).map((jour, i) =>
      i === 1 ? { ...jour, statut: 'travail', heureDebut: '08:00', heureFin: '09:00', pauseMinutes: 120 } : jour,
    );
    expect(champsEnErreur(formulaireValide({ horairesDifferentsParJour: true, semaineType: semaine }))).toEqual(['pause:mardi']);
  });
});

describe('Type de contrat « AVENANT »', () => {
  it('accepté sans motif CDD, avec ou sans dernier jour', () => {
    expect(champsEnErreur(formulaireValide({ typeContrat: 'avenant', dateFin: '' }))).toEqual([]);
    expect(champsEnErreur(formulaireValide({ typeContrat: 'avenant', dateFin: '2026-10-30' }))).toEqual([]);
  });

  it('un dernier jour renseigné ne peut pas précéder le premier ; le CDD exige toujours motif et dernier jour', () => {
    expect(champsEnErreur(formulaireValide({ typeContrat: 'avenant', dateFin: '2026-10-01' }))).toEqual(['dateFin']);
    expect(champsEnErreur(formulaireValide({ typeContrat: 'cdd' }))).toEqual(['motifCdd', 'dateFin']);
  });
});

describe('Heures/mois', () => {
  it('virgule et point acceptés, entiers et décimaux à 2 chiffres', () => {
    expect(analyserHeuresParMois('135,67')).toBe(135.67);
    expect(analyserHeuresParMois('135.67')).toBe(135.67);
    expect(analyserHeuresParMois('135')).toBe(135);
    expect(analyserHeuresParMois('')).toBeNull();
  });

  it('3 décimales, valeur négative, nulle ou non numérique : refusées', () => {
    for (const saisie of ['135,678', '-5', '0', 'abc', '1e3']) expect(analyserHeuresParMois(saisie), saisie).toBeNaN();
    expect(champsEnErreur(formulaireValide({ heuresParMois: '135,678' }))).toEqual(['heuresParMois']);
    expect(champsEnErreur(formulaireValide({ heuresParMois: '135,67' }))).toEqual([]);
  });
});

describe('divisionDuCandidat', () => {
  it("prend l'Entité du type de poste recherché par le candidat", () => {
    expect(divisionDuCandidat({ type_poste: 'bureau' }, '')).toBe('tertiaire');
    expect(divisionDuCandidat({ type_poste: 'hotel' }, 'tertiaire')).toBe('hotellerie');
  });

  it("garde l'Entité saisie quand le type de poste est inconnu", () => {
    expect(divisionDuCandidat({ type_poste: null }, 'autre')).toBe('autre');
    expect(divisionDuCandidat({}, '')).toBe('');
  });
});

describe('Échelon selon le poste', () => {
  const ECHELONS = {
    autre: ['AS', 'ATQS', 'CE1', 'CE2', 'CE3', 'MP1'],
    femme_valet_chambre: ['AS'],
    equipier: ['AS', 'ATQS'],
    gouvernant: ['CE1', 'CE2', 'CE3', 'MP1'],
    cafetier: ['AS'],
  };
  const base = { ...donneesInitiales(), salarieDejaEmploye: true, sitesAffectationIds: [1], typeContrat: 'cdi', dateDebut: '2026-10-12' };
  const champs = (donnees) => validerFormulaire(donnees, ECHELONS).map(({ champ }) => champ);

  it('liste les échelons de chaque poste, aucun pour les autres', () => {
    expect(echelonsDuPoste(ECHELONS, 'gouvernant')).toEqual(['CE1', 'CE2', 'CE3', 'MP1']);
    expect(echelonsDuPoste(ECHELONS, 'autre')).toHaveLength(6);
    expect(echelonsDuPoste(ECHELONS, 'plongeur')).toEqual([]);
    expect(echelonsDuPoste(undefined, 'equipier')).toEqual([]);
  });

  it('présélectionne l\'échelon unique et réinitialise sinon', () => {
    expect(donneesApresChangementPoste({ ...base, echelon: 'CE2' }, 'cafetier', ECHELONS).echelon).toBe('AS');
    expect(donneesApresChangementPoste({ ...base, echelon: 'AS' }, 'equipier', ECHELONS).echelon).toBe('');
    expect(donneesApresChangementPoste({ ...base, echelon: 'AS' }, 'autre', ECHELONS).echelon).toBe('');
    expect(donneesApresChangementPoste({ ...base, echelon: 'AS' }, 'plongeur', ECHELONS).echelon).toBe('');
  });

  it('exige un échelon de la liste quand le poste en a, rien sinon', () => {
    expect(champs({ ...base, poste: 'gouvernant' })).toEqual(['echelon']);
    expect(champs({ ...base, poste: 'equipier', echelon: 'CE1' })).toEqual(['echelon']);
    expect(champs({ ...base, poste: 'equipier', echelon: 'ATQS' })).toEqual([]);
    expect(champs({ ...base, poste: 'autre' })).toEqual(['echelon']);
    expect(champs({ ...base, poste: 'autre', echelon: 'MP1' })).toEqual([]);
    expect(champs({ ...base, poste: 'plongeur' })).toEqual([]);
  });

  it('relit l\'échelon d\'une demande, vide pour une demande sans échelon', () => {
    expect(donneesFormulaireDepuisDemande({ ...DEMANDE, echelon: 'CE3' }).echelon).toBe('CE3');
    expect(donneesFormulaireDepuisDemande(DEMANDE).echelon).toBe('');
  });
});

describe('qualification du Tertiaire et postes de l’Hôtellerie', () => {
  const configuration = {
    echelonsParPoste: { equipier: ['AS'] },
    tertiaire: {
      qualifications: [
        { code: 'agent_service', libelle: 'Agent de service', echelons: ['AS1', 'AS2', 'AS3'] },
        { code: 'chef_equipe', libelle: 'Chef d’équipe', echelons: ['CE1', 'CE2', 'CE3'] },
      ],
    },
  };

  it('postes de l’Hôtellerie inchangés', () => {
    expect(postesProposes('hotellerie').map((poste) => poste.code)).toEqual(['femme_valet_chambre', 'cafetier', 'equipier', 'gouvernant', 'autre']);
  });

  it('Tertiaire : catégories et échelons lus dans la configuration de l’entité ; Hôtellerie : échelons des postes', () => {
    expect(qualificationsTertiaire(configuration).map((q) => q.libelle)).toEqual(['Agent de service', 'Chef d’équipe']);
    expect(echelonsDuPoste(echelonsDeLaDivision(configuration, 'tertiaire'), 'chef_equipe')).toEqual(['CE1', 'CE2', 'CE3']);
    expect(echelonsDeLaDivision(configuration, 'hotellerie')).toEqual({ equipier: ['AS'] });
    // Configuration vide : aucune catégorie, section « Échelon » masquée.
    expect(qualificationsTertiaire({})).toEqual([]);
    expect(echelonsDeLaDivision({}, 'tertiaire')).toEqual({});
  });

  it('complétable sans toucher au code : un échelon ajouté à la configuration est proposé', () => {
    const etendue = { tertiaire: { qualifications: [{ code: 'agent_service', libelle: 'Agent de service', echelons: ['AS1', 'AS4'] }] } };
    expect(echelonsDuPoste(echelonsDeLaDivision(etendue, 'tertiaire'), 'agent_service')).toEqual(['AS1', 'AS4']);
  });
});

describe('validerFormulaire : formulaire du Tertiaire', () => {
  const echelons = { agent_service: ['AS1', 'AS2'], chef_equipe: ['CE1'] };
  const base = () => ({ ...donneesInitiales(), salarieNom: 'Martin', salariePrenom: 'Léa', salarieDejaEmploye: false, sitesAffectationIds: [4], typeContrat: 'cdi', dateDebut: '2026-11-02', poste: 'agent_service', echelon: 'AS1' });
  const champs = (donnees) => validerFormulaire(donnees, echelons, { tertiaire: true }).map((erreur) => erreur.champ);

  it('CDI complet : sans date de fin ni motif', () => {
    expect(champs(base())).toEqual([]);
  });

  it('CDD : date de fin et motif obligatoires, date de fin pas avant l’embauche', () => {
    expect(champs({ ...base(), typeContrat: 'cdd' })).toEqual(['dateFin', 'motifCdd']);
    const surcroit = { ...base(), typeContrat: 'cdd', motifCdd: 'surcroit_activite', dateFin: '2026-12-02' };
    expect(champs(surcroit)).toEqual([]);
    expect(champs({ ...surcroit, dateFin: '2026-11-01' })).toEqual(['dateFin']);
  });

  it('remplacement : nom du salarié remplacé ET motif d’absence obligatoires, 100 caractères au plus', () => {
    const remplacement = { ...base(), typeContrat: 'cdd', motifCdd: 'remplacement_absent', dateFin: '2026-12-02' };
    expect(champs(remplacement)).toEqual(['salarieRemplaceNom', 'motifAbsence']);
    expect(champs({ ...remplacement, salarieRemplaceNom: 'Paul', motifAbsence: 'Congé' })).toEqual([]);
    expect(champs({ ...remplacement, salarieRemplaceNom: 'x'.repeat(101), motifAbsence: 'y'.repeat(101) })).toEqual(['salarieRemplaceNom', 'motifAbsence']);
  });

  it('site obligatoire, catégorie obligatoire puis échelon obligatoire (si la catégorie en a)', () => {
    expect(champs({ ...base(), sitesAffectationIds: [] })).toEqual(['sites']);
    expect(champs({ ...base(), poste: '', echelon: '' })).toEqual(['poste']);
    expect(champs({ ...base(), echelon: '' })).toEqual(['echelon']);
    expect(champs({ ...base(), poste: 'chef_equipe', echelon: 'AS1' })).toEqual(['echelon']);
  });

  it('le formulaire de l’Hôtellerie garde ses règles (avenant accepté, question « déjà employé » obligatoire)', () => {
    const hotel = { ...donneesInitiales(), sitesAffectationIds: [4], typeContrat: 'avenant', dateDebut: '2026-11-02', poste: 'equipier', salarieDejaEmploye: null };
    expect(validerFormulaire(hotel, {}).map((e) => e.champ)).toEqual(['salarieDejaEmploye']);
  });
});

describe('changement d’entité', () => {
  const rempli = () => ({
    ...donneesInitiales(),
    salarieNom: 'Martin',
    salariePrenom: 'Léa',
    dateDebut: '2026-11-02',
    typeDemande: 'prolongation',
    typeContrat: 'cdd',
    motifCdd: 'remplacement_absent',
    salarieRemplaceNom: 'Paul',
    motifAbsence: 'Congé',
    poste: 'equipier',
    echelon: 'AS',
    sitesAffectationIds: [4, 5],
    semaineType: donneesInitiales().semaineType.map((jour, index) => (index === 0 ? { ...jour, statut: 'travail', heureDebut: '08:00', heureFin: '16:00', siteIds: [4] } : jour)),
  });

  it('formulaire vierge : rien de propre à l’entité renseigné (pas de confirmation) ; dès qu’un champ l’est : confirmation', () => {
    expect(champsPropresRenseignes({ ...donneesInitiales(), salarieNom: 'Martin', dateDebut: '2026-11-02' })).toBe(false);
    for (const champ of [{ typeDemande: 'prolongation' }, { typeContrat: 'cdi' }, { poste: 'equipier' }, { sitesAffectationIds: [4] }]) {
      expect(champsPropresRenseignes({ ...donneesInitiales(), ...champ }), JSON.stringify(champ)).toBe(true);
    }
    // Type de demande imposé (Tertiaire) : prérempli, il ne compte pas comme saisie.
    expect(champsPropresRenseignes({ ...donneesInitiales(), typeDemande: 'nouvelle_embauche' }, true)).toBe(false);
  });

  it('réinitialise type de demande, contrat et motifs, poste/qualification, échelon et sites ; garde identité, dates et horaires', () => {
    const resultat = donneesApresChangementEntite(rempli(), 'tertiaire');
    expect(resultat).toMatchObject({ division: 'tertiaire', typeDemande: '', typeContrat: '', motifCdd: '', salarieRemplaceNom: '', motifAbsence: '', poste: '', echelon: '', sitesAffectationIds: [] });
    expect(resultat).toMatchObject({ salarieNom: 'Martin', salariePrenom: 'Léa', dateDebut: '2026-11-02' });
    const lundi = resultat.semaineType[0];
    expect(lundi).toMatchObject({ statut: 'travail', heureDebut: '08:00', heureFin: '16:00' });
    expect(lundi.siteIds).toBeUndefined();
  });
});
