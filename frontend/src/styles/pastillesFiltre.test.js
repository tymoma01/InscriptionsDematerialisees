import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';

// Une seule règle commune met en semi-gras (600) toutes les familles de pastilles de filtre.
const css = readFileSync('src/styles/pastillesFiltre.css', 'utf8');
const main = readFileSync('src/main.jsx', 'utf8');

test('une règle commune met toutes les pastilles de filtre en font-weight 600, sans toucher aux couleurs ni aux tailles', () => {
  const regles = css.replace(/\/\*[\s\S]*?\*\//g, '').trim();
  expect(regles.match(/\{/g)).toHaveLength(1);
  expect(regles).toMatch(/font-weight:\s*600;/);
  expect(regles).not.toMatch(/color|font-size|background|padding/);
  for (const selecteur of ['.filtres-statut button', '.filtres-statut__tous button', '.filtre-entite button', '.filtre-etudiant button', '.filtre-metier__groupe button', '.filtres-disponibilites__pastille']) {
    expect(regles).toContain(selecteur);
  }
});

test('la règle est chargée par l’application', () => {
  expect(main).toContain("./styles/pastillesFiltre.css");
});
