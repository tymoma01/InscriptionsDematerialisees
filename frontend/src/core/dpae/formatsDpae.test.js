import { describe, expect, it } from 'vitest';
import { libelleDivision, libellesSitesJour } from './formatsDpae';

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
