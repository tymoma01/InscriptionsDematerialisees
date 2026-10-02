import { expect, test } from 'vitest';
import { codesPourFiltreStatut, formaterDisponibiliteEffective, infoBulleStatut, varianteStatut } from './affichageDossiers';

test('disponibilité affichée selon les dates connues', () => {
  expect(formaterDisponibiliteEffective({ nonRenseignee: true })).toBe('Dispo : non renseignée');
  expect(formaterDisponibiliteEffective({ dateDebut: null, dateFin: null })).toBe('Dispo : immédiate');
  expect(formaterDisponibiliteEffective({ dateDebut: null, dateFin: '2026-11-30' })).toBe('Dispo : immédiate → 30/11');
  expect(formaterDisponibiliteEffective({ dateDebut: '2026-10-15', dateFin: null })).toBe('Dispo : à partir du 15/10');
  expect(formaterDisponibiliteEffective({ dateDebut: '2026-10-15', dateFin: '2026-12-01' })).toBe('Dispo : 15/10 → 01/12');
});

test('infobulle du statut « test planifié » : date et formateur du test', () => {
  const dossier = {
    statut_code: 'test_planifie',
    rendezvousTestActif: { dateHeure: '2026-10-05T07:30:00Z', formateurPrenom: 'Paul', formateurNom: 'Durand' },
  };
  const lignes = infoBulleStatut(dossier);
  expect(lignes[0]).toMatch(/^Pour : 05\/10\/2026/);
  expect(lignes[1]).toBe('Formateur : Paul Durand');
  expect(infoBulleStatut({ ...dossier, rendezvousTestActif: { dateHeure: dossier.rendezvousTestActif.dateHeure } })[1]).toBe(
    'Formateur : non assigné',
  );
  expect(infoBulleStatut({ statut_code: 'embauche' })).toBeUndefined();
});

test('filtres regroupés : un filtre peut couvrir plusieurs statuts', () => {
  expect(codesPourFiltreStatut('a_planifier')).toEqual(['nouveau', 'en_attente_pieces', 'test_non_planifie']);
  expect(codesPourFiltreStatut('test_realise').length).toBeGreaterThan(1);
  expect(codesPourFiltreStatut('embauche')).toEqual(['embauche']);
});

test('statut inconnu : couleur neutre', () => {
  expect(varianteStatut('statut_inconnu')).toBe('neutre');
});
