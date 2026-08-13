const test = require('node:test');
const assert = require('node:assert/strict');

const { echapperHtml, formaterLignesLieuHtml } = require('./formatageEmail');

test('echapperHtml échappe les caractères spéciaux HTML', () => {
  assert.equal(echapperHtml(`Dupont & "Fils" <test> 'valeur'`), 'Dupont &amp; &quot;Fils&quot; &lt;test&gt; &#39;valeur&#39;');
});

test('echapperHtml renvoie une chaîne vide pour null/undefined', () => {
  assert.equal(echapperHtml(null), '');
  assert.equal(echapperHtml(undefined), '');
});

test('formaterLignesLieuHtml met adresse/metroAcces/instructions (champs structurés, migration 047) chacun sur sa propre ligne, préfixe adresse par "Lieu :"', () => {
  const html = formaterLignesLieuHtml({
    adresse: 'Hôtel du Cadran - 14 Rue de Valadon, 75007 Paris',
    metroAcces: 'Métro Ecole Militaire - Ligne 8',
    instructions: "Munissez-vous de votre pièce d'identité originale.",
  });

  assert.equal(
    html,
    'Lieu : Hôtel du Cadran - 14 Rue de Valadon, 75007 Paris<br>\n' +
      'Métro Ecole Militaire - Ligne 8<br>\n' +
      'Munissez-vous de votre pièce d&#39;identité originale.',
  );
});

test('formaterLignesLieuHtml omet les lignes metroAcces/instructions quand ils sont absents (adresse seule)', () => {
  assert.equal(
    formaterLignesLieuHtml({ adresse: 'Hôtel du Cadran - 14 rue de Valadon, 75007 Paris' }),
    'Lieu : Hôtel du Cadran - 14 rue de Valadon, 75007 Paris',
  );
});

test("formaterLignesLieuHtml n'affiche que metroAcces quand instructions est absent", () => {
  assert.equal(
    formaterLignesLieuHtml({ adresse: 'Bureau ACCECIT', metroAcces: 'Métro Corentin Celton' }),
    'Lieu : Bureau ACCECIT<br>\nMétro Corentin Celton',
  );
});

test('formaterLignesLieuHtml échappe le HTML de chaque champ', () => {
  const html = formaterLignesLieuHtml({ adresse: 'Salle "Test"', metroAcces: 'Accès <interphone>' });

  assert.equal(html, 'Lieu : Salle &quot;Test&quot;<br>\nAccès &lt;interphone&gt;');
});

// inclureInstructions (voir invitationTestService.construireMessageEmailFormateur/
// notificationChangementLieuService.construireMessageEmailFormateur) : `instructions` porte des
// consignes d'accueil destinées au candidat, sans objet pour un formateur/inspecteur.
test('formaterLignesLieuHtml omet instructions quand inclureInstructions vaut false, même si renseigné', () => {
  const html = formaterLignesLieuHtml(
    {
      adresse: 'Hôtel du Cadran - 14 Rue de Valadon, 75007 Paris',
      metroAcces: 'Métro Ecole Militaire - Ligne 8',
      instructions: "Munissez-vous de votre pièce d'identité originale.",
    },
    { inclureInstructions: false },
  );

  assert.equal(html, 'Lieu : Hôtel du Cadran - 14 Rue de Valadon, 75007 Paris<br>\nMétro Ecole Militaire - Ligne 8');
});

test('formaterLignesLieuHtml inclut instructions par défaut (inclureInstructions non précisé)', () => {
  const html = formaterLignesLieuHtml({ adresse: 'Bureau ACCECIT', instructions: 'Sonnez à « ACCECIT ».' });

  assert.equal(html, 'Lieu : Bureau ACCECIT<br>\nSonnez à « ACCECIT ».');
});
