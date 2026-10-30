import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SuiviPegase from './SuiviPegase';
import { relancerEnvoiPegase } from '../../services/dpaeService';

vi.mock('../../services/dpaeService', () => ({ relancerEnvoiPegase: vi.fn(async () => {}) }));

const RH = { permissions: ['dpaeRelancePegase'] };
const PLANNING = { permissions: [] };

const SUIVI = {
  statut: 'cree',
  pegasePersonnelId: '5000',
  message: null,
  avertissements: ['N° de sécurité sociale absent : à saisir dans Pégase.'],
  piecesEnvoyees: ['rib', 'carte_vitale'],
  piecesEnErreur: [],
  enCours: false,
  relancePossible: false,
};

describe('SuiviPegase', () => {
  afterEach(cleanup);

  it('n’affiche rien pour une demande non concernée', () => {
    const { container } = render(<SuiviPegase pegase={null} demandeId={1} utilisateur={RH} onRecharger={() => {}} />);
    expect(container.innerHTML).toBe('');
  });

  it('affiche le salarié créé, ses pièces et ce qui reste à compléter', () => {
    render(<SuiviPegase pegase={SUIVI} demandeId={1} utilisateur={RH} onRecharger={() => {}} />);
    expect(screen.getByText('Salarié créé dans Pégase')).toBeTruthy();
    expect(screen.getByText('Identifiant Pégase : 5000')).toBeTruthy();
    expect(screen.getByText('Pièces justificatives envoyées : 2')).toBeTruthy();
    expect(screen.getByText('N° de sécurité sociale absent : à saisir dans Pégase.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('propose la relance d’un échec à la RH seulement', async () => {
    const echec = { ...SUIVI, statut: 'erreur', pegasePersonnelId: null, message: 'Token Pégase refusé (419).', relancePossible: true };
    const onRecharger = vi.fn(async () => {});

    render(<SuiviPegase pegase={echec} demandeId={42} utilisateur={PLANNING} onRecharger={onRecharger} />);
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();

    render(<SuiviPegase pegase={echec} demandeId={42} utilisateur={RH} onRecharger={onRecharger} />);
    expect(screen.getByText('Token Pégase refusé (419).')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Relancer l’envoi vers Pégase' }));
    await waitFor(() => expect(onRecharger).toHaveBeenCalled());
    expect(relancerEnvoiPegase).toHaveBeenCalledWith(42);
  });
});
