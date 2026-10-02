// Données de test « Étudiant » — base de DEV UNIQUEMENT (2026-10-02).
//
// Crée 6 dossiers candidats fictifs (« TEST-ETUDIANT 01 Awa » … « TEST-ETUDIANT 06 Marie-Évangéline »)
// comme une VRAIE inscription : même fonction que POST /api/candidats (candidats.routes.js) —
// dossierService.inscrireCandidat (validation du formulaire, chiffrement du NIR, contrôles d'unicité,
// statut initial et passage automatique, signature de la charte) — puis la même entrée journal_audit
// que la route (« dossier_inscription_creation »).
//   - 3 dossiers « Êtes-vous étudiant ? » = Oui, 3 = Non ;
//   - Hôtellerie et Tertiaire, plusieurs postes, les 4 niveaux d'expérience ;
//   - un nom très long (« TEST-ETUDIANT 06 Marie-Évangéline », 33 caractères) pour la colonne Candidat.
// Données fictives : e-mails en @exemple.test, téléphones et NIR fictifs.
//
// Usage (depuis backend/, az login préalable) :
//   node scripts/seedDossiersEtudiantDev.js              crée les dossiers manquants (idempotent)
//   node scripts/seedDossiersEtudiantDev.js --supprimer  supprime ces dossiers et leurs données liées
//
// Idempotent : un dossier dont l'e-mail existe déjà dans l'entité n'est pas recréé.
// --supprimer : supprime UNIQUEMENT les candidats de l'entité dont le nom commence par
// « TEST-ETUDIANT », leurs dossiers et toutes les données qui en dépendent (blocs du formulaire,
// historique, notes, relances, rendez-vous, évaluations, pièces — fichier compris, via
// pieceJustificativeService —, signature de la charte…). Une demande DPAE rattachée à l'un de ces
// candidats n'est pas supprimée : seul son lien vers le candidat est retiré. journal_audit n'est
// jamais modifié.
//
// Sécurité : refuse de tourner si NODE_ENV=production ou si la base visée est celle de production.

const { NODE_ENV } = require('../src/config/env');
const { obtenirConnectionString } = require('../src/db/config');
const { obtenirKnex } = require('../src/db/knex');
const journalAudit = require('../src/core/audit/journalAudit');
const dossierService = require('../src/core/dossier/dossierService');
const pieceJustificativeService = require('../src/core/dossier/pieceJustificativeService');

// Point de terminaison Neon de la base de PRODUCTION (voir docs/architecture-technique.md §6).
const HOTE_NEON_PRODUCTION = 'ep-late-dust-b1rzwwcb';
const PREFIXE_TEST = 'TEST-ETUDIANT';
const CODE_ENTITE = 'accecit';
const ADRESSE_IP = 'script-seed-dev';
// Tables jamais touchées par --supprimer, quelles que soient leurs clés étrangères.
const TABLES_PROTEGEES = new Set(['journal_audit']);

