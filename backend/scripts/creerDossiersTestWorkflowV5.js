// Crée 10 dossiers candidats de test en appelant le VRAI endpoint public d'inscription
// (POST /api/candidats, voir candidats.routes.js) — exactement le flux emprunté par le
// formulaire tablette, pas une insertion directe en base : candidat + dossier + tous les blocs
// (coordonnées/disponibilités/mutuelle/consentement RGPD) + signature de charte sont créés
// via dossierService.inscrireCandidat, statut initial "nouveau" (Inscrit) résolu dynamiquement
// (workflowRepository, pas codé en dur ici — voir Modularité, CLAUDE.md).
// Utile pour valider manuellement le workflow v5 (Inscrit → En attente de pièces → Test non
// planifié → Test planifié → Test réalisé → verdict) sans passer par la saisie tactile.
// Préfixe "WORKFLOW" sur le nom : facilement repérable/filtrable dans la liste des dossiers, et
// à nettoyer manuellement une fois les tests terminés (pas de suppression automatique ici — un
// dossier candidat n'est jamais supprimé silencieusement par un script, voir CLAUDE.md RGPD
// "droit de suppression" : c'est un choix explicite, pas un effet de bord d'un script de seed).
//
// Usage : node scripts/creerDossiersTestWorkflowV5.js [urlBase]
// urlBase par défaut : http://localhost:3001

const urlBase = process.argv[2] || 'http://localhost:3001';

// 1x1 PNG transparent — signature de charte factice mais un base64 image/png valide (le back ne
// vérifie que la présence d'une chaîne non vide, voir donneesInscriptionSchema.charteSignatureImage
// et son décodage Buffer.from(..., 'base64') dans dossierService.inscrireCandidat).
const SIGNATURE_FACTICE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

// Clé NIR calculée (97 - nir13 % 97), comme un vrai NIR — pas nécessaire pour passer la
// validation (NIR_REGEX ne vérifie que le nombre de chiffres, pas la clé), mais plus réaliste.
function nirAvecCle(nir13) {
  const cle = String(97 - (Number(nir13) % 97)).padStart(2, '0');
  return `${nir13}${cle}`;
}

const VILLES = ['Paris', 'Gentilly', 'Ivry', 'Lyon', 'Nantes', 'Bordeaux', 'Lille', 'Rennes', 'Toulon', 'Reims'];

const CANDIDATS = [
  // --- Hôtellerie (5) ---
  { prenom: 'Candidat1', civilite: 'madame', typePoste: 'hotel', postes: ['femme_valet_chambre'] },
  { prenom: 'Candidat2', civilite: 'monsieur', typePoste: 'hotel', postes: ['gouvernant'] },
  { prenom: 'Candidat3', civilite: 'madame', typePoste: 'hotel', postes: ['cafetier'] },
  { prenom: 'Candidat4', civilite: 'monsieur', typePoste: 'hotel', postes: ['equipier'] },
  { prenom: 'Candidat5', civilite: 'madame', typePoste: 'hotel', postes: ['femme_valet_chambre', 'gouvernant'] },
  // --- Tertiaire (5) ---
  { prenom: 'Candidat6', civilite: 'monsieur', typePoste: 'bureau', postes: ['nettoyage'] },
  { prenom: 'Candidat7', civilite: 'madame', typePoste: 'bureau', postes: ['chef_equipe'] },
  { prenom: 'Candidat8', civilite: 'monsieur', typePoste: 'bureau', postes: ['vitrerie'] },
  { prenom: 'Candidat9', civilite: 'madame', typePoste: 'bureau', postes: ['machiniste'] },
  { prenom: 'Candidat10', civilite: 'monsieur', typePoste: 'bureau', postes: ['nettoyage', 'chef_equipe'] },
];

function construirePayload(candidat, index) {
  const sexe = candidat.civilite === 'monsieur' ? '1' : '2';
  const mois = String((index % 12) + 1).padStart(2, '0');
  const ordre = String(index + 1).padStart(3, '0');
  const nir13 = `${sexe}90${mois}75001${ordre}`;
  const ville = VILLES[index % VILLES.length];
  const telephone = `06${String(10000000 + index).padStart(8, '0')}`;
  const contactTelephone = `07${String(20000000 + index).padStart(8, '0')}`;

  const base = {
    civilite: candidat.civilite,
    nom: 'WORKFLOW',
    nomNaissance: '',
    lieuNaissance: ville,
    nationalite: 'Française',
    prenom: candidat.prenom,
    dateNaissance: `1990-0${(index % 9) + 1}-15`,
    nir: nirAvecCle(nir13),
    situationFamiliale: 'Célibataire',
    adresse: `${10 + index} rue de Test`,
    codePostal: '75001',
    ville,
    telephone,
    email: `workflow-test-${index + 1}@accecit.test`,
    contactUrgenceNom: 'Contact Urgence',
    contactUrgenceTelephone: contactTelephone,
    disponibiliteImmediate: true,
    dateDebut: '',
    dateFin: '',
    joursDisponibles:
      candidat.typePoste === 'hotel'
        ? ['lundi', 'mardi', 'samedi', 'dimanche']
        : ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi'],
    creneaux: candidat.typePoste === 'hotel' ? ['matin', 'midi'] : ['6h-9h', '9h-18h'],
    languesParlees: ['francais'],
    autreLanguePrecision: '',
    typePoste: candidat.typePoste,
    posteBureau: candidat.typePoste === 'bureau' ? candidat.postes : [],
    posteHotel: candidat.typePoste === 'hotel' ? candidat.postes : [],
    commentConnu: 'bouche_a_oreille',
    commentConnuPrecision: '',
    cas1CmuC: 'non',
    cas2Acs: 'non',
    cas3MutuelleIndividuelle: 'non',
    cas4MutuelleCollective: 'non',
    certificationAucuneDispense: true,
    consentementDiffusion: 'refuse',
    signatureImage: '',
    charteMention: 'Lu et Approuvé',
    charteSignatureImage: SIGNATURE_FACTICE,
  };

  return base;
}

async function creerDossier(candidat, index) {
  const payload = construirePayload(candidat, index);
  const reponse = await fetch(`${urlBase}/api/candidats`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const corps = await reponse.json();
  if (!reponse.ok) {
    throw new Error(`Échec inscription « ${payload.prenom} ${payload.nom} » (HTTP ${reponse.status}) : ${JSON.stringify(corps)}`);
  }
  return { ...corps, prenom: payload.prenom, nom: payload.nom, typePoste: payload.typePoste, postes: candidat.postes };
}

(async () => {
  const resultats = [];
  for (let i = 0; i < CANDIDATS.length; i += 1) {
    try {
      const resultat = await creerDossier(CANDIDATS[i], i);
      resultats.push(resultat);
      console.log(
        `✔ ${resultat.prenom} ${resultat.nom} (${resultat.typePoste}, ${resultat.postes.join('+')}) — dossier ${resultat.dossierId}, candidat ${resultat.candidatId}`,
      );
    } catch (erreur) {
      console.error(`✘ ${CANDIDATS[i].prenom} :`, erreur.message);
    }
  }

  console.log(`\n${resultats.length}/${CANDIDATS.length} dossiers créés avec succès.`);
})();
