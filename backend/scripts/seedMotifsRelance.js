// Amorce les résultats de relance d'une entité dans `motifs` (table déjà existante, migration
// 007, generique — categorie 'resultat_relance') — les codes ci-dessous sont ceux d'ACCECIT, pas
// une liste figée valable pour toute entité (voir Modularité, CLAUDE.md — même patron que
// scripts/seedTypesPieces.js pour les types de pièces). Idempotent.
//
// Usage : node scripts/seedMotifsRelance.js <code_entite>

const { obtenirKnex } = require('../src/db/knex');

const CATEGORIE = 'resultat_relance';

const RESULTATS_RELANCE_ACCECIT = [
  { code: 'sans_reponse', libelle: 'Sans réponse' },
  { code: 'injoignable', libelle: 'Numéro injoignable / hors service' },
  { code: 'message_laisse', libelle: 'Message laissé (répondeur/proche)' },
  { code: 'a_rappeler', libelle: 'À rappeler plus tard' },
  { code: 'confirme', libelle: 'Présence confirmée' },
  { code: 'decline', libelle: 'A décliné / ne viendra pas' },
  // Résultats déterminés automatiquement pour les canaux sms/email (envoi réel désormais
  // déclenché par l'application, voir relanceService.js, CANAUX_ENVOI_REEL) — jamais choisis
  // librement par l'agent, contrairement aux codes ci-dessus qui décrivent l'issue d'un appel
  // téléphonique.
  { code: 'envoye', libelle: 'Envoyé avec succès' },
  { code: 'echec_envoi', libelle: "Échec de l'envoi" },
];

async function seedMotifsRelance(codeEntite) {
  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: codeEntite }).first();
    if (!entite) {
      throw new Error(`Entité « ${codeEntite} » introuvable — exécuter d'abord scripts/seedEntite.js`);
    }

    for (const resultat of RESULTATS_RELANCE_ACCECIT) {
      const existant = await bd('motifs')
        .where({ entite_id: entite.id, categorie: CATEGORIE, code: resultat.code })
        .first();
      if (existant) {
        console.log(`Résultat de relance « ${resultat.code} » déjà présent pour « ${codeEntite} » (id=${existant.id}) ✔`);
        continue;
      }

      const [inseree] = await bd('motifs')
        .insert({ entite_id: entite.id, categorie: CATEGORIE, code: resultat.code, libelle: resultat.libelle })
        .returning('id');
      console.log(`Résultat de relance « ${resultat.code} » créé pour « ${codeEntite} » (id=${inseree.id}) ✔`);
    }
  } finally {
    await bd.destroy();
  }
}

const codeEntite = process.argv[2];
if (!codeEntite) {
  console.error('Usage : node scripts/seedMotifsRelance.js <code_entite>');
  process.exit(1);
}

seedMotifsRelance(codeEntite).catch((erreur) => {
  console.error('Échec du seed ✘');
  console.error(erreur.message);
  process.exit(1);
});
