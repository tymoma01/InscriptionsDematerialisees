import { describe, expect, it } from 'vitest';
import { libelleSiteJour } from './formatsDpae';

describe('libelleSiteJour', () => {
  const sites = [{ id: 51, nom: 'AIGLON', initiales: 'AIG' }];

  it('« NOM (INITIALES) » du site du jour', () => {
    expect(libelleSiteJour({ siteId: 51 }, sites)).toBe('AIGLON (AIG)');
  });

  it('null sans site (demande antérieure), site introuvable ou liste absente', () => {
    expect(libelleSiteJour({}, sites)).toBeNull();
    expect(libelleSiteJour({ siteId: 99 }, sites)).toBeNull();
    expect(libelleSiteJour({ siteId: 51 }, undefined)).toBeNull();
  });
});
