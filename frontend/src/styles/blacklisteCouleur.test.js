import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';

const lire = (chemin) => readFileSync(chemin, 'utf8');
const variables = lire('src/styles/variables.css');
const accueil = lire('src/pages/accueil/TableauDeBordAccueil.css');

const couleur = (nom) => new RegExp(`--${nom}:\\s*(#[0-9a-fA-F]{6})`).exec(variables)[1];
const rvb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = (hex) => {
  const [r, g, b] = rvb(hex).map((valeur) => {
    const c = valeur / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contraste = (a, b) => {
  const [clair, fonce] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (clair + 0.05) / (fonce + 0.05);
};
const saturation = (hex) => {
  const [r, g, b] = rvb(hex).map((valeur) => valeur / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  return max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
};

describe('Couleur du statut « Blacklisté »', () => {
  test('rouge adouci : fond clair, bordure moyenne, texte foncé lisible', () => {
    expect(couleur('statut-blackliste-fond')).toBe('#f8b4b4');
    expect(couleur('statut-blackliste-bordure')).toBe('#e57373');
    expect(couleur('statut-blackliste-texte')).toBe('#7f1d1d');
    expect(contraste(couleur('statut-blackliste-fond'), couleur('statut-blackliste-texte'))).toBeGreaterThan(4.5);
  });

  test('reste plus marquée que « Invalidé » et « Formation non validée » (fond plus soutenu, bordure plus foncée)', () => {
    for (const autre of ['statut-echec', 'statut-echec-fort']) {
      expect(luminance(couleur('statut-blackliste-fond'))).toBeLessThan(luminance(couleur(`${autre}-fond`)));
      expect(luminance(couleur('statut-blackliste-bordure'))).toBeLessThan(luminance(couleur(`${autre}-bordure`)));
      expect(saturation(couleur('statut-blackliste-fond'))).toBeGreaterThan(saturation(couleur(`${autre}-fond`)));
    }
  });

  test('une seule définition, partagée par la pastille de filtre et le badge de statut (aucune couleur en dur)', () => {
    expect(variables.match(/--statut-blackliste-fond:/g)).toHaveLength(1);
    const badge = lire('src/core/workflow/StatutBadge.css');
    const regle = badge.slice(badge.indexOf('.statut-badge--blackliste {'), badge.indexOf('}', badge.indexOf('.statut-badge--blackliste {')));
    expect(regle).toContain('var(--statut-blackliste-fond)');
    expect(regle).toContain('var(--statut-blackliste-texte)');
    expect(regle).toContain('var(--statut-blackliste-bordure)');
    // Pulsation douce inchangée (2,4 s, désactivée avec prefers-reduced-motion).
    expect(regle).toContain('2.4s');
    expect(badge).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.statut-badge--blackliste \{\s*animation: none/);
    const pastille = accueil.slice(accueil.indexOf("button[data-statut='blackliste']:not(.actif)"));
    expect(pastille.split('}')[0]).toContain('var(--statut-blackliste-fond)');
    expect(pastille.split('}')[0]).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});

describe('Position du filtre « Blacklisté »', () => {
  test('dernière colonne de la grille à 6 colonnes, sous « Embauché » (troisième ligne), même grille que les autres pastilles', () => {
    expect(accueil).toMatch(/grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/);
    const regle = accueil.slice(accueil.indexOf(".filtres-statut__statuts button[data-statut='blackliste'] {"));
    expect(regle.split('}')[0]).toMatch(/grid-column:\s*6;/);
  });
});
