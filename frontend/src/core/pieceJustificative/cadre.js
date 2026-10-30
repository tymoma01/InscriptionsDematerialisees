// Cadre du viseur de la caméra : l'accueil y place le document, dans le sens du cadre, et la photo
// est rognée sur ce cadre. L'OCR (ocr/ocr.js) suppose un document droit qui remplit l'image : une
// photo de travers ou noyée dans le décor ne se lit pas. Le cadre est dimensionné sur le viseur
// (CSS), la vidéo y est affichée en « object-fit: contain » : on mesure les deux à l'écran au
// moment de la prise.

// Cartes au format ID-1 (85,6 × 54 mm), prises à l'horizontale. Pas de cadre pour la photo
// d'identité (un visage, pas un document) ; A4 en portrait pour tous les papiers (RIB, justificatifs).
const CARTES = new Set(['carte_identite', 'carte_identite_verso', 'carte_vitale']);
const SANS_CADRE = new Set(['photo_identite']);

/** 'paysage', 'portrait' ou null (pas de cadre, photo gardée entière) selon le type de pièce. */
export function formatCadre(codeTypePiece) {
  if (SANS_CADRE.has(codeTypePiece)) return null;
  return CARTES.has(codeTypePiece) ? 'paysage' : 'portrait';
}

/** Rectangle (pixels) où s'affiche une image de format `ratio` dans `boite`, en « contain ». */
function zoneAffichee(boite, ratio) {
  const largeur = Math.min(boite.width, boite.height * ratio);
  const hauteur = largeur / ratio;
  return { x: boite.left + (boite.width - largeur) / 2, y: boite.top + (boite.height - hauteur) / 2, largeur, hauteur };
}

const borner = (valeur) => Math.min(1, Math.max(0, valeur));

/**
 * Cadre en fractions (0 à 1) de l'image affichée : `cadre` et `video`, rectangles mesurés à l'écran
 * (getBoundingClientRect) ; `ratio`, largeur / hauteur de l'image telle qu'elle s'affiche.
 */
export function fractionCadre(cadre, video, ratio) {
  const image = zoneAffichee(video, ratio);
  const x = borner((cadre.left - image.x) / image.largeur);
  const y = borner((cadre.top - image.y) / image.hauteur);
  return {
    x,
    y,
    largeur: borner((cadre.left + cadre.width - image.x) / image.largeur) - x,
    hauteur: borner((cadre.top + cadre.height - image.y) / image.hauteur) - y,
  };
}

/**
 * Cadre en pixels d'une image de `largeur` × `hauteur`. Une photo pleine résolution peut avoir un
 * autre format que la vidéo affichée (4:3 contre 16:9) : la vidéo en est alors la partie centrale,
 * au format `ratioVue`.
 */
export function zoneSurImage(fraction, ratioVue, largeur, hauteur) {
  let vue = { x: 0, y: 0, largeur, hauteur };
  if (largeur / hauteur > ratioVue) vue = { ...vue, largeur: hauteur * ratioVue, x: (largeur - hauteur * ratioVue) / 2 };
  else if (largeur / hauteur < ratioVue) vue = { ...vue, hauteur: largeur / ratioVue, y: (hauteur - largeur / ratioVue) / 2 };
  return {
    x: Math.round(vue.x + fraction.x * vue.largeur),
    y: Math.round(vue.y + fraction.y * vue.hauteur),
    largeur: Math.round(fraction.largeur * vue.largeur),
    hauteur: Math.round(fraction.hauteur * vue.hauteur),
  };
}
