// Traduction d'un candidat ACCECIT en fiche salarié Pégase (PUT /personnel, doc §3.10.11) et
// contrôle de doublon. Pur : aucun accès base ni réseau (orchestration : pegaseSalarieService.js).
//
// Codes Pégase relevés sur les salariés existants : civilité « M. » / « Mme », situations
// familiales ci-dessous. Pégase n'expose aucun référentiel des pays ni des nationalités : leurs
// identifiants sont déduits des salariés déjà présents (`construireReferentiels`). Une nationalité
// qu'aucun salarié n'a encore n'est donc pas transmise : la RH la complète dans Pégase.

const CODE_CIVILITE = { monsieur: 'M.', madame: 'Mme' };

const CODE_SITUATION_FAMILIALE = {
  celibataire: 'Célibat',
  marie: 'Marié',
  pacse: 'Pacs',
  divorce: 'Divorcé',
  veuf: 'Veuf',
};

// Poste de la demande DPAE, avec les libellés de la fiche DPAE (DetailDemandeDpae.jsx), sauf
// Femme/Valet de chambre abrégé en F/VDC : le nom Pégase est limité à 50 caractères.
const LIBELLE_POSTE_DPAE = {
  femme_valet_chambre: 'F/VDC',
  cafetier: 'Cafetier',
  equipier: 'Équipier',
  gouvernant: 'Gouvernant(e)',
};

// Longueurs maximales de la doc : Pégase refuse une valeur trop longue plutôt que de la tronquer.
const tronquer = (valeur, longueur) => (valeur ? String(valeur).trim().slice(0, longueur) : undefined);

