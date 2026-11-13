// Garde-fou : tout écran de détail d'un candidat doit afficher le bouton de blacklistage. Ce test
// échoue si un écran listé l'oublie, ou si un nouvel écran qui affiche le détail d'un candidat
// (informations d'inscription / notes du dossier) n'est pas déclaré ici.
import { expect, test } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RACINE = 'src';

// Écran de détail -> ce qui y affiche le bouton (NavigationFicheDossier le porte dans sa barre d'onglets).
const ECRANS_DETAIL_CANDIDAT = {
  'pages/recruteur/Validation.jsx': '<NavigationFicheDossier',
  'pages/accueil/VerificationPieces.jsx': '<NavigationFicheDossier',
  'pages/coordination/Tests.jsx': '<NavigationFicheDossier',
  'pages/coordination/Relances.jsx': '<NavigationFicheDossier',
  'pages/coordination/Formation.jsx': '<NavigationFicheDossier',
  'core/evaluation/GrilleEvaluation.jsx': '<BoutonBlacklister',
  'core/evaluation/ContenuDetailEvaluation.jsx': '<BoutonBlacklister',
  'pages/rh/DetailDemandeDpae.jsx': '<BoutonBlacklister',
};
// Écrans qui délèguent à un composant ci-dessus.
const DELEGUES = { 'core/evaluation/DetailEvaluation.jsx': '<ContenuDetailEvaluation detail={detail} avecBlacklist' };
// Composants qui rendent le détail mais ne sont pas des écrans.
const COMPOSANTS_EXEMPTES = ['core/dossier/InformationsInscription.jsx', 'core/dossier/NotesDossier.jsx', 'core/dossier/BoutonBlacklister.jsx'];

function fichiersJsx(dossier) {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return fichiersJsx(chemin);
    return /\.jsx$/.test(nom) && !/\.test\.jsx$/.test(nom) ? [chemin] : [];
  });
}
const lire = (relatif) => readFileSync(join(RACINE, relatif), 'utf8');

test('chaque écran de détail candidat affiche le bouton de blacklistage', () => {
  for (const [fichier, marque] of Object.entries({ ...ECRANS_DETAIL_CANDIDAT, ...DELEGUES })) {
    expect(lire(fichier), `${fichier} doit contenir ${marque}`).toContain(marque);
  }
});

test('la barre d’onglets du dossier porte le composant BoutonBlacklister', () => {
  expect(lire('core/dossier/NavigationFicheDossier.jsx')).toContain('<BoutonBlacklister');
});

test('aucun écran affichant le détail d’un candidat n’est absent de la liste du garde-fou', () => {
  const connus = new Set([...Object.keys(ECRANS_DETAIL_CANDIDAT), ...Object.keys(DELEGUES), ...COMPOSANTS_EXEMPTES]);
  const inconnus = fichiersJsx(RACINE)
    .map((chemin) => chemin.slice(RACINE.length + 1).split('\\').join('/'))
    .filter((relatif) => !connus.has(relatif))
    .filter((relatif) => /<(InformationsInscription|NotesDossier)\b/.test(lire(relatif)));
  expect(inconnus, `Écran(s) de détail candidat à déclarer (et à équiper du bouton) : ${inconnus.join(', ')}`).toEqual([]);
});
