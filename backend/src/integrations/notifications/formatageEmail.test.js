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

test("formaterLignesLieuHtml met chaque segment séparé par ' | ' sur sa propre ligne, préfixe le premier par 'Lieu :'", () => {
  const html = formaterLignesLieuHtml(
    "Hôtel du Cadran - 14 Rue de Valadon, 75007 Paris | Métro Ecole Militaire - Ligne 8 | Munissez-vous de votre pièce d'identité originale",
  );

  assert.equal(
    html,
    'Lieu : Hôtel du Cadran - 14 Rue de Valadon, 75007 Paris<br>\n' +
      'Métro Ecole Militaire - Ligne 8<br>\n' +
      'Munissez-vous de votre pièce d&#39;identité originale',
  );
});

test("formaterLignesLieuHtml gère un lieu à un seul segment (pas de ' | ')", () => {
  assert.equal(formaterLignesLieuHtml('Hôtel du Cadran - 14 rue de Valadon, 75007 Paris'), 'Lieu : Hôtel du Cadran - 14 rue de Valadon, 75007 Paris');
});

test('formaterLignesLieuHtml échappe le HTML de chaque segment', () => {
  const html = formaterLignesLieuHtml('Salle "Test" | Accès <interphone>');

  assert.equal(html, 'Lieu : Salle &quot;Test&quot;<br>\nAccès &lt;interphone&gt;');
});

test('formaterLignesLieuHtml ignore les segments vides (séparateurs superflus)', () => {
  assert.equal(formaterLignesLieuHtml('Adresse ||  Accès  '), 'Lieu : Adresse<br>\nAccès');
});
