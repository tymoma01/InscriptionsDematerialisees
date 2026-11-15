import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import FiltresStatut from './FiltresStatut';
import StatutBadge from '../workflow/StatutBadge';
import { STATUTS_FILTRABLES_DOSSIER } from '../../pages/coordination/affichageRendezvous';
import { varianteStatut } from '../../pages/accueil/affichageDossiers';

// « Blacklisté » a UNE seule couleur (--statut-blackliste-fond / -texte / -bordure, styles/variables.css) :
// ce test échoue dès qu'un composant l'affiche sans cette variable (couleur en dur, variante locale, filtre
// laissé en blanc).
function fichiers(dossier) {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    return statSync(chemin).isDirectory() ? fichiers(chemin) : [chemin];
  });
}
const sources = fichiers('src').filter((chemin) => /\.(jsx?|css)$/.test(chemin) && !/\.test\./.test(chemin));
const lire = (chemin) => readFileSync(chemin, 'utf8');

afterEach(cleanup);

describe('Couleur unique de « Blacklisté »', () => {
  test('tout libellé « Blacklisté » affiché en pastille (filtre ou badge) porte la variante blackliste', () => {
    const fautifs = [];
    for (const chemin of sources.filter((c) => /\.jsx?$/.test(c))) {
      lire(chemin)
        .split('\n')
        .forEach((ligne, index) => {
          if (/libelle[:=]\s*['"{]*\s*['"]Blacklisté['"]/.test(ligne) && !/variante[:=]\s*['"{]*\s*['"]blackliste['"]/.test(ligne)) fautifs.push(`${chemin}:${index + 1}`);
        });
    }
    expect(fautifs).toEqual([]);
  });

  test('chaque table de variantes de statut associe « blackliste » à la variante blackliste (jamais une variante locale)', () => {
    const fautifs = [];
    for (const chemin of sources.filter((c) => /\.jsx?$/.test(c))) {
      for (const [, valeur] of lire(chemin).matchAll(/\bblackliste:\s*'([^']+)'/g)) if (valeur !== 'blackliste') fautifs.push(chemin);
    }
    expect(fautifs).toEqual([]);
    expect(varianteStatut('blackliste')).toBe('blackliste');
  });

  test('chaque règle CSS propre à « blackliste » utilise les variables communes, sans couleur en dur', () => {
    const fautifs = [];
    for (const chemin of sources.filter((c) => c.endsWith('.css') && !c.endsWith('variables.css'))) {
      for (const [, corps] of lire(chemin).matchAll(/[^{}]*blackliste[^{}]*\{([^}]*)\}/g)) {
        // Hors animation (keyframes) : toute couleur doit venir de --statut-blackliste-*.
        for (const couleur of corps.match(/(?<![-\w])(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/g) ?? []) {
          if (!/box-shadow/.test(corps) || !couleur.startsWith('rgba')) fautifs.push(`${chemin} : ${couleur}`);
        }
      }
    }
    expect(fautifs).toEqual([]);
  });

  test('les trois variables communes sont définies une seule fois', () => {
    const variables = lire('src/styles/variables.css');
    for (const nom of ['fond', 'texte', 'bordure']) expect(variables.match(new RegExp(`--statut-blackliste-${nom}:`, 'g'))).toHaveLength(1);
  });

  test('filtre « Blacklisté » de « Suivi des tests » : mêmes couleurs communes que la liste des dossiers, sélection renforcée comme les autres filtres', () => {
    const blackliste = STATUTS_FILTRABLES_DOSSIER.find((statut) => statut.code === 'blackliste');
    expect(blackliste.variante).toBe('blackliste');
    render(<FiltresStatut statuts={STATUTS_FILTRABLES_DOSSIER} statutFiltre="blackliste" onChangerStatutFiltre={() => {}} compteurs={{ blackliste: 0 }} />);
    const bouton = screen.getByRole('button', { name: /Blacklisté/ });
    expect(bouton.dataset.variante).toBe('blackliste');
    expect(bouton.getAttribute('style')).toContain('var(--statut-blackliste-fond)');
    expect(bouton.getAttribute('style')).toContain('var(--statut-blackliste-bordure)');
    expect(bouton.getAttribute('style')).toContain('var(--statut-blackliste-texte)');
    // Sélectionné : même classe de renforcement que les autres filtres actifs.
    expect(bouton.className).toBe('actif');
    // Le filtre ne clignote pas : aucune animation sur la pastille de filtre.
    expect(lire('src/core/dossier/FiltresStatut.css')).not.toMatch(/animation/);
  });

  test('la pastille de statut d’un dossier blacklisté garde son clignotement doux', () => {
    render(<StatutBadge libelle="Blacklisté" variante="blackliste" />);
    expect(screen.getByText('Blacklisté').className).toContain('statut-badge--blackliste');
    const badge = lire('src/core/workflow/StatutBadge.css');
    expect(badge).toMatch(/\.statut-badge--blackliste \{[^}]*animation:\s*statut-badge-blackliste-pulsation 2\.4s/);
    expect(badge).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.statut-badge--blackliste \{\s*animation: none/);
  });
});
