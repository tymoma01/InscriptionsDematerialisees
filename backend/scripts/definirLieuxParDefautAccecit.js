// Correctif ponctuel — marque les deux lieux ACCECIT déjà en base (voir audit du 2026-08-27,
// migration 054) comme lieu par défaut de leur secteur : "Bureau ACCECIT" pour le secteur bureau,
// "Hôtel du Cadran" pour le secteur hôtel. Passe par lieuService.definirLieuParDefaut (même chemin
// applicatif que la case "Définir comme lieu par défaut pour ce secteur", ModalePlanificationTest.jsx)
// plutôt qu'un UPDATE direct — garantit la même bascule transactionnelle et le même index unique
// partiel que la voie normale. Idempotent : relancer ce script sur des lieux déjà corrects ne fait
// que réappliquer la même valeur.
//
// Usage : node scripts/definirLieuxParDefautAccecit.js

const { obtenirKnex } = require('../src/db/knex');
const lieuRepository = require('../src/core/lieux/lieuRepository');

const CODE_ENTITE = 'accecit';

// Adresses vérifiées en base au moment de l'audit (voir CLAUDE.md) — ce script échoue plutôt que
// de deviner si l'une des deux ne matche plus exactement (adresse corrigée entre-temps, etc.).
const LIEUX_PAR_DEFAUT = [
  { adresse: 'Bureau ACCECIT - 47 avenue Paul Vaillant Couturier, 94250 Gentilly', secteur: 'bureau' },
  { adresse: 'Hôtel du Cadran - 14 Rue de Valadon, 75007 Paris', secteur: 'hotel' },
];

async function main() {
  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: CODE_ENTITE }).first();
    if (!entite) {
      throw new Error(`Entité « ${CODE_ENTITE} » introuvable.`);
    }

    for (const { adresse, secteur } of LIEUX_PAR_DEFAUT) {
      // eslint-disable-next-line no-await-in-loop -- deux lieux seulement, séquentiel suffisant.
      const lieu = await bd('lieux').where({ entite_id: entite.id, adresse }).first();
      if (!lieu) {
        throw new Error(`Lieu introuvable pour l'adresse « ${adresse} » — arrêt sans rien modifier.`);
      }
      // eslint-disable-next-line no-await-in-loop
      await bd.transaction((trx) => lieuRepository.definirLieuParDefaut(trx, entite.id, lieu.id, secteur));
      console.log(`Lieu #${lieu.id} (« ${adresse} ») défini par défaut pour le secteur « ${secteur} » ✔`);
    }
  } finally {
    await bd.destroy();
  }
}

main().catch((erreur) => {
  console.error('Échec du correctif ✘');
  console.error(erreur.message);
  process.exitCode = 1;
});
