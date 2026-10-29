// Lecture de la bande MRZ (lignes de « <<< ») d'une pièce d'identité, à partir du texte reconnu par
// l'OCR : formats normalisés (OACI 9303) à positions fixes, chaque champ suivi d'une clé de contrôle.
// Une clé fausse signale une erreur de lecture : on ne renvoie que des champs contrôlés, jamais une
// valeur devinée.
//   - TD1, 3 × 30 : nouvelle carte d'identité (2021), titres de séjour ;
//   - TD3, 2 × 44 : passeport ;
//   - ancienne carte d'identité française, 2 × 36 (format national, sans date d'expiration).

const POIDS = [7, 3, 1];

function valeur(caractere) {
  if (caractere >= '0' && caractere <= '9') return Number(caractere);
  if (caractere >= 'A' && caractere <= 'Z') return caractere.charCodeAt(0) - 55;
  return 0;
}

/** Clé de contrôle OACI d'un champ. */
export function cle(champ) {
  return String([...champ].reduce((somme, c, i) => somme + valeur(c) * POIDS[i % 3], 0) % 10);
}

// Lettres que l'OCR confond avec des chiffres, dans un champ qui ne contient que des chiffres.
const CHIFFRES = { O: '0', Q: '0', D: '0', U: '0', I: '1', L: '1', Z: '2', S: '5', G: '6', T: '7', B: '8' };
const chiffres = (texte) => texte.replace(/[A-Z]/g, (c) => CHIFFRES[c] ?? c);

/** Champ suivi de sa clé, contrôlé : la valeur, ou null si la clé ne concorde pas. */
function controle(champ, cleLue, { numerique = false } = {}) {
  const valeurChamp = numerique ? chiffres(champ) : champ;
  return cle(valeurChamp) === chiffres(cleLue) ? valeurChamp : null;
}

/** AAMMJJ → AAAA-MM-JJ. Expiration au XXIe siècle ; naissance au siècle qui ne la met pas dans le futur. */
function date(aammjj, nature) {
  const [aa, mm, jj] = [aammjj.slice(0, 2), aammjj.slice(2, 4), aammjj.slice(4, 6)].map(Number);
  if (mm < 1 || mm > 12 || jj < 1 || jj > 31) return null;
  const siecle = nature === 'naissance' && aa > new Date().getFullYear() % 100 ? 1900 : 2000;
  return `${siecle + aa}-${aammjj.slice(2, 4)}-${aammjj.slice(4, 6)}`;
}

const texte = (champ) => champ.replace(/<+/g, ' ').trim();

function noms(champ) {
  const [nom = '', prenoms = ''] = champ.split('<<');
  return { nom: texte(nom), prenoms: texte(prenoms) };
}

function td1([l1, l2, l3]) {
  const numero = controle(l1.slice(5, 14), l1[14]);
  const naissance = controle(l2.slice(0, 6), l2[6], { numerique: true });
  const expiration = controle(l2.slice(8, 14), l2[14], { numerique: true });
  if (!numero || !naissance || !expiration) return null;
  return {
    type: l1.startsWith('ID') ? 'carte_identite' : null,
    numero: numero.replace(/</g, ''),
    naissance: date(naissance, 'naissance'),
    expire_le: date(expiration, 'expiration'),
    ...noms(l3),
  };
}

function td3([l1, l2]) {
  if (!l1.startsWith('P')) return null;
  const numero = controle(l2.slice(0, 9), l2[9]);
  const naissance = controle(l2.slice(13, 19), l2[19], { numerique: true });
  const expiration = controle(l2.slice(21, 27), l2[27], { numerique: true });
  if (!numero || !naissance || !expiration) return null;
  return {
    type: 'passeport',
    numero: numero.replace(/</g, ''),
    naissance: date(naissance, 'naissance'),
    expire_le: date(expiration, 'expiration'),
    ...noms(l1.slice(5)),
  };
}

// Ancienne carte : nom en ligne 1, puis numéro (année et mois de délivrance, département…), prénoms
// et date de naissance en ligne 2. Pas de date d'expiration.
function carteAncienne([l1, l2]) {
  if (!l1.startsWith('IDFRA')) return null;
  const numero = controle(chiffres(l2.slice(0, 12)), l2[12]);
  const naissance = controle(l2.slice(27, 33), l2[33], { numerique: true });
  if (!numero || !naissance) return null;
  return {
    type: 'carte_identite',
    numero,
    naissance: date(naissance, 'naissance'),
    expire_le: null,
    nom: texte(l1.slice(5, 30)),
    prenoms: texte(l2.slice(13, 27)),
  };
}

const FORMATS = [
  { lignes: 3, longueur: 30, lire: td1 },
  { lignes: 2, longueur: 44, lire: td3 },
  { lignes: 2, longueur: 36, lire: carteAncienne },
];

/** Ligne à la longueur du format : l'OCR perd ou ajoute souvent un « < » de remplissage en fin de ligne. */
const ajuster = (ligne, longueur) => ligne.padEnd(longueur, '<').slice(0, longueur);

/**
 * Données de la bande MRZ trouvée dans le texte reconnu, ou null : { type, numero, naissance,
 * expire_le, nom, prenoms }, `type` (carte_identite, passeport) et `expire_le` pouvant manquer.
 */
export function analyserMrz(texteReconnu) {
  const lignes = texteReconnu
    .toUpperCase()
    .split('\n')
    .map((l) => l.replace(/[^A-Z0-9<]/g, ''))
    .filter((l) => l.length >= 26);
  for (const { lignes: nombre, longueur, lire } of FORMATS) {
    for (let i = 0; i + nombre <= lignes.length; i++) {
      const bloc = lignes.slice(i, i + nombre);
      if (bloc.every((l) => Math.abs(l.length - longueur) <= 2)) {
        const resultat = lire(bloc.map((l) => ajuster(l, longueur)));
        if (resultat) return resultat;
      }
    }
  }
  return null;
}

const lettres = (valeurTexte) =>
  (valeurTexte ?? '')
    .normalize('NFD')
    .replace(/[^A-Za-z]/g, '')
    .toUpperCase();

/**
 * Écarts entre la bande lue et le formulaire du candidat ('nom', 'date_naissance') : la pièce
 * photographiée n'est peut-être pas la sienne. Le nom de la MRZ peut être tronqué, et c'est le nom
 * d'usage ou de naissance.
 */
export function ecarts(mrz, { nom, nom_naissance: nomNaissance, date_naissance: dateNaissance }) {
  const nomLu = lettres(mrz.nom);
  const concorde = (n) => {
    const attendu = lettres(n);
    return attendu !== '' && nomLu !== '' && (attendu.startsWith(nomLu) || nomLu.startsWith(attendu));
  };
  return [
    ...(concorde(nom) || concorde(nomNaissance) ? [] : ['nom']),
    ...(mrz.naissance && dateNaissance && mrz.naissance !== dateNaissance ? ['date_naissance'] : []),
  ];
}
