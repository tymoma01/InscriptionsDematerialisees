// Pastille « Étudiant » de Dossiers candidats : un clic sélectionne, un second revient à la liste
// complète ; compteur affiché ; aucune pastille « Non étudiant ».
import { afterEach, expect, test } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import FiltreEtudiant from './FiltreEtudiant';
import { FILTRE_ETUDIANT, basculerChoixUnique } from './filtrerDossiers';

afterEach(cleanup);

function Page() {
  const [filtre, setFiltre] = useState('');
  return (
    <FiltreEtudiant
      actif={filtre === FILTRE_ETUDIANT}
      onBasculer={() => setFiltre(basculerChoixUnique(filtre, FILTRE_ETUDIANT))}
      compteur={3}
    />
  );
}

test('clic : sélectionne ; second clic : désélectionne ; une seule pastille', () => {
  render(<Page />);
  expect(screen.getAllByRole('button')).toHaveLength(1);
  expect(screen.queryByRole('button', { name: /Non étudiant/ })).toBeNull();
  const etudiant = screen.getByRole('button', { name: 'Étudiant (3)' });
  expect(etudiant.getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(etudiant);
  expect(etudiant.getAttribute('aria-pressed')).toBe('true');
  expect(etudiant.className).toBe('actif');
  fireEvent.click(etudiant);
  expect(etudiant.getAttribute('aria-pressed')).toBe('false');
});
