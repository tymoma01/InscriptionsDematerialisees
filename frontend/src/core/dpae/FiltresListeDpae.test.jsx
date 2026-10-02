// Composants partagés des listes de demandes DPAE (FiltresListeDpae.jsx) : retour au tri par défaut
// et cellule des sites condensée.
import { afterEach, describe, expect, test } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { SitesDemandeDpae, useFiltresListeDpae } from './FiltresListeDpae';
import { trierParDefaut } from './listeDemandesDpae';

afterEach(cleanup);

const jour = (annee, mois, numero) => new Date(annee, mois - 1, numero).toISOString();
const DEMANDES = [
  { id: 1, statut: 'validee', date_creation: jour(2026, 9, 20), date_debut: jour(2026, 10, 20), salarie_nom: 'Zola' },
  { id: 2, statut: 'envoyee', date_creation: jour(2026, 9, 29), date_debut: jour(2026, 10, 9), salarie_nom: 'Abel' },
  { id: 3, statut: 'en_attente', date_creation: jour(2026, 9, 22), date_debut: jour(2026, 9, 30), salarie_nom: 'Martin' },
  { id: 4, statut: 'envoyee', date_creation: jour(2026, 9, 21), date_debut: jour(2026, 9, 28), salarie_nom: 'Durand' },
];
const ids = (liste) => liste.map((demande) => demande.id);

describe('useFiltresListeDpae : tri par défaut', () => {
  test('à l’ouverture ; remplacé par un tri de colonne ; rétabli en le désélectionnant ou par « Effacer les filtres »', () => {
    const { result } = renderHook(() => useFiltresListeDpae(DEMANDES));
    const parDefaut = ids(trierParDefaut(DEMANDES));
    expect(parDefaut).toStrictEqual([4, 2, 3, 1]);
    expect(ids(result.current.demandesVisibles)).toStrictEqual(parDefaut);

    act(() => result.current.changerTri('salarie', 'asc'));
    expect(ids(result.current.demandesVisibles)).toStrictEqual([2, 4, 3, 1]);
    act(() => result.current.changerTri('salarie', 'asc')); // second clic : tri retiré
    expect(ids(result.current.demandesVisibles)).toStrictEqual(parDefaut);

    act(() => {
      result.current.changerTri('date_demande', 'asc');
      result.current.setRecherche('a');
    });
    expect(result.current.peutEffacer).toBe(true);
    act(() => result.current.effacer());
    expect(ids(result.current.demandesVisibles)).toStrictEqual(parDefaut);
    expect(result.current.peutEffacer).toBe(false);
  });
});

describe('SitesDemandeDpae : codes seulement, au plus 2, puis « +N »', () => {
  const SITES = [
    { id: 1, nom: 'AIGLON', initiales: 'AIG' },
    { id: 2, nom: 'CADRAN', initiales: 'CAD' },
    { id: 3, nom: 'MONGE', initiales: 'MG' },
    { id: 4, nom: 'NOVOTEL PARIS GARE DE LYON', initiales: 'NGL' },
  ];
  const cellule = (sites, autres = {}) => {
    render(<SitesDemandeDpae demande={{ id: 7, sites_affectation: sites, ...autres }} />);
    return screen.getByLabelText(/^Sites d'affectation/);
  };

  test('1 site', () => {
    expect(cellule(SITES.slice(0, 1)).textContent).toBe('AIG');
  });
  test('2 sites', () => {
    expect(cellule(SITES.slice(0, 2)).textContent).toBe('AIG, CAD');
  });
  test('4 sites : « AIG, CAD +2 », info-bulle avec tous les noms complets', () => {
    const element = cellule(SITES);
    expect(element.textContent).toBe('AIG, CAD+2');
    expect(element.getAttribute('aria-label')).toBe(
      "Sites d'affectation : AIGLON (AIG), CADRAN (CAD), MONGE (MG), NOVOTEL PARIS GARE DE LYON (NGL)",
    );
    fireEvent.pointerEnter(element, { pointerType: 'mouse' });
    expect(screen.getByRole('tooltip').textContent).toBe('AIGLON (AIG)CADRAN (CAD)MONGE (MG)NOVOTEL PARIS GARE DE LYON (NGL)');
  });
  test('aucun site : « — »', () => {
    render(<SitesDemandeDpae demande={{ id: 8, sites_affectation: [] }} />);
    expect(document.body.textContent).toBe('—');
  });
});
