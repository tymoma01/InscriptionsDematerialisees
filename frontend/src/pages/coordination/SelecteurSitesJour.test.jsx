import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import SelecteurSitesJour, { resumeSelectionSites } from './SelecteurSitesJour';

const SITES = [
  { id: 1, nom: 'AIGLON', initiales: 'AIG' },
  { id: 2, nom: 'COLOMBES', initiales: 'COL' },
  { id: 3, nom: 'GARE DE L’EST', initiales: 'GDE' },
];

describe('resumeSelectionSites', () => {
  it('« Choisir les sites » sans sélection, les codes sinon, « +N » au-delà de deux', () => {
    expect(resumeSelectionSites([])).toBe('Choisir les sites');
    expect(resumeSelectionSites([SITES[0]])).toBe('AIG');
    expect(resumeSelectionSites(SITES.slice(0, 2))).toBe('AIG, COL');
    expect(resumeSelectionSites(SITES)).toBe('AIG, COL +1');
  });
});

describe('SelecteurSitesJour', () => {
  afterEach(cleanup);

  const afficher = (selection = [], onChanger = () => {}) =>
    render(<SelecteurSitesJour sites={SITES} selection={selection} onChanger={onChanger} libelleJour="lundi" />);

  it('bouton : texte du résumé et noms complets en info-bulle', () => {
    afficher([1, 3]);
    const bouton = screen.getByRole('button', { name: 'Sites du lundi' });
    expect(bouton.textContent).toContain('AIG, GDE');
    expect(bouton.getAttribute('title')).toBe('AIGLON, GARE DE L’EST');
  });

  it('panneau : une ligne par site au format « AIGLON (AIG) », liens Tout cocher / Tout décocher', () => {
    afficher();
    fireEvent.click(screen.getByRole('button', { name: 'Sites du lundi' }));
    expect(screen.getByText('AIGLON (AIG)')).toBeTruthy();
    expect(screen.getByText('GARE DE L’EST (GDE)')).toBeTruthy();
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Tout cocher' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tout décocher' })).toBeTruthy();
  });

  it('cocher un site, tout cocher et tout décocher remplacent la sélection (ordre des sites de la demande)', () => {
    const appels = [];
    afficher([3], (ids) => appels.push(ids));
    fireEvent.click(screen.getByRole('button', { name: 'Sites du lundi' }));
    fireEvent.click(screen.getByLabelText('AIGLON (AIG)'));
    fireEvent.click(screen.getByRole('button', { name: 'Tout cocher' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tout décocher' }));
    expect(appels).toEqual([[1, 3], [1, 2, 3], []]);
  });

  it('Échap ferme le panneau et rend le focus au bouton ; le clic à l’extérieur le ferme aussi', () => {
    afficher();
    const bouton = screen.getByRole('button', { name: 'Sites du lundi' });
    fireEvent.click(bouton);
    fireEvent.keyDown(screen.getByRole('group'), { key: 'Escape' });
    expect(screen.queryByRole('group')).toBeNull();
    expect(document.activeElement).toBe(bouton);
    fireEvent.click(bouton);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('clavier : flèche bas sur le bouton ouvre le panneau et place le focus sur la première case ; les flèches se déplacent', () => {
    afficher();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Sites du lundi' }), { key: 'ArrowDown' });
    const cases = screen.getAllByRole('checkbox');
    expect(document.activeElement).toBe(cases[0]);
    fireEvent.keyDown(screen.getByRole('group'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(cases[1]);
    fireEvent.keyDown(screen.getByRole('group'), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(cases[0]);
  });
});
