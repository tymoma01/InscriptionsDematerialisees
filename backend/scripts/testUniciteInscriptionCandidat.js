// Test d'intégration bout en bout de la vérification d'unicité NIR/email à l'inscription
// (voir commit e77c1e4, dossierService.inscrireCandidat) — contrairement à nirCipher.test.js
// (Key Vault mocké), ce script utilise la vraie base Neon de dev et les vrais secrets Key Vault
// (nir-encryption-key, nir-hmac-key), pour vérifier le comportement réel de bout en bout.
// Usage : node scripts/testUniciteInscriptionCandidat.js (nécessite az login préalable)

const { obtenirKnex } = require('../src/db/knex');
const { inscrireCandidat, ErreurInscriptionConflit } = require('../src/core/dossier/dossierService');

const SUFFIXE_TEST = Date.now();
const SUFFIXE_2CHIFFRES = String(SUFFIXE_TEST).slice(-2);
// NIR_REGEX attend 13 chiffres + 2 chiffres de clé = 15 chiffres au total.
const NIR_TEST = `2850578006123${SUFFIXE_2CHIFFRES}`;
const EMAIL_TEST = `test-unicite-${SUFFIXE_TEST}@exemple-test.local`;

function donneesInscriptionValides(overrides = {}) {
  return {
    nom: 'Dupont',
    prenom: 'Test',
    lieuNaissance: 'Paris',
    nationalite: 'Française',
    dateNaissance: '1990-01-01',
    nir: NIR_TEST,
    situationFamiliale: 'celibataire',
    adresse: '1 rue de Test',
    telephone: '0601020304',
    email: EMAIL_TEST,
    contactUrgenceNom: 'Martin',
    contactUrgenceTelephone: '0601020305',
    disponibiliteImmediate: true,
    creneaux: ['matin'],
    joursDisponibles: ['lundi'],
    typePoste: 'hotel',
    posteHotel: ['equipier'],
    experience: 'aucune',
    commentConnu: 'internet',
    commentConnuPrecision: 'recherche google',
    cas1CmuC: 'non',
    cas2Acs: 'non',
    cas3MutuelleIndividuelle: 'non',
    cas4MutuelleCollective: 'non',
    consentementDiffusion: 'refuse',
    charteMention: 'Lu et Approuvé',
    charteSignatureImage: 'data:image/png;base64,dGVzdC1zaWduYXR1cmU=',
    ...overrides,
  };
}

async function nettoyer(bd, candidatIds) {
  for (const candidatId of candidatIds) {
    const dossier = await bd('dossiers').where({ candidat_id: candidatId }).first();
    if (dossier) {
      await bd('historique_statuts').where({ dossier_id: dossier.id }).del();
      await bd('dossier_donnees_formulaire').where({ dossier_id: dossier.id }).del();
      await bd('dossiers').where({ id: dossier.id }).del();
    }
    await bd('signatures_charte').where({ candidat_id: candidatId }).del();
    await bd('candidats').where({ id: candidatId }).del();
  }
}

async function main() {
  const bd = await obtenirKnex();
  const entite = await bd('entites').where({ code: 'accecit' }).first();
  if (!entite) {
    throw new Error("Entité « accecit » introuvable — impossible d'exécuter le test.");
  }

  const candidatIdsACreer = [];
  let echecs = 0;

  const verifier = (condition, message) => {
    if (condition) {
      console.log(`✔ ${message}`);
    } else {
      echecs += 1;
      console.error(`✘ ${message}`);
    }
  };

  try {
    console.log(`Entité : ${entite.code} (id=${entite.id})`);
    console.log(`NIR de test : ${NIR_TEST} — email de test : ${EMAIL_TEST}\n`);

    // 1. Première inscription : doit réussir.
    const premiere = await inscrireCandidat(entite, donneesInscriptionValides());
    candidatIdsACreer.push(premiere.candidatId);
    verifier(!!premiere.candidatId && !!premiere.dossierId, 'première inscription acceptée');

    // 2. Même NIR, email différent : doit être rejeté sur le NIR.
    try {
      await inscrireCandidat(
        entite,
        donneesInscriptionValides({ email: `autre-${SUFFIXE_TEST}@exemple-test.local` }),
      );
      verifier(false, 'doublon NIR rejeté (aucune exception levée !)');
    } catch (erreur) {
      verifier(
        erreur instanceof ErreurInscriptionConflit && erreur.champ === 'nir',
        `doublon NIR rejeté avec le bon type d'erreur (reçu : ${erreur.constructor.name}${erreur.champ ? `, champ=${erreur.champ}` : ''})`,
      );
    }

    // 3. Même email, NIR différent : doit être rejeté sur l'email.
    try {
      await inscrireCandidat(
        entite,
        donneesInscriptionValides({ nir: `2850578006124${SUFFIXE_2CHIFFRES}` }),
      );
      verifier(false, 'doublon email rejeté (aucune exception levée !)');
    } catch (erreur) {
      verifier(
        erreur instanceof ErreurInscriptionConflit && erreur.champ === 'email',
        `doublon email rejeté avec le bon type d'erreur (reçu : ${erreur.constructor.name}${erreur.champ ? `, champ=${erreur.champ}` : ''})`,
      );
    }

    // 4. NIR et email tous les deux différents : doit réussir (pas de faux positif).
    const troisieme = await inscrireCandidat(
      entite,
      donneesInscriptionValides({
        nir: `2850578006125${SUFFIXE_2CHIFFRES}`,
        email: `distinct-${SUFFIXE_TEST}@exemple-test.local`,
      }),
    );
    candidatIdsACreer.push(troisieme.candidatId);
    verifier(!!troisieme.candidatId, "inscription avec NIR/email distincts acceptée (pas de faux positif)");
  } finally {
    await nettoyer(bd, candidatIdsACreer);
    console.log(`\nNettoyage effectué (${candidatIdsACreer.length} candidat(s) de test supprimé(s)).`);
    await bd.destroy();
  }

  if (echecs > 0) {
    console.error(`\n${echecs} vérification(s) en échec ✘`);
    process.exit(1);
  }
  console.log('\nToutes les vérifications sont passées ✔');
}

main().catch((erreur) => {
  console.error('Échec du test d\'intégration :', erreur);
  process.exit(1);
});
