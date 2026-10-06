import { describe, expect, it } from 'vitest';
import {
  JOURS_SEMAINE,
  affecterSitesSemaine,
  donneesFormulaireDepuisDemande,
  donneesInitiales,
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
      heuresParMois: '151.67',
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
    expect(donnees.semaineType[0]).toEqual({ jour: 'lundi', statut: 'travail', heureDebut: '07:00', heureFin: '15:00' });
    expect(donnees.semaineType[2]).toEqual({ jour: 'mercredi', statut: 'repos', heureDebut: '', heureFin: '' });
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

const jourTravaille = (jour, siteId) => ({ jour, statut: 'travail', heureDebut: '08:00', heureFin: '15:00', ...(siteId ? { siteId } : {}) });
const jourRepos = (jour, siteId) => ({ jour, statut: 'repos', heureDebut: '', heureFin: '', ...(siteId ? { siteId } : {}) });

describe('affecterSitesSemaine', () => {
  const semaine = [jourTravaille('lundi', 10), jourRepos('mardi', 10), jourTravaille('mercredi'), jourTravaille('jeudi', 11)];

  it('un seul site : attribué à tous les jours travaillés, jamais aux jours de repos', () => {
    const resultat = affecterSitesSemaine(semaine, [12]);
    expect(resultat.map((jour) => jour.siteId)).toEqual([12, undefined, 12, 12]);
  });

  it('plusieurs sites : le site choisi est conservé ; un jour sans site reste à choisir ; un repos n’a pas de site', () => {
    const resultat = affecterSitesSemaine(semaine, [10, 11]);
    expect(resultat.map((jour) => jour.siteId)).toEqual([10, undefined, undefined, 11]);
  });

  it('un site retiré de la sélection : les jours qui l’utilisaient sont vidés', () => {
    const resultat = affecterSitesSemaine(semaine, [11, 12]);
    expect(resultat.map((jour) => jour.siteId)).toEqual([undefined, undefined, undefined, 11]);
    expect(joursPrivesDeSite(semaine, resultat, [11, 12])).toEqual(['lundi']);
  });

  it('aucun jour signalé quand il ne reste qu’un site (attribué automatiquement) ou aucun', () => {
    expect(joursPrivesDeSite(semaine, affecterSitesSemaine(semaine, [11]), [11])).toEqual([]);
    expect(joursPrivesDeSite(semaine, affecterSitesSemaine(semaine, []), [])).toEqual([]);
  });

  it('ne modifie pas la semaine reçue', () => {
    const copie = JSON.parse(JSON.stringify(semaine));
    affecterSitesSemaine(semaine, [12]);
    expect(semaine).toEqual(copie);
  });
});

describe('donneesFormulaireDepuisDemande : site par jour', () => {
  it('reprend le site de chaque jour ; une demande sans site par jour reste lisible (aucun siteId inventé avec plusieurs sites)', () => {
    const avec = donneesFormulaireDepuisDemande({
      ...DEMANDE,
      semaine_type: [{ jour: 'lundi', statut: 'travail', heureDebut: '07:00', heureFin: '15:00', siteId: 11 }],
    });
    expect(avec.semaineType[0].siteId).toBe(11);
    const sans = donneesFormulaireDepuisDemande(DEMANDE);
    expect(sans.semaineType.every((jour) => !('siteId' in jour))).toBe(true);
  });

  it('un seul site : attribué aux jours travaillés dès le chargement', () => {
    const donnees = donneesFormulaireDepuisDemande({ ...DEMANDE, sites_affectation: [{ id: 10, nom: 'AIGLON', initiales: 'AIG' }] });
    expect(donnees.semaineType.filter((jour) => jour.statut === 'travail').every((jour) => jour.siteId === 10)).toBe(true);
    expect(donnees.semaineType.filter((jour) => jour.statut === 'repos').every((jour) => !('siteId' in jour))).toBe(true);
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

  it('site par jour : un seul site, rien à choisir ; plusieurs sites, obligatoire pour chaque jour travaillé (pas pour un repos)', () => {
    const base = complet();
    expect(validerFormulaire({ ...base, semaineType: [jourTravaille('lundi')] })).toEqual([]);
    const plusieurs = { ...base, sitesAffectationIds: [10, 11], semaineType: [jourTravaille('lundi', 10), jourTravaille('mardi'), jourRepos('mercredi'), jourTravaille('jeudi', 99)] };
    expect(messages(plusieurs)).toEqual({ 'semaine:mardi': 'Le site est obligatoire pour ce jour.', 'semaine:jeudi': 'Le site est obligatoire pour ce jour.' });
    expect(validerFormulaire({ ...plusieurs, semaineType: [jourTravaille('lundi', 10), jourTravaille('mardi', 11), jourRepos('mercredi')] })).toEqual([]);
  });
});
