// Amorce les lieux de test d'une entité dans `lieux` (table déjà existante, migration 044) — les
// codes ci-dessous sont ceux d'ACCECIT, pas une liste figée valable pour toute entité (voir
// Modularité, CLAUDE.md — même patron que scripts/seedMotifsDesistement.js). Idempotent, et met
// à jour le libellé d'une ligne déjà présente si le texte source a changé depuis (même patron que
// scripts/seedStatuts.js) — sans quoi corriger une coquille ici ne se répercuterait jamais sur une
// ligne déjà seedée.
//
// Usage : node scripts/seedLieux.js <code_entite>

const { obtenirKnex } = require('../src/db/knex');

const LIEUX_ACCECIT = [{ code: 'hotel_du_cadran', libelle: 'Hôtel du Cadran - 14 rue de Valadon, 75007 Paris' }];

async function seedLieux(codeEntite) {
  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: codeEntite }).first();
    if (!entite) {
      throw new Error(`Entité « ${codeEntite} » introuvable — exécuter d'abord scripts/seedEntite.js`);
    }

    for (const lieu of LIEUX_ACCECIT) {
      const existant = await bd('lieux').where({ entite_id: entite.id, code: lieu.code }).first();
      if (existant) {
        if (existant.libelle !== lieu.libelle) {
          await bd('lieux').where({ id: existant.id }).update({ libelle: lieu.libelle });
          console.log(`Lieu « ${lieu.code} » déjà présent pour « ${codeEntite} » (id=${existant.id}) — libellé mis à jour ✔`);
        } else {
          console.log(`Lieu « ${lieu.code} » déjà présent pour « ${codeEntite} » (id=${existant.id}) ✔`);
        }
        continue;
      }

      const [inseree] = await bd('lieux')
        .insert({ entite_id: entite.id, code: lieu.code, libelle: lieu.libelle })
        .returning('id');
      console.log(`Lieu « ${lieu.code} » créé pour « ${codeEntite} » (id=${inseree.id}) ✔`);
    }
  } finally {
    await bd.destroy();
  }
}

const codeEntite = process.argv[2];
if (!codeEntite) {
  console.error('Usage : node scripts/seedLieux.js <code_entite>');
  process.exit(1);
}

seedLieux(codeEntite).catch((erreur) => {
  console.error('Échec du seed ✘');
  console.error(erreur.message);
  process.exit(1);
});
