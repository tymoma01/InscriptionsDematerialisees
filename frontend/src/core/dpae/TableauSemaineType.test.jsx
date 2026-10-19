import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import TableauSemaineType from './TableauSemaineType';

const SITES = [{ id: 1, nom: 'AIGLON', initiales: 'AIG' }, { id: 2, nom: 'BLACK DOOR', initiales: 'BD' }];

describe('TableauSemaineType', () => {
  afterEach(cleanup);

  it('colonnes Jour, Horaires, Pause, Site(s) ; un site par ligne ; jours de repos absents', () => {
    render(
      <TableauSemaineType
        sitesAffectation={SITES}
        semaineType={[
          { jour: 'lundi', statut: 'travail', heureDebut: '09:30', heureFin: '16:30', pauseMinutes: 60, siteIds: [1, 2] },
          { jour: 'mardi', statut: 'repos' },
        ]}
      />,
    );
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Jour', 'Horaires', 'Pause', 'Site(s)']);
    expect(screen.getByText('Lundi')).toBeTruthy();
    expect(screen.getByText('09h30 – 16h30')).toBeTruthy();
    expect(screen.getByText('1h00')).toBeTruthy();
    expect(screen.getByText('AIGLON (AIG)')).toBeTruthy();
    expect(screen.getByText('BLACK DOOR (BD)')).toBeTruthy();
    expect(screen.queryByText('Mardi')).toBeNull();
  });

  it('aucune pause : la colonne Pause n’apparaît pas', () => {
    render(<TableauSemaineType sitesAffectation={SITES} semaineType={[{ jour: 'lundi', statut: 'travail', heureDebut: '08:00', heureFin: '16:00', siteIds: [1] }]} />);
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Jour', 'Horaires', 'Site(s)']);
  });

  it('aucun jour travaillé : message', () => {
    render(<TableauSemaineType semaineType={[{ jour: 'lundi', statut: 'repos' }]} />);
    expect(screen.getByText('Aucun jour de travail renseigné.')).toBeTruthy();
  });
});
