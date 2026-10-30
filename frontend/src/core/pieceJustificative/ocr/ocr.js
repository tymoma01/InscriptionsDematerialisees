// OCR dans le navigateur (tesseract.js) : aucune image n'est envoyée à un service tiers pour être
// lue. Le worker, le moteur WebAssembly et les modèles sont servis par l'app (imports « ?url »),
// jamais par le CDN que tesseract.js utilise par défaut, et rien n'est mis en cache dans le
// navigateur (cacheMethod « none » : pas d'IndexedDB). Environ 6 Mo, téléchargés à l'ouverture de
// l'écran des pièces. Le moteur WebAssembly exige « 'wasm-unsafe-eval' » dans la CSP (backend/src/app.js).
import urlWorker from 'tesseract.js/dist/worker.min.js?url';
// Variante sans SIMD : un peu plus lente, mais acceptée par toutes les tablettes.
import urlMoteur from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url';
// Bande MRZ : modèle entraîné sur la police OCR-B des pièces d'identité (voir modeles/LICENCE.txt).
import urlModeleMrz from './modeles/mrz.traineddata.gz?url';
// Verso de l'ancienne carte d'identité et RIB : texte imprimé ordinaire, modèle français (accents des
// libellés « délivrée »…), plus léger que l'anglais.
import urlModeleTexte from '@tesseract.js-data/fra/4.0.0_best_int/fra.traineddata.gz?url';
import { analyserMrz } from './mrz';
import { analyserRib } from './rib';
import { analyserVerso } from './verso';
import { extraireChamp } from './champ';

/** Image décodée (ImageBitmap, ou <img> pour les navigateurs où createImageBitmap échoue). */
async function decoderPhoto(photo) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(photo);
    } catch {
      // Repli <img> ci-dessous.
    }
  }
  const url = URL.createObjectURL(photo);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const CARACTERES_MRZ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<';

const chargements = {};

/**
 * Worker tesseract d'un modèle, créé une fois. tesseract.js ne charge un modèle qu'à l'adresse
 * « {dossier}/{langue}.traineddata.gz » : « …/mrz-<hash>.traineddata.gz » (nom donné par
 * vite.config.js) donne le dossier et la langue.
 */
function worker(urlModele, parametres) {
  chargements[urlModele] ??= (async () => {
    const { createWorker, OEM } = await import('tesseract.js');
    const separation = urlModele.lastIndexOf('/');
    const ocr = await createWorker(urlModele.slice(separation + 1).replace(/\.traineddata\.gz$/, ''), OEM.LSTM_ONLY, {
      workerPath: urlWorker,
      corePath: urlMoteur,
      langPath: new URL(urlModele.slice(0, separation), window.location.href).href,
      workerBlobURL: false,
      cacheMethod: 'none',
    });
    await ocr.setParameters(parametres);
    return ocr;
  })().catch((erreur) => {
    // Réseau coupé : on réessaiera à la prochaine photo.
    delete chargements[urlModele];
    throw erreur;
  });
  return chargements[urlModele];
}

// Limité aux caractères de la MRZ ; découpage choisi à chaque lecture.
const workerMrz = () => worker(urlModeleMrz, { tessedit_char_whitelist: CARACTERES_MRZ });
const workerTexte = () => worker(urlModeleTexte, {});

const files = new Map();

/**
 * Lecture d'une image par un worker, avec son découpage (PSM). Un worker sert plusieurs lectures
 * (recto et verso capturés coup sur coup, RIB) : elles passent une à une, sans quoi le découpage
 * réglé pour l'une s'appliquerait à l'autre.
 */
function reconnaitre(ouvrir, psm, canvas) {
  const lecture = (files.get(ouvrir) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const ocr = await ouvrir();
      await ocr.setParameters({ tessedit_pageseg_mode: psm });
      return (await ocr.recognize(canvas)).data.text;
    });
  files.set(ouvrir, lecture);
  return lecture;
}

// Au-delà, la lecture est abandonnée (illisible, saisie manuelle) : un worker qui ne démarre pas
// (réseau coupé pendant le chargement, moteur bloqué par la CSP) ne rejette jamais, et l'écran
// resterait sur « Lecture en cours ». Large : premier chargement des modèles compris.
const DELAI_LECTURE_MS = 90_000;

function avecDelai(lecture, repli) {
  let minuteur;
  const abandon = new Promise((resoudre) => {
    minuteur = setTimeout(() => resoudre(repli), DELAI_LECTURE_MS);
  });
  return Promise.race([lecture, abandon]).finally(() => clearTimeout(minuteur));
}

/** Lance les téléchargements sans attendre ; un échec ici est sans conséquence. */
export function prechargerOcr() {
  workerMrz().catch(() => {});
  workerTexte().catch(() => {});
}

const CONTRASTE = 1.4;

/**
 * Niveaux de gris contrastés, calculés pixel par pixel : `contexte.filter` (« grayscale contrast »)
 * est ignoré sans erreur par Safari avant la version 18, l'OCR y lirait l'image brute.
 */
export function grisContraste(pixels) {
  for (let i = 0; i < pixels.length; i += 4) {
    const gris = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    pixels[i] = pixels[i + 1] = pixels[i + 2] = (gris - 128) * CONTRASTE + 128;
  }
  return pixels;
}

/**
 * Image réduite à `largeur`, en niveaux de gris contrastés (`gris`) : `part` = fraction basse de la
 * photo gardée.
 */
