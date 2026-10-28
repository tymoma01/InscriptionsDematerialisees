import { expect, test } from 'vitest';
import { libelleMotifRendezvous } from './motifsDesistement';

test("« Autre motif » s'affiche suivi de sa précision", () => {
  expect(
    libelleMotifRendezvous({ motif_code: 'autre', motif_libelle: 'Autre motif', motif_precision: "Garde d'enfant" }),
  ).toBe("Autre motif : Garde d'enfant");
});

test('les autres motifs gardent leur libellé, sans motif rien', () => {
  expect(libelleMotifRendezvous({ motif_code: 'indisponible', motif_libelle: 'Finalement indisponible' })).toBe(
    'Finalement indisponible',
  );
  expect(libelleMotifRendezvous({ motif_code: 'autre', motif_libelle: 'Autre motif', motif_precision: null })).toBe('Autre motif');
  expect(libelleMotifRendezvous({ statut: 'prevu' })).toBeNull();
});