// Signature manuscrite factice (PNG 1×1 transparent), même format que le canvas du formulaire.
const SIGNATURE_FACTICE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function arreter(message) {
  console.error(`\n⛔ ${message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------------------------
// Jeu de données.
// ---------------------------------------------------------------------------------------------
const HOTEL = {
  typePoste: 'hotel',
  creneaux: ['matin', 'soir'],
  joursDisponibles: ['vendredi', 'samedi', 'dimanche'],
};
const BUREAU = {
  typePoste: 'bureau',
  creneaux: ['6h-9h', '18h-21h'],
  joursDisponibles: ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi'],
};

const DOSSIERS = [
  { numero: '01', civilite: 'madame', prenom: 'Awa', estEtudiant: true, ...HOTEL, posteHotel: ['femme_valet_chambre'], experience: 'aucune' },
  { numero: '02', civilite: 'monsieur', prenom: 'Bilal', estEtudiant: false, ...BUREAU, posteBureau: ['nettoyage', 'vitrerie'], experience: 'plus_6_mois' },
  { numero: '03', civilite: 'madame', prenom: 'Chloé', estEtudiant: true, ...HOTEL, posteHotel: ['cafetier', 'equipier'], experience: 'plus_2_ans' },
  { numero: '04', civilite: 'monsieur', prenom: 'Dylan', estEtudiant: false, ...HOTEL, posteHotel: ['gouvernant'], experience: 'plus_5_ans' },
  { numero: '05', civilite: 'madame', prenom: 'Emma', estEtudiant: true, ...BUREAU, posteBureau: ['chef_equipe'], experience: 'plus_6_mois' },
  // Nom très long (33 caractères avec le prénom) : largeur de la colonne Candidat.
  { numero: '06', civilite: 'madame', prenom: 'Marie-Évangéline', estEtudiant: false, ...BUREAU, posteBureau: ['machiniste', 'autres'], experience: 'aucune' },
];

const email = (numero) => `test-etudiant-${numero}@exemple.test`;

// Corps identique à celui que la tablette envoie à POST /api/candidats (formulaire complet).
function corpsInscription(d) {
  const experimente = d.experience !== 'aucune';
  return {
    civilite: d.civilite,
    nom: `${PREFIXE_TEST} ${d.numero}`,
    nomNaissance: '',
    lieuNaissance: 'Paris',
    nationalite: 'Française',
    prenom: d.prenom,
    dateNaissance: `200${Number(d.numero) % 6}-0${(Number(d.numero) % 9) + 1}-15`,
    // NIR fictif (15 chiffres, département 99), unique par dossier : exerce le chiffrement.
    nir: `${d.civilite === 'madame' ? 2 : 1}0501999990${d.numero}${d.numero}`,
    situationFamiliale: 'celibataire',
    adresse: `${Number(d.numero)} rue de l'Exemple`,
    codePostal: '75011',
    ville: 'Paris',
    telephone: `06 00 00 00 ${d.numero}`,
    email: email(d.numero),
    contactUrgenceNom: 'Contact Fictif',
    contactUrgenceTelephone: `06 00 00 01 ${d.numero}`,
    estEtudiant: d.estEtudiant,
    disponibiliteImmediate: true,
    dateDebut: '',
    dateFin: '',
    creneaux: d.creneaux,
    joursDisponibles: d.joursDisponibles,
    languesParlees: ['francais'],
    autreLanguePrecision: '',
    typePoste: d.typePoste,
    posteBureau: d.posteBureau ?? [],
    posteHotel: d.posteHotel ?? [],
    experience: d.experience,
    experienceLieu: experimente ? 'Entreprise fictive' : '',
    experienceMissions: experimente ? 'Missions fictives de test' : '',
    commentConnu: 'bouche_a_oreille',
    commentConnuPrecision: '',
    cas1CmuC: 'non',
    cas2Acs: 'non',
    cas3MutuelleIndividuelle: 'non',
    cas4MutuelleCollective: 'non',
    certificationAucuneDispense: true,
    consentementDiffusion: 'refuse',
    signatureImage: '',
    charteMention: 'Lu et approuvé',
    charteSignatureImage: SIGNATURE_FACTICE,
  };
}

// ---------------------------------------------------------------------------------------------
// Sécurité.
// ---------------------------------------------------------------------------------------------
async function verifierBaseDeDev() {
  if (NODE_ENV === 'production') arreter('NODE_ENV=production : ce script ne s’exécute que sur la base de DEV.');
  const hote = new URL(await obtenirConnectionString()).hostname;
  if (hote.includes(HOTE_NEON_PRODUCTION)) arreter(`La base visée (${hote}) est celle de PRODUCTION : arrêt, rien n’a été modifié.`);
  return hote;
}