function preparer(image, { largeur, part = 1, gris = true }) {
  const hauteurSource = Math.round(image.height * part);
  const echelle = Math.min(1, largeur / image.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.width * echelle);
  canvas.height = Math.round(hauteurSource * echelle);
  const contexte = canvas.getContext('2d', { willReadFrequently: true });
  contexte.drawImage(image, 0, image.height - hauteurSource, image.width, hauteurSource, 0, 0, canvas.width, canvas.height);
  if (gris) {
    const donnees = contexte.getImageData(0, 0, canvas.width, canvas.height);
    grisContraste(donnees.data);
    contexte.putImageData(donnees, 0, 0);
  }
  return canvas;
}

// Lectures essayées dans l'ordre (la photo est supposée prise dans le bon sens). Carte remplissant le
// cadre où la photo est rognée : la bande est en bas, lue comme un bloc de texte unique (PSM 6).
// Carte plus petite que le cadre, ou photo de l'appareil photo natif, gardée entière : la bande est
// quelque part dans la photo, au milieu du décor qui fait perdre ses lignes au PSM 6 ; seul le
// découpage automatique (PSM 3) l'y retrouve, mais il la manque sur une bande seule.
const LECTURES_MRZ = [
  { part: 0.4, psm: '6' },
  { part: 1, psm: '3' },
];

/**
 * Données de la bande MRZ d'une photo de pièce d'identité (voir analyserMrz), ou null si elle est
 * illisible ou absente (recto d'une carte d'identité actuelle…).
 */
async function lectureMrz(photo) {
  try {
    const image = await decoderPhoto(photo);
    for (const { part, psm } of LECTURES_MRZ) {
      const texte = await reconnaitre(workerMrz, psm, preparer(image, { largeur: 1600, part }));
      const mrz = analyserMrz(texte);
      if (mrz) return mrz;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Ne garde que l'encre noire, en noir sur blanc : sombre et peu colorée par rapport au fond de la
 * carte (médiane de l'image). Le fond guilloché bleu-vert et les libellés bleus, que les niveaux de
 * gris laissent, noient sinon les valeurs. Seuil relatif : l'éclairage de la photo varie.
 */
function encreNoire(canvas, seuil) {
  const contexte = canvas.getContext('2d');
  const image = contexte.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = image.data;
  const histogramme = new Uint32Array(256);
  for (let i = 0; i < pixels.length; i += 4) histogramme[Math.max(pixels[i], pixels[i + 1], pixels[i + 2])]++;
  let fond = 0;
  for (let cumul = histogramme[0]; cumul < pixels.length / 8;) cumul += histogramme[++fond];
  for (let i = 0; i < pixels.length; i += 4) {
    const max = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
    const min = Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
    const noir = max < fond * seuil && max - min < fond * 0.3;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = noir ? 0 : 255;
  }
  contexte.putImageData(image, 0, 0);
  return canvas;
}

// Seuils essayés dans l'ordre (fraction du fond) : 0,5 lit les photos normales, sombres ou claires ;
// les autres rattrapent une encre pâle ou un fond chargé.
const SEUILS_ENCRE = [0.5, 0.6, 0.4];

/**
 * Dates d'expiration et de délivrance imprimées au verso de l'ancienne carte d'identité (voir
 * analyserVerso), ou null. La photo est rognée sur le cadre de la prise de vue : la carte en occupe
 * l'essentiel, d'où un fond de carte pris pour référence par le filtre « encre noire ».
 */
async function lectureVerso(photo) {
  try {
    const image = await decoderPhoto(photo);
    for (const seuil of SEUILS_ENCRE) {
      const canvas = encreNoire(preparer(image, { largeur: 1800, gris: false }), seuil);
      const texte = await reconnaitre(workerTexte, '6', canvas);
      const dates = analyserVerso(texte);
      if (dates) return dates;
    }
    return null;
  } catch {
    return null;
  }
}

/** IBAN et BIC d'une photo de RIB (voir analyserRib), chacun null s'il est illisible. */
async function lectureRib(photo) {
  try {
    const image = await decoderPhoto(photo);
    // Page entière, à la mise en page libre (découpage automatique) : caractères de l'IBAN assez
    // grands à cette largeur sur une photo A4.
    const texte = await reconnaitre(workerTexte, '3', preparer(image, { largeur: 2400 }));
    return analyserRib(texte);
  } catch {
    return { iban: null, bic: null };
  }
}

// Découpages essayés pour un champ isolé : bloc de texte, puis ligne unique.
const LECTURES_CHAMP = ['6', '7'];

/**
 * Valeur d'un seul champ lue sur une photo prise de près (voir extraireChamp), ou null. La photo ne
 * sort pas du navigateur : décodée, lue puis libérée (bitmap fermé, canvas vidé), rien n'est
 * conservé ni journalisé.
 */
async function lectureChamp(photo, nature) {
  let image;
  try {
    image = await decoderPhoto(photo);
    for (const psm of LECTURES_CHAMP) {
      const canvas = preparer(image, { largeur: 1600 });
      try {
        const valeur = extraireChamp(nature, await reconnaitre(workerTexte, psm, canvas));
        if (valeur) return valeur;
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    image?.close?.();
  }
}

export const lireChamp = (photo, nature) => avecDelai(lectureChamp(photo, nature), null);
export const lireMrz = (photo) => avecDelai(lectureMrz(photo), null);
export const lireVerso = (photo) => avecDelai(lectureVerso(photo), null);
export const lireRib = (photo) => avecDelai(lectureRib(photo), { iban: null, bic: null });
