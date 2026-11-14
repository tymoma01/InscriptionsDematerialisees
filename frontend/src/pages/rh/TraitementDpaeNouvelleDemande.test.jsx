import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createRequire } from 'node:module';
import TraitementDpae from './TraitementDpae';
import { useSession } from '../../core/auth/useSession';

vi.mock('../../core/auth/useSession', () => ({ useSession: vi.fn() }));
vi.mock('../../services/dpaeService', () => ({ listerDemandesRh: vi.fn().mockResolvedValue([]) }));
vi.mock('../../core/backOffice/PageBackOffice', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('../../core/auth/EnTeteBackOffice', () => ({ default: () => null }));
vi.mock('../../core/dossier/useRafraichissementAuto', () => ({ useRafraichissementAuto: vi.fn() }));
vi.mock('../../core/dpae/TelechargementPdfDpae', () => ({
  ActionTelechargementPdfDpae: () => null,
  CaseDemandeDpae: () => null,
  CaseToutCocherDpae: () => null,
  usePeutTelechargerPdfDpae: () => false,
  useSelectionDemandesDpae: () => ({}),
}));

const require = createRequire(import.meta.url);
const { permissionsDuRole } = require('../../../../backend/src/core/auth/permissions.js');

afterEach(cleanup);

function afficher(roleCode) {
  useSession.mockReturnValue({ utilisateur: { roleCode, permissions: permissionsDuRole(roleCode) }, chargement: false });
  render(
    <MemoryRouter>
      <TraitementDpae />
    </MemoryRouter>,
  );
}

describe('Demandes DPAE (file de traitement) : « + Nouvelle demande »', () => {
  it('visible pour le Planning Tertiaire, qui crée ses propres demandes, et mène au formulaire', () => {
    afficher('planning_tertiaire');
    expect(screen.getByRole('link', { name: '+ Nouvelle demande' }).getAttribute('href')).toBe('/coordination/dpae/nouvelle');
  });

  it('absent pour la RH, qui ne crée pas de demande', () => {
    afficher('rh');
    expect(screen.queryByRole('link', { name: '+ Nouvelle demande' })).toBeNull();
  });
});
