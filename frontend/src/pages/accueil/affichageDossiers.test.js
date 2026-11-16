import { expect, test } from 'vitest';
import {
  CODES_STATUTS_FILTRES_ACCUEIL,
  codesPourFiltreStatut,
  correspondFiltreStatut,
  formaterDisponibiliteEffective,
  infoBulleStatut,
  varianteStatut,
} from './affichageDossiers';

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

// Refus définitif : exclu de « Tous » et des autres filtres, visible par son seul filtre.
test('« Tous » exclut les dossiers blacklistés ; seul le filtre dédié les montre', () => {
  const dossiers = [
    { id: 1, statut_code: 'test_planifie' },
    { id: 2, statut_code: 'embauche' },
    { id: 3, statut_code: 'blackliste' },
  ];
  expect(dossiers.filter((d) => correspondFiltreStatut(d, null)).map((d) => d.id)).toEqual([1, 2]);
  expect(dossiers.filter((d) => correspondFiltreStatut(d, 'blackliste')).map((d) => d.id)).toEqual([3]);
  expect(dossiers.filter((d) => correspondFiltreStatut(d, 'test_planifie')).map((d) => d.id)).toEqual([1]);
  // Les filtres agrégés ne ramènent jamais un blacklisté.
  expect(dossiers.filter((d) => correspondFiltreStatut(d, 'test_realise')).map((d) => d.id)).toEqual([2]);
  expect(dossiers.filter((d) => correspondFiltreStatut(d, 'a_planifier'))).toEqual([]);
});

test('le filtre « Refus définitif » existe parmi les pastilles de statut, avec la variante rouge', () => {
  expect(CODES_STATUTS_FILTRES_ACCUEIL).toContain('blackliste');
  expect(varianteStatut('blackliste')).toBe('blackliste');
});
