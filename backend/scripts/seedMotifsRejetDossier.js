// Amorce les motifs de refus de dossier d'une entité dans `motifs` (table déjà existante,
// migration 007) — categorie = 'rejeter_dossier', qui est aussi le code_action de la transition
// correspondante dans workflow.config.json (voir core/workflow/workflowEngine.js : chaque action
// à motif obligatoire cherche ses motifs sous une categorie du même nom que le code_action).
// Codes ci-dessous propres à ACCECIT, pas une liste figée valable pour toute entité (voir
// Modularité, CLAUDE.md — même patron que scripts/seedMotifsRelance.js / seedMotifsDesistement.js).
// Idempotent.
//
// Usage : node scripts/seedMotifsRejetDossier.js <code_entite>

const { obtenirKnex } = require('../src/db/knex');

const CATEGORIE = 'rejeter_dossier';

const MOTIFS_REJET_ACCECIT = [
  { code: 'pieces_non_conformes', libelle: 'Pièces non conformes ou illisibles' },
  { code: 'profil_hors_criteres', libelle: 'Profil ne correspond pas aux critères recherchés' },
  { code: 'incoherence_declarative', libelle: 'Incohérence entre informations déclarées et pièces fournies' },
  { code: 'candidat_desiste', libelle: "Le candidat s'est désisté avant étude du dossier" },
  { code: 'autre', libelle: 'Autre motif' },
];

async function seedMotifsRejetDossier(codeEntite) {
  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: codeEntite }).first();
    if (!entite) {
      throw new Error(`Entité « ${codeEntite} » introuvable — exécuter d'abord scripts/seedEntite.js`);
    }

    for (const motif of MOTIFS_REJET_ACCECIT) {
      const existant = await bd('motifs')
        .where({ entite_id: entite.id, categorie: CATEGORIE, code: motif.code })
        .first();
      if (existant) {
        console.log(`Motif de rejet « ${motif.code} » déjà présent pour « ${codeEntite} » (id=${existant.id}) ✔`);
        continue;
      }

      const [inseree] = await bd('motifs')
        .insert({ entite_id: entite.id, categorie: CATEGORIE, code: motif.code, libelle: motif.libelle })
        .returning('id');
      console.log(`Motif de rejet « ${motif.code} » créé pour « ${codeEntite} » (id=${inseree.id}) ✔`);
    }
  } finally {
    await bd.destroy();
  }
}

const codeEntite = process.argv[2];
if (!codeEntite) {
  console.error('Usage : node scripts/seedMotifsRejetDossier.js <code_entite>');
  process.exit(1);
}

seedMotifsRejetDossier(codeEntite).catch((erreur) => {
  console.error('Échec du seed ✘');
  console.error(erreur.message);
  process.exit(1);
});
