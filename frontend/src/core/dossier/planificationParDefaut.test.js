import { expect, test } from 'vitest';
import {
  resoudreSecteurDossier,
  roleImposeParSecteur,
  trouverFormateurParDefaut,
  trouverLieuParDefaut,
  trouverLieuParDefautFormateur,
} from './planificationParDefaut';

test('le secteur bureau l’emporte quand le candidat a des postes des deux secteurs', () => {
  expect(resoudreSecteurDossier(['nettoyage'], ['femme_chambre'])).toBe('bureau');
  expect(resoudreSecteurDossier([], ['femme_chambre'])).toBe('hotel');
  expect(resoudreSecteurDossier()).toBeNull();
});

test('le secteur impose le rôle de l’évaluateur', () => {
  expect(roleImposeParSecteur('bureau')).toBe('inspecteur');
  expect(roleImposeParSecteur('hotel')).toBe('formateur');
  expect(roleImposeParSecteur(null)).toBeNull();
});

test('lieu et évaluateur par défaut du secteur', () => {
  const lieux = [
    { id: 1, secteur: 'hotel', par_defaut: false },
    { id: 2, secteur: 'hotel', par_defaut: true },
    { id: 3, secteur: 'bureau', par_defaut: true },
  ];
  const formateurs = [
    { id: 10, role_code: 'formateur', par_defaut: true, lieu_par_defaut_id: 3 },
    { id: 11, role_code: 'inspecteur', par_defaut: false },
  ];
  expect(trouverLieuParDefaut(lieux, 'hotel').id).toBe(2);
  expect(trouverLieuParDefaut(lieux, null)).toBeUndefined();
  expect(trouverFormateurParDefaut(formateurs, 'formateur').id).toBe(10);
  expect(trouverFormateurParDefaut(formateurs, 'inspecteur')).toBeUndefined();
  expect(trouverLieuParDefautFormateur(formateurs, '10', lieux).id).toBe(3);
  expect(trouverLieuParDefautFormateur(formateurs, 11, lieux)).toBeUndefined();
});