// ---------------------------------------------------------------------------------------------
// Création.
// ---------------------------------------------------------------------------------------------
async function creer(bd, entite) {
  let crees = 0;
  for (const d of DOSSIERS) {
    const libelle = `${PREFIXE_TEST} ${d.numero} ${d.prenom}`;
    // eslint-disable-next-line no-await-in-loop
    const existant = await bd('candidats as c')
      .join('dossiers as d', 'd.candidat_id', 'c.id')
      .where({ 'c.entite_id': entite.id, 'c.email': email(d.numero) })
      .first('d.id as dossierId');
    if (existant) {
      console.log(`  = ${libelle} : déjà présent (dossier n° ${existant.dossierId}), non recréé.`);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const { candidatId, dossierId } = await dossierService.inscrireCandidat(entite, corpsInscription(d));
    // Même trace que la route POST /api/candidats (inscription depuis la tablette, sans compte).
    // eslint-disable-next-line no-await-in-loop
    await journalAudit.enregistrerAction(bd, {
      utilisateurId: null,
      entiteId: entite.id,
      action: 'dossier_inscription_creation',
      tableCible: 'dossiers',
      cibleId: dossierId,
      donnees: { candidatId },
      adresseIp: ADRESSE_IP,
    });
    crees += 1;
    console.log(`  + ${libelle} : dossier n° ${dossierId} (${d.estEtudiant ? 'étudiant' : 'non étudiant'}, ${d.typePoste}, ${d.experience}).`);
  }
  return crees;
}

// ---------------------------------------------------------------------------------------------
// Suppression (--supprimer).
// ---------------------------------------------------------------------------------------------

// Clés étrangères de la base qui pointent vers `table` : { table, colonne, nullable }.
async function referencesVers(bd, table) {
  const resultat = await bd.raw(
    `SELECT kcu.table_name AS table, kcu.column_name AS colonne, (c.is_nullable = 'YES') AS nullable
     FROM information_schema.referential_constraints rc
     JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = rc.constraint_name AND kcu.table_schema = rc.constraint_schema
     JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = rc.unique_constraint_name AND ccu.table_schema = rc.unique_constraint_schema
     JOIN information_schema.columns c ON c.table_schema = kcu.table_schema AND c.table_name = kcu.table_name AND c.column_name = kcu.column_name
     WHERE kcu.table_schema = 'public' AND ccu.table_name = ? AND ccu.column_name = 'id'`,
    [table],
  );
  return resultat.rows;
}

async function aUneColonneId(bd, table) {
  const resultat = await bd.raw(
    "SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ? AND column_name = 'id'",
    [table],
  );
  return resultat.rows.length > 0;
}

// Supprime les lignes `ids` de `table` et, d'abord, tout ce qui en dépend (clés étrangères
// découvertes dans la base : aucune table liée oubliée si le schéma évolue). Référence facultative
// (colonne nullable) : lien retiré (NULL), ligne conservée. Tables protégées : jamais touchées.
async function supprimerAvecDependances(trx, table, ids, bilan) {
  if (ids.length === 0) return;
  for (const reference of await referencesVers(trx, table)) {
    if (TABLES_PROTEGEES.has(reference.table)) continue;
    if (reference.nullable) {
      const detaches = await trx(reference.table).whereIn(reference.colonne, ids).update({ [reference.colonne]: null });
      if (detaches > 0) bilan.push(`${reference.table} : ${detaches} lien(s) retiré(s)`);
      continue;
    }
    if (await aUneColonneId(trx, reference.table)) {
      const idsEnfants = await trx(reference.table).whereIn(reference.colonne, ids).pluck('id');
      await supprimerAvecDependances(trx, reference.table, idsEnfants, bilan);
    } else {
      const supprimees = await trx(reference.table).whereIn(reference.colonne, ids).del();
      if (supprimees > 0) bilan.push(`${reference.table} : ${supprimees}`);
    }
  }
  const supprimees = await trx(table).whereIn('id', ids).del();
  if (supprimees > 0) bilan.push(`${table} : ${supprimees}`);
}

async function supprimer(bd, entite) {
  const candidats = await bd('candidats').where({ entite_id: entite.id }).andWhere('nom', 'like', `${PREFIXE_TEST}%`).select('id', 'nom', 'prenom');
  if (candidats.length === 0) {
    console.log('Aucun dossier de test « Étudiant » à supprimer.');
    return;
  }
  const idsCandidats = candidats.map((c) => c.id);
  const idsDossiers = await bd('dossiers').whereIn('candidat_id', idsCandidats).pluck('id');

  // Pièces justificatives : supprimées par le service de l'application, qui retire aussi le fichier
  // du stockage documentaire (sinon il resterait orphelin dans OneDrive/SharePoint).
  const pieces = await bd('pieces_justificatives').whereIn('dossier_id', idsDossiers).pluck('id');
  for (const pieceId of pieces) {
    // eslint-disable-next-line no-await-in-loop
    await pieceJustificativeService.supprimerPieceJustificative(entite, pieceId, 'admin');
  }
  if (pieces.length > 0) console.log(`  Pièces justificatives supprimées (fichiers compris) : ${pieces.length}.`);

  // Rendez-vous synchronisés avec Outlook : l'événement du calendrier n'est pas supprimé ici.
  const evenementsOutlook = await bd('rendezvous').whereIn('dossier_id', idsDossiers).whereNotNull('outlook_event_id').count('* as n').first();
  if (Number(evenementsOutlook.n) > 0) {
    console.warn(`  ⚠ ${evenementsOutlook.n} rendez-vous de ces dossiers ont un événement Outlook : à retirer du calendrier à la main.`);
  }

  const bilan = [];
  await bd.transaction(async (trx) => {
    await supprimerAvecDependances(trx, 'dossiers', idsDossiers, bilan);
    await supprimerAvecDependances(trx, 'candidats', idsCandidats, bilan);
  });
  console.log(`  Candidats supprimés : ${candidats.map((c) => `${c.nom} ${c.prenom}`).join(', ')}.`);
  console.log(`  Détail : ${bilan.join(' ; ')}.`);
  console.log('  journal_audit : inchangé.');
}

// ---------------------------------------------------------------------------------------------
async function principal() {
  const hote = await verifierBaseDeDev();
  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: CODE_ENTITE }).first();
    if (!entite) arreter(`Entité « ${CODE_ENTITE} » introuvable.`);
    console.log(`Base de DEV (${hote}), entité « ${entite.code} ».`);
    if (process.argv.includes('--supprimer')) {
      await supprimer(bd, entite);
    } else {
      const crees = await creer(bd, entite);
      console.log(`\n${crees} dossier(s) créé(s), ${DOSSIERS.length - crees} déjà présent(s).`);
    }
  } finally {
    await bd.destroy();
  }
}

principal().catch((erreur) => {
  console.error(erreur);
  process.exit(1);
});