// Comparaison insensible aux accents, à la casse, aux tirets et aux espaces multiples.
function normaliserTexte(valeur) {
  return String(valeur ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

const deuxChiffres = (nombre) => String(nombre).padStart(2, '0');

// Le pilote pg renvoie une colonne `date` comme minuit heure locale : composantes locales.
function dateIso(valeur) {
  if (!valeur) return undefined;
  if (valeur instanceof Date) {
    return Number.isNaN(valeur.getTime()) ? undefined : `${valeur.getFullYear()}-${deuxChiffres(valeur.getMonth() + 1)}-${deuxChiffres(valeur.getDate())}`;
  }
  return String(valeur).slice(0, 10);
}

// Les 13 premiers chiffres du NIR, sans la clé : Pégase stocke « 1234567890123-45 », parfois sans
// clé ou avec des espaces. Moins de 13 chiffres : NIR inexploitable pour la comparaison.
function racineNir(nir) {
  const chiffres = String(nir ?? '').replace(/\D/g, '');
  return chiffres.length >= 13 ? chiffres.slice(0, 13) : null;
}

function numeroSsPegase(nir) {
  const chiffres = String(nir ?? '').replace(/\D/g, '');
  return chiffres.length === 15 ? `${chiffres.slice(0, 13)}-${chiffres.slice(13)}` : undefined;
}

// Département de naissance, lu dans le NIR (positions 6-7, 3 chiffres pour l'outre-mer) ; « 99 »
// = né à l'étranger.
function departementNaissance(nir) {
  const chiffres = String(nir ?? '').replace(/\D/g, '');
  if (chiffres.length < 13) return null;
  const departement = chiffres.slice(5, 7);
  if (departement === '99') return null;
  return departement === '97' || departement === '98' ? chiffres.slice(5, 8) : departement;
}

function libellePoste(demande) {
  if (demande.poste === 'autre') return demande.poste_autre?.trim() || null;
  return LIBELLE_POSTE_DPAE[demande.poste] ?? demande.poste ?? null;
}

// Nom de la fiche Pégase : « # POSTE PRÉNOM NOM », en majuscules (poste de la DPAE). Le « # » distingue les salariés
// créés par l'application.
function nomPegase({ demande, candidat }) {
  const morceaux = ['#', libellePoste(demande), candidat.prenom, candidat.nom].filter(Boolean);
  return morceaux
    .map((morceau) => String(morceau).trim())
    .join(' ')
    .toLocaleUpperCase('fr-FR');
}

// Identifiants Pégase des nationalités (par libellé normalisé) et de la France, déduits des
// salariés existants.
function construireReferentiels(salaries) {
  const nationalites = new Map();
  let idFrance = null;
  for (const salarie of salaries) {
    if (salarie.nationalite && salarie.nomNationalite) nationalites.set(normaliserTexte(salarie.nomNationalite), String(salarie.nationalite));
    if (!idFrance && salarie.pays && normaliserTexte(salarie.libellePays) === 'FRANCE') idFrance = String(salarie.pays);
  }
  return { nationalites, idFrance };
}

// Salarié déjà présent dans Pégase : même NIR (13 premiers chiffres), ou à défaut mêmes nom,
// prénom et date de naissance (NIR absent ou mal saisi d'un côté ou de l'autre).
function trouverDoublon(salaries, { nir, nom, prenom, dateNaissance }) {
  const racine = racineNir(nir);
  if (racine) {
    const memeNir = salaries.find((salarie) => racineNir(salarie.numeroSS) === racine);
    if (memeNir) return { salarie: memeNir, motif: 'même n° de sécurité sociale' };
  }
  // Fiche créée par l'application : son nom (« # POSTE PRÉNOM NOM ») se termine par le prénom et le nom.
  const prenomNom = normaliserTexte(`${prenom} ${nom}`);
  const memeIdentite = salaries.find((salarie) => {
    if (dateIso(salarie.dateNaissance) !== dateIso(dateNaissance)) return false;
    const nomSalarie = normaliserTexte(salarie.nom);
    if (String(salarie.nom ?? '').trim().startsWith('#')) return nomSalarie === prenomNom || nomSalarie.endsWith(` ${prenomNom}`);
    return nomSalarie === normaliserTexte(nom) && normaliserTexte(salarie.prenom) === normaliserTexte(prenom);
  });
  return memeIdentite ? { salarie: memeIdentite, motif: 'mêmes nom, prénom et date de naissance' } : null;
}

// Fiche salarié à créer. `candidat` : forme de dossierRepository.trouverInscriptionCompleteParDossierId ;
// `coordonnees` : bloc « coordonnees » ; `demande` : ligne de demandes_dpae ; `nir` : déchiffré
// (chaîne vide si absent) ; `agence` : celle de la base Pégase visée. Renvoie aussi les avertissements : champs que la RH devra compléter.
// IBAN, BIC et titre d'identité ne sont pas encore saisis dans l'application.
function construireSalariePegase({ candidat, coordonnees = {}, nir, demande, agence, referentiels }) {
  const avertissements = [];

  const codeCivilite = CODE_CIVILITE[candidat.civilite];
  if (!codeCivilite) avertissements.push('Civilité non transmise.');

  const codeSituationFamiliale = CODE_SITUATION_FAMILIALE[candidat.situationFamiliale];
  if (!codeSituationFamiliale) avertissements.push('Situation familiale non transmise.');

  const nationalite = candidat.nationalite ? referentiels.nationalites.get(normaliserTexte(candidat.nationalite)) : undefined;
  if (candidat.nationalite && !nationalite) avertissements.push(`Nationalité « ${candidat.nationalite} » inconnue de Pégase : à saisir dans Pégase.`);

  const numeroSS = numeroSsPegase(nir);
  if (!numeroSS) avertissements.push('N° de sécurité sociale absent : à saisir dans Pégase.');

  const departement = departementNaissance(nir);
  const paysNaissance = departement && referentiels.idFrance ? referentiels.idFrance : undefined;
  if (numeroSS && !paysNaissance) avertissements.push('Pays de naissance non transmis (né à l’étranger) : à saisir dans Pégase.');

  const salarie = {
    codeCivilite,
    nom: tronquer(nomPegase({ demande, candidat }), 50),
    prenom: tronquer(candidat.prenom, 50),
    nomNaissance: tronquer(candidat.nomNaissance || candidat.nom, 50),
    dateNaissance: dateIso(candidat.dateNaissance),
    lieuNaissance: tronquer(candidat.lieuNaissance, 50),
    depNaissance: departement ?? undefined,
    paysNaissance,
    nationalite,
    numeroSS,
    codeSituationFamiliale,
    agence,
    adresse: tronquer(coordonnees.adresse, 200),
    codePostal: tronquer(coordonnees.codePostal, 10),
    ville: tronquer(coordonnees.ville, 50),
    pays: referentiels.idFrance ?? undefined,
    mobile: tronquer(coordonnees.telephone, 20),
    email: tronquer(coordonnees.email || candidat.email, 200),
    anciennete: dateIso(demande.date_debut),
    typeAgent: 0,
    commentaire: `Créé depuis l'application d'inscription (demande DPAE n° ${demande.id}).`,
  };

  // Champs vides retirés : un champ absent laisse Pégase appliquer sa valeur par défaut.
  return {
    salarie: Object.fromEntries(Object.entries(salarie).filter(([, valeur]) => valeur !== undefined && valeur !== null && valeur !== '')),
    avertissements,
  };
}

module.exports = {
  normaliserTexte,
  racineNir,
  numeroSsPegase,
  departementNaissance,
  construireReferentiels,
  trouverDoublon,
  nomPegase,
  construireSalariePegase,
};
