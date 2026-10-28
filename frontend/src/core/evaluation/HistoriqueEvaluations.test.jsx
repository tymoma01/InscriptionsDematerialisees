import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import HistoriqueEvaluations from './HistoriqueEvaluations';
import { listerHistoriqueEvaluations, listerCreneauxDisponibles } from '../../services/evaluationService';

vi.mock('../../services/evaluationService', () => ({
  listerHistoriqueEvaluations: vi.fn(),
  listerCreneauxDisponibles: vi.fn(),
}));

const EVALUATION = {
  id: 1,
  dossier_id: 10,
  resultat_global: 'valide',
  orientation: null,
  date_evaluation: '2026-10-01T10:00:00.000Z',
  candidat_prenom: 'Sophie',
  candidat_nom: 'Martin',
  postes_codes: [],
  creneaux: ['6h-9h'],
  formateur_prenom: 'Awa',
  formateur_nom: 'Diallo',
};

beforeEach(() => {
  listerHistoriqueEvaluations.mockResolvedValue([EVALUATION]);
  listerCreneauxDisponibles.mockResolvedValue(['6h-9h', '9h-18h', '18h-21h']);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function Adresse() {
  const { search } = useLocation();
  return <p data-testid="adresse">{search}</p>;
}

function afficher(adresse = '/historique') {
  return render(
    <MemoryRouter initialEntries={[adresse]}>
      <HistoriqueEvaluations onSelectionner={() => {}} afficherInspecteur />
      <Adresse />
    </MemoryRouter>,
  );
}

function dernierAppel() {
  return listerHistoriqueEvaluations.mock.calls.at(-1)[0];
}

test('les créneaux et les sept jours sont proposés en pastilles, sur une seconde ligne', async () => {
  afficher();
  const groupeCreneaux = await screen.findByRole('group', { name: 'Créneaux souhaités' });
  const groupeJours = screen.getByRole('group', { name: 'Jours disponibles' });

  const creneaux = Array.from(groupeCreneaux.querySelectorAll('button')).map((bouton) => bouton.textContent);
  expect(creneaux).toEqual(['6h-9h', '9h-18h', '18h-21h']);
  const jours = Array.from(groupeJours.querySelectorAll('button')).map((bouton) => bouton.textContent);
  expect(jours).toEqual(['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche', 'Effacer']);

  const ligneRecherche = screen.getByLabelText('Rechercher').closest('.historique-evaluations__filtres');
  expect(ligneRecherche.contains(groupeCreneaux)).toBe(false);
});

test('sélection multiple : chaque pastille cochée est envoyée au serveur et reportée dans l\'adresse', async () => {
  afficher();
  await screen.findByRole('group', { name: 'Créneaux souhaités' });

  fireEvent.click(screen.getByRole('button', { name: '6h-9h' }));
  fireEvent.click(screen.getByRole('button', { name: '18h-21h' }));
  fireEvent.click(screen.getByRole('button', { name: 'Lundi' }));
  fireEvent.click(screen.getByRole('button', { name: 'Samedi' }));

  await waitFor(() => expect(dernierAppel()).toMatchObject({ creneaux: ['6h-9h', '18h-21h'], jours: ['lundi', 'samedi'] }));
  expect(screen.getByRole('button', { name: '6h-9h' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: '9h-18h' }).getAttribute('aria-pressed')).toBe('false');
  expect(screen.getByTestId('adresse').textContent).toBe('?creneau=6h-9h%2C18h-21h&jours=lundi%2Csamedi');

  fireEvent.click(screen.getByRole('button', { name: 'Lundi' }));
  await waitFor(() => expect(dernierAppel().jours).toEqual(['samedi']));
});

test('les filtres de l\'adresse sont appliqués au chargement (lien ?creneau=6h-9h conservé)', async () => {
  afficher('/historique?creneau=6h-9h&jours=mardi');
  await screen.findByRole('group', { name: 'Créneaux souhaités' });

  expect(listerHistoriqueEvaluations.mock.calls[0][0]).toMatchObject({ creneaux: ['6h-9h'], jours: ['mardi'] });
  expect(screen.getByRole('button', { name: '6h-9h' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: 'Mardi' }).getAttribute('aria-pressed')).toBe('true');
});

test('Effacer remet les deux groupes à zéro (liste et adresse), sans toucher à la recherche', async () => {
  afficher('/historique?q=martin&creneau=6h-9h%2C9h-18h&jours=lundi');
  await screen.findByRole('group', { name: 'Créneaux souhaités' });
  const effacer = screen.getByRole('button', { name: 'Effacer' });
  expect(effacer.disabled).toBe(false);

  fireEvent.click(effacer);

  await waitFor(() => expect(dernierAppel()).toMatchObject({ creneaux: [], jours: [] }));
  expect(screen.getByTestId('adresse').textContent).toBe('?q=martin');
  expect(screen.getByRole('button', { name: 'Effacer' }).disabled).toBe(true);
  expect(screen.getByLabelText('Rechercher').value).toBe('martin');
});

test('un créneau de l\'adresse absent des options (lien périmé) est retiré du filtre', async () => {
  afficher('/historique?creneau=matin%2C6h-9h');
  await waitFor(() => expect(screen.getByTestId('adresse').textContent).toBe('?creneau=6h-9h'));
});

test('les pastilles restent affichées pendant le rechargement après un clic', async () => {
  afficher();
  await screen.findByRole('group', { name: 'Créneaux souhaités' });
  listerHistoriqueEvaluations.mockReturnValue(new Promise(() => {}));

  fireEvent.click(screen.getByRole('button', { name: '9h-18h' }));

  expect(screen.getByRole('group', { name: 'Créneaux souhaités' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '9h-18h' }).getAttribute('aria-pressed')).toBe('true');
});
