import { afterEach, beforeAll, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import DossierList, { formaterDateInscription } from './DossierList';

function dossier(id, dateCreation) {
  return {
    id,
    date_creation: dateCreation,
    date_maj: '2026-10-20T10:00:00Z',
    candidat_nom: `Nom${id}`,
    candidat_prenom: 'Prénom',
    statut_libelle: 'Nouveau',
  };
}

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(cleanup);

describe('formaterDateInscription', () => {
  it('formate la date et l\'heure à l\'heure de Paris', () => {
    expect(formaterDateInscription('2026-10-15T12:32:00Z')).toEqual({ date: '15/10/2026', heure: '14h32' });
  });

  it('renvoie null quand la date est absente ou invalide', () => {
    expect(formaterDateInscription(null)).toBeNull();
    expect(formaterDateInscription('n/a')).toBeNull();
  });
});

describe('DossierList — colonne Date d\'inscription', () => {
  it('remplace la colonne N° et affiche « – » sans date', () => {
    render(<DossierList dossiers={[dossier(1, '2026-10-15T12:32:00Z'), dossier(2, null)]} />);
    expect(screen.queryByRole('columnheader', { name: 'N°' })).toBeNull();
    expect(screen.getByRole('columnheader', { name: /Date d'inscription/ })).toBeTruthy();
    expect(screen.getByText('15/10/2026')).toBeTruthy();
    expect(screen.getByText('14h32')).toBeTruthy();
    expect(screen.getByText('–')).toBeTruthy();
  });

  it('trie par date d\'inscription au clic sur l\'en-tête', () => {
    render(<DossierList dossiers={[dossier(1, '2026-10-10T08:00:00Z'), dossier(2, '2026-10-12T08:00:00Z')]} />);
    fireEvent.click(screen.getByRole('button', { name: /Date d'inscription/ }));
    const lignes = screen.getAllByRole('row').slice(1);
    expect(within(lignes[0]).getByText('Prénom Nom2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Date d'inscription/ }));
    expect(within(screen.getAllByRole('row')[1]).getByText('Prénom Nom1')).toBeTruthy();
  });
});
