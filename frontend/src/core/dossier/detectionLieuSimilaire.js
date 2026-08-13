// Détection de doublon à la création d'un lieu (bouton "+", ModalePlanificationTest.jsx) —
// avertissement seulement, jamais un blocage (voir soumettreLieu) : deux structures différentes
// peuvent légitimement partager la même adresse. Purement local : les lieux de l'entité sont déjà
// chargés pour peupler le sélecteur, pas la peine d'un aller-retour serveur supplémentaire juste
// pour comparer des chaînes. Seul `adresse` est comparé (jamais `metroAcces`/`instructions`,
// migration 047) — c'est le champ qui identifie le lieu PHYSIQUE ; deux entrées à la même adresse
// mais dont les instructions d'accès sont formulées différemment restent un doublon, alors que
// comparer le texte entier (comme avant la migration 047, sur l'ancien `libelle` combiné) aurait
// pu rater ce cas.

function normaliser(texte) {
  return texte
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Distance de Levenshtein classique (matrice pleine) — jamais plus de quelques dizaines de lieux
// par entité, chaînes de quelques dizaines de caractères : pas besoin d'une version optimisée en
// espace ni d'une lib externe pour ce volume.
function distanceLevenshtein(a, b) {
  const matrice = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) matrice[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) matrice[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cout = a[i - 1] === b[j - 1] ? 0 : 1;
      matrice[i][j] = Math.min(matrice[i - 1][j] + 1, matrice[i][j - 1] + 1, matrice[i - 1][j - 1] + cout);
    }
  }
  return matrice[a.length][b.length];
}

// Ratio de similarité 0..1 (1 = identique après normalisation) — 1 - distance/longueur max :
// mesure simple et symétrique, suffisante pour repérer une variation de formulation/casse/
// ponctuation du même lieu, sans lib de fuzzy-matching supplémentaire.
function similarite(a, b) {
  if (a.length === 0 && b.length === 0) return 1;
  return 1 - distanceLevenshtein(a, b) / Math.max(a.length, b.length);
}

// Seuil choisi empiriquement : assez haut pour ne jamais se déclencher sur deux adresses
// réellement différentes (ex. deux rues distinctes du même quartier), assez bas pour attraper une
// simple variation de ponctuation/casse/accents du même lieu (tiret vs virgule, espace en trop,
// "Cadran" vs "cadran"). Une correspondance normalisée EXACTE donne toujours 1, donc toujours
// détectée quel que soit ce seuil.
const SEUIL_SIMILARITE = 0.9;

// Renvoie le lieu existant le plus proche de l'adresse saisie, seulement s'il dépasse le seuil —
// null sinon (aucun avertissement à afficher côté appelant).
export function trouverLieuSimilaire(lieuxExistants, adresseSaisie) {
  const cible = normaliser(adresseSaisie);
  if (!cible) return null;

  let meilleur = null;
  let meilleurScore = 0;
  for (const lieu of lieuxExistants) {
    const score = similarite(cible, normaliser(lieu.adresse));
    if (score > meilleurScore) {
      meilleurScore = score;
      meilleur = lieu;
    }
  }
  return meilleurScore >= SEUIL_SIMILARITE ? meilleur : null;
}
