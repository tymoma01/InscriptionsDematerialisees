// Formulaire DPAE du Tertiaire (modèle papier) :
//  - demandes_dpae : motif d'absence d'un remplacement et catégorie de qualification (le « poste » d'une
//    demande du Tertiaire reste renseigné avec le même code, pour les statistiques) — colonnes
//    ajoutées, aucune donnée existante modifiée ;
//  - sites_affectation : secteur (les sites existants restent « hotellerie »), adresse, auteur de la
//    création, et initiales facultatives (les sites du Tertiaire n'en ont pas ; l'index unique sur les
//    initiales ignore les valeurs nulles) ;
//  - configuration DPAE du Tertiaire (`entites.dpae_config.tertiaire`) : libellé de la date d'embauche,
//    types de contrat, motifs de CDD, longueur des textes et qualifications. Les listes de qualifications
//    sont PROVISOIRES : à valider et compléter dans la configuration, sans toucher au code.
const CONFIG_TERTIAIRE = {
  formulaire: {
    libelle_date_debut: 'Date d’embauche (ou journée de doublon)',
    types_contrat: ['cdd', 'cdi'],
    motifs_cdd: [
      { code: 'surcroit_activite', libelle: 'Surcroît d’activité' },
      { code: 'remplacement_absent', libelle: 'Remplacement d’un salarié' },
    ],
    limite_texte: 100,
  },
  qualifications: [
    { code: 'agent_service', libelle: 'Agent de service', echelons: ['AS1', 'AS2', 'AS3'] },
    { code: 'laveur_vitres_machiniste', libelle: 'Laveur de vitres - Machiniste', echelons: ['AQS1', 'AQS2', 'AQS3', 'ATQS1', 'ATQS2'] },
    { code: 'chef_equipe', libelle: 'Chef d’équipe', echelons: ['CE1', 'CE2', 'CE3'] },
    { code: 'agent_maitrise', libelle: 'Agent de maîtrise', echelons: ['MP1', 'MP2', 'MP3'] },
  ],
};

exports.up = async (knex) => {
  await knex.schema.alterTable('demandes_dpae', (table) => {
    table.string('motif_absence', 100).nullable();
    table.string('categorie_qualification').nullable();
  });
  await knex.schema.alterTable('sites_affectation', (table) => {
    table.string('secteur').notNullable().defaultTo('hotellerie');
    table.string('adresse', 200).nullable();
    table.integer('cree_par_id').nullable().references('id').inTable('utilisateurs');
  });
  await knex.raw('ALTER TABLE sites_affectation ALTER COLUMN initiales DROP NOT NULL');
  await knex.raw(`UPDATE entites SET dpae_config = dpae_config || ?::jsonb WHERE code = 'accecit'`, [JSON.stringify({ tertiaire: CONFIG_TERTIAIRE })]);
};

exports.down = async (knex) => {
  await knex.raw(`UPDATE entites SET dpae_config = dpae_config - 'tertiaire' WHERE code = 'accecit'`);
  // Les sites du Tertiaire (sans initiales) disparaissent avec leur colonne de secteur : retirés si aucune demande ne les utilise.
  await knex.raw(`DELETE FROM sites_affectation WHERE secteur = 'tertiaire' AND NOT EXISTS (SELECT 1 FROM demandes_dpae_sites l WHERE l.site_affectation_id = sites_affectation.id)`);
  await knex.schema.alterTable('sites_affectation', (table) => {
    table.dropColumn('cree_par_id');
    table.dropColumn('adresse');
    table.dropColumn('secteur');
  });
  await knex.schema.alterTable('demandes_dpae', (table) => {
    table.dropColumn('categorie_qualification');
    table.dropColumn('motif_absence');
  });
};

exports.CONFIG_TERTIAIRE = CONFIG_TERTIAIRE;
