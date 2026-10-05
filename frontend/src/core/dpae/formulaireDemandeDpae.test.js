import { describe, expect, it } from 'vitest';
import { JOURS_SEMAINE, donneesFormulaireDepuisDemande, donneesInitiales } from './formulaireDemandeDpae';

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
