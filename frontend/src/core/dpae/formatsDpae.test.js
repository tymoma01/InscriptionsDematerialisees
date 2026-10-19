import { describe, expect, it } from 'vitest';
import { libelleDivision, libellesSitesJour, lignesSemaineType } from './formatsDpae';

describe('libellesSitesJour', () => {
  const sites = [{ id: 51, nom: 'AIGLON', initiales: 'AIG' }, { id: 52, nom: 'LIB. GARE DE L\'EST', initiales: 'GDE' }];

  it('tous les sites du jour « NOM (INITIALES) », dans l’ordre de la liste', () => {
    expect(libellesSitesJour({ siteIds: [52, 51] }, sites)).toEqual(['LIB. GARE DE L\'EST (GDE)', 'AIGLON (AIG)']);
  });

  it('ancienne forme à un seul siteId lue comme une liste d’un élément', () => {
    expect(libellesSitesJour({ siteId: 51 }, sites)).toEqual(['AIGLON (AIG)']);
  });

  it('liste vide sans site (demande antérieure), site introuvable ou liste absente', () => {
    expect(libellesSitesJour({}, sites)).toEqual([]);
    expect(libellesSitesJour({ siteIds: [99] }, sites)).toEqual([]);
    expect(libellesSitesJour({ siteIds: [51] }, undefined)).toEqual([]);
  });
});

describe('libelleDivision', () => {
  it('Hôtellerie, Tertiaire, précision pour Autre, null si absente', () => {
    expect(libelleDivision('hotellerie')).toBe('Hôtellerie');
    expect(libelleDivision('tertiaire')).toBe('Tertiaire');
    expect(libelleDivision('autre', 'Siège')).toBe('Siège');
    expect(libelleDivision(null)).toBeNull();
  });
});

describe('lignesSemaineType', () => {
  const sites = [{ id: 1, nom: 'AIGLON', initiales: 'AIG' }, { id: 2, nom: 'BLACK DOOR', initiales: 'BD' }];
  const semaine = [
    { jour: 'mardi', statut: 'travail', heureDebut: '08:00', heureFin: '16:00', pauseMinutes: 0, siteIds: [2] },
    { jour: 'lundi', statut: 'travail', heureDebut: '09:30:00', heureFin: '16:30', pauseMinutes: 60, siteIds: [1, 2] },
    { jour: 'mercredi', statut: 'repos' },
  ];

  it('jours travaillés seulement, dans l’ordre de la semaine ; horaires « 09h30 – 16h30 », pause « 1h00 » ou « – »', () => {
    const { lignes, avecPause } = lignesSemaineType(semaine, sites);
    expect(avecPause).toBe(true);
    expect(lignes.map((l) => [l.jour, l.horaires, l.pause, l.sites])).toEqual([
      ['Lundi', '09h30 – 16h30', '1h00', ['AIGLON (AIG)', 'BLACK DOOR (BD)']],
      ['Mardi', '08h00 – 16h00', '–', ['BLACK DOOR (BD)']],
    ]);
  });

  it('aucun jour avec pause : avecPause faux', () => {
    expect(lignesSemaineType([{ jour: 'lundi', statut: 'travail', heureDebut: '08:00', heureFin: '16:00' }], sites).avecPause).toBe(false);
  });
});
