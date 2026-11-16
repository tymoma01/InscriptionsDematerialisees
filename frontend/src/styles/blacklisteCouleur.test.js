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

describe('Couleur du statut « Refus définitif »', () => {
  test('jaune doux : fond clair, bordure moyenne, texte foncé lisible', () => {
    expect(couleur('statut-blackliste-fond')).toBe('#fde9a8');
    expect(couleur('statut-blackliste-bordure')).toBe('#e0b84a');
    expect(couleur('statut-blackliste-texte')).toBe('#664a00');
    expect(contraste(couleur('statut-blackliste-fond'), couleur('statut-blackliste-texte'))).toBeGreaterThan(4.5);
  });

  test('plus de rouge : teinte jaune/dorée, distincte de « En attente de pièces » et du créneau « matin »', () => {
    const [r, g, b] = rvb(couleur('statut-blackliste-fond'));
    expect(r).toBeGreaterThan(240);
    expect(g).toBeGreaterThan(200);
    expect(b).toBeLessThan(g - 40);
    for (const autre of ['statut-attente', 'statut-jaune-pale']) {
      expect(couleur('statut-blackliste-fond')).not.toBe(couleur(`${autre}-fond`));
      expect(couleur('statut-blackliste-bordure')).not.toBe(couleur(`${autre}-bordure`));
      const ecart = rvb(couleur('statut-blackliste-fond')).reduce((somme, v, i) => somme + Math.abs(v - rvb(couleur(`${autre}-fond`))[i]), 0);
      expect(ecart).toBeGreaterThanOrEqual(30);
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

describe('Position du filtre « Refus définitif »', () => {
  test('grille de 7 colonnes égales dès 1280 px ; « Refus définitif » reste le dernier filtre, sans colonne forcée', () => {
    expect(accueil).toMatch(/@media \(min-width: 1280px\)[\s\S]*grid-template-columns: repeat\(7, minmax\(0, 1fr\)\)/);
    expect(accueil).not.toMatch(/repeat\(6, minmax/);
    const regle = accueil.slice(accueil.indexOf(".filtres-statut__statuts button[data-statut='blackliste']:not(.actif)"));
    expect(regle.split('}')[0]).not.toMatch(/grid-column/);
  });
});
