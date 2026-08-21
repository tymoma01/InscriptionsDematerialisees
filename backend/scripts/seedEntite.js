// Amorce une ligne de la table `entites` à partir du fichier entite.config.json d'une entité
// (voir architecture-technique.md §1.3 : les *.config.json servent de source de seed, jamais
// lus directement par le moteur applicatif). Idempotent : ré-exécutable sans dupliquer la ligne.
//
// Usage : node scripts/seedEntite.js <code_entite>
// Exemple : node scripts/seedEntite.js accecit

const path = require('path');
const { obtenirKnex } = require('../src/db/knex');

async function seedEntite(codeEntite) {
  const config = require(path.join(__dirname, '..', 'src', 'entites', codeEntite, 'entite.config.json'));

  const bd = await obtenirKnex();
  try {
    const existante = await bd('entites').where({ code: config.code }).first();
    // smartof_config (migration 050) : jsonb, comme dossier_donnees_formulaire.donnees ailleurs
    // dans le code (dossierRepository.enregistrerDonneesBloc) — nécessite un JSON.stringify
    // explicite avant insert/update, knex ne le fait pas lui-même pour une colonne jsonb.
    // Défaut '{}' si absent du fichier de config (entité sans SmartOF actif, voir migration 050).
    const smartofConfig = JSON.stringify(config.smartof_config ?? {});

    if (existante) {
      await bd('entites').where({ code: config.code }).update({
        nom: config.nom,
        connecteur_stockage: config.connecteur_stockage,
        sms_actif: config.sms_actif,
        canal_rappel: config.canal_rappel,
        smartof_actif: config.smartof_actif,
        smartof_config: smartofConfig,
        duree_conservation_mois: config.duree_conservation_mois,
        actif: config.actif,
      });
      console.log(`Entité « ${config.code} » déjà présente (id=${existante.id}) — mise à jour ✔`);
    } else {
      const [inseree] = await bd('entites')
        .insert({ ...config, smartof_config: smartofConfig })
        .returning('id');
      console.log(`Entité « ${config.code} » créée (id=${inseree.id}) ✔`);
    }
  } finally {
    await bd.destroy();
  }
}

const codeEntite = process.argv[2];
if (!codeEntite) {
  console.error('Usage : node scripts/seedEntite.js <code_entite>');
  process.exit(1);
}

seedEntite(codeEntite).catch((erreur) => {
  console.error('Échec du seed ✘');
  console.error(erreur.message);
  process.exit(1);
});
