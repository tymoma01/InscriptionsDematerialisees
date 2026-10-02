import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import RouteProtegee from './RouteProtegee';
import { useSession } from './useSession';

vi.mock('./useSession', () => ({ useSession: vi.fn() }));
// L'habillage back-office (en-tête, navigation…) n'est pas l'objet de ces tests.
vi.mock('../backOffice/PageBackOffice', () => ({ default: ({ children }) => <div>{children}</div> }));

afterEach(cleanup);

function Emplacement() {
  const { pathname, search } = useLocation();
  return <p>emplacement:{pathname + search}</p>;
}

function afficher(session, permission) {
  useSession.mockReturnValue(session);
  render(
    <MemoryRouter initialEntries={['/admin/utilisateurs']}>
      <Routes>
        <Route
          path="/admin/utilisateurs"
          element={
            <RouteProtegee permission={permission}>
              <p>page protégée</p>
            </RouteProtegee>
          }
        />
        <Route path="*" element={<Emplacement />} />
      </Routes>
    </MemoryRouter>,
  );
}

test('sans session : renvoi vers la connexion avec la page demandée', () => {
  afficher({ utilisateur: null, chargement: false }, 'administration');
  expect(screen.getByText('emplacement:/connexion?redirection=%2Fadmin%2Futilisateurs')).toBeTruthy();
});

test('sans la permission : renvoi vers l’écran du rôle', () => {
  afficher({ utilisateur: { roleCode: 'rh', permissions: [] }, chargement: false }, 'administration');
  expect(screen.getByText('emplacement:/rh/dpae')).toBeTruthy();
});

test('avec la permission : la page s’affiche', () => {
  afficher({ utilisateur: { roleCode: 'admin', permissions: ['administration'] }, chargement: false }, 'administration');
  expect(screen.getByText('page protégée')).toBeTruthy();
});

test('pendant le chargement de la session : message d’attente', () => {
  afficher({ utilisateur: null, chargement: true }, 'administration');
  expect(screen.getByText('Chargement de la session…')).toBeTruthy();
});
