// Amorce les motifs de désistement d'une entité dans `motifs` (table déjà existante, migration
// 007, générique — categorie 'desistement') — les codes ci-dessous sont ceux d'ACCECIT, pas une
// liste figée valable pour toute entité (voir Modularité, CLAUDE.md — même patron que
// scripts/seedMotifsRelance.js). Idempotent.
//
// Usage : node scripts/seedMotifsDesistement.js <code_entite>

const { obtenirKnex } = require('../src/db/knex');

const CATEGORIE = 'desistement';

const MOTIFS_DESISTEMENT_ACCECIT = [
  { code: 'ne_repond_plus', libelle: 'Ne répond plus' },
  { code: 'indisponible', libelle: 'Finalement indisponible' },
  { code: 'autre_emploi', libelle: 'A trouvé un autre emploi' },
  { code: 'probleme_transport', libelle: 'Problème de transport' },
  { code: 'ne_souhaite_plus', libelle: 'Ne souhaite plus donner suite' },
  { code: 'autre', libelle: 'Autre motif' },
  // Motif dédié (audit 2026-08-20, dossier #84) : posé par basculeTestNonRealiseService.js et par
  // marquerNonRealise (ListeEvaluationsAFaire.jsx) quand un rendez-vous passe à 'absent' suite à
  // un test non réalisé — distinct des motifs ci-dessus (constatés/déclarés par un agent), pour
  // que le futur tableau de bord (CLAUDE.md, "objectiver le phénomène") puisse isoler les absences
  // détectées automatiquement de celles remontées manuellement.
  { code: 'test_non_realise', libelle: 'Test non réalisé (absence constatée au créneau)' },
];

async function seedMotifsDesistement(codeEntite) {
  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: codeEntite }).first();
    if (!entite) {
      throw new Error(`Entité « ${codeEntite} » introuvable — exécuter d'abord scripts/seedEntite.js`);
    }

    for (const motif of MOTIFS_DESISTEMENT_ACCECIT) {
      const existant = await bd('motifs')
        .where({ entite_id: entite.id, categorie: CATEGORIE, code: motif.code })
        .first();
      if (existant) {
        console.log(`Motif de désistement « ${motif.code} » déjà présent pour « ${codeEntite} » (id=${existant.id}) ✔`);
        continue;
      }

      const [inseree] = await bd('motifs')
        .insert({ entite_id: entite.id, categorie: CATEGORIE, code: motif.code, libelle: motif.libelle })
        .returning('id');
      console.log(`Motif de désistement « ${motif.code} » créé pour « ${codeEntite} » (id=${inseree.id}) ✔`);
    }
  } finally {
    await bd.destroy();
  }
}

const codeEntite = process.argv[2];
if (!codeEntite) {
  console.error('Usage : node scripts/seedMotifsDesistement.js <code_entite>');
  process.exit(1);
}

seedMotifsDesistement(codeEntite).catch((erreur) => {
  console.error('Échec du seed ✘');
  console.error(erreur.message);
  process.exit(1);
});
