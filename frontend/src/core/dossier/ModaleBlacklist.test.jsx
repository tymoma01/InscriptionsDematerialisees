// Fenêtre « Refus définitif » / « Lever le refus définitif » : motif obligatoire, compteur, rendez-vous signalés.
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ModaleBlacklist from './ModaleBlacklist';

afterEach(cleanup);

const CATEGORIES = [
  { code: 'absence_repetee', libelle: 'Absence répétée sans prévenir' },
  { code: 'comportement_inapproprie', libelle: 'Comportement inapproprié' },
  { code: 'fausse_declaration', libelle: 'Fausse déclaration ou faux document' },
  { code: 'abandon_poste', libelle: 'Abandon de poste' },
  { code: 'autre', libelle: 'Autre' },
];
const DOSSIER = { id: 7, candidat_nom: 'Durand', candidat_prenom: 'Paul', rendezvousActifs: [] };
const COMMENTAIRE_VALIDE = 'Absent trois fois sans prévenir.';

function ouvrir(props = {}) {
  const onConfirmer = vi.fn();
  render(<ModaleBlacklist mode="blacklister" dossier={DOSSIER} categories={CATEGORIES} onConfirmer={onConfirmer} onAnnuler={() => {}} {...props} />);
  return onConfirmer;
}

const boutonConfirmer = () => screen.getByRole('button', { name: 'Confirmer le refus définitif' });
const zoneCommentaire = () => screen.getByRole('textbox');

test('les cinq catégories configurées sont proposées', () => {
  ouvrir();
  expect(screen.getAllByRole('radio')).toHaveLength(5);
  expect(screen.getByLabelText('Fausse déclaration ou faux document')).toBeTruthy();
});

test('confirmation impossible sans catégorie, sans commentaire ou avec un commentaire trop court', () => {
  ouvrir();
  expect(boutonConfirmer().disabled).toBe(true);
  fireEvent.click(screen.getByLabelText('Autre'));
  expect(boutonConfirmer().disabled).toBe(true);
  fireEvent.change(zoneCommentaire(), { target: { value: 'court' } });
  expect(boutonConfirmer().disabled).toBe(true);
  fireEvent.change(zoneCommentaire(), { target: { value: '          ' } });
  expect(boutonConfirmer().disabled).toBe(true);
});

test('compteur de caractères, limité à 500', () => {
  ouvrir();
  expect(screen.getByText('0/500 (minimum 10)')).toBeTruthy();
  fireEvent.change(zoneCommentaire(), { target: { value: COMMENTAIRE_VALIDE } });
  expect(screen.getByText(`${COMMENTAIRE_VALIDE.length}/500 (minimum 10)`)).toBeTruthy();
  expect(zoneCommentaire().getAttribute('maxlength')).toBe('500');
});

test('catégorie + commentaire valides : le motif est transmis', () => {
  const onConfirmer = ouvrir();
  fireEvent.click(screen.getByLabelText('Abandon de poste'));
  fireEvent.change(zoneCommentaire(), { target: { value: `  ${COMMENTAIRE_VALIDE}  ` } });
  expect(boutonConfirmer().disabled).toBe(false);
  fireEvent.click(boutonConfirmer());
  expect(onConfirmer).toHaveBeenCalledWith({ motifCode: 'abandon_poste', commentaire: COMMENTAIRE_VALIDE });
});

test('un rendez-vous actif est signalé, sans être annulé', () => {
  ouvrir({ dossier: { ...DOSSIER, rendezvousActifs: [{ id: 1, type: 'test', dateHeure: '2026-11-20T09:00:00Z', statut: 'prevu' }] } });
  expect(screen.getByRole('alert').textContent).toMatch(/Un rendez-vous est encore actif/);
  expect(screen.getByRole('alert').textContent).toMatch(/ne l’annule pas/);
});

test('aucun avertissement sans rendez-vous actif', () => {
  ouvrir();
  expect(screen.queryByRole('alert')).toBeNull();
});

test('retrait : pas de catégorie, motif obligatoire, statut rétabli annoncé', () => {
  const onConfirmer = vi.fn();
  render(
    <ModaleBlacklist
      mode="retirer"
      dossier={{ ...DOSSIER, statutAvantBlacklist: { code: 'test_planifie', libelle: 'Test planifié' } }}
      onConfirmer={onConfirmer}
      onAnnuler={() => {}}
    />,
  );
  expect(screen.queryAllByRole('radio')).toHaveLength(0);
  expect(screen.getByText('Test planifié')).toBeTruthy();
  const bouton = screen.getByRole('button', { name: 'Lever le refus définitif' });
  expect(bouton.disabled).toBe(true);
  fireEvent.change(zoneCommentaire(), { target: { value: 'Homonyme, erreur de dossier.' } });
  expect(bouton.disabled).toBe(false);
  fireEvent.click(bouton);
  expect(onConfirmer).toHaveBeenCalledWith({ motifCode: undefined, commentaire: 'Homonyme, erreur de dossier.' });
});

test('la pastille « Refus définitif » respecte prefers-reduced-motion (animation lente, désactivée sinon)', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync('src/core/workflow/StatutBadge.css', 'utf8');
  const duree = /\.statut-badge--blackliste\s*{[^}]*animation:[^;]*?(\d+(?:\.\d+)?)s/.exec(css);
  expect(duree).not.toBeNull();
  // Cycle d'au moins 1/3 de seconde : jamais plus de 3 pulsations par seconde.
  expect(Number(duree[1])).toBeGreaterThanOrEqual(1);
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*{\s*\.statut-badge--blackliste\s*{\s*animation: none;/);
});
