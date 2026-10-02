// Référentiel des sites d'affectation des demandes DPAE —
// remplace le champ texte libre `demandes_dpae.hotel` (migration 068) par une sélection d'un ou
// plusieurs sites dans une liste gérée, avec possibilité d'ajouter un site depuis le formulaire.
// TOUT est dans cette seule migration (demande explicite) : table `sites_affectation`, table de
// liaison `demandes_dpae_sites`, et insertion de la liste initiale pour l'entité « accecit ».
//
// - `sites_affectation` porte `entite_id` (modularité, CLAUDE.md : une autre entité aura ses propres
//   sites). Unicité par entité sur le nom ET sur les initiales, SANS tenir compte des majuscules :
//   index uniques sur lower(...) (index d'expression, impossibles via le seul schema builder knex,
//   d'où knex.raw). `actif` : un site retiré ne doit plus être proposé, sans casser les demandes
//   passées qui le référencent (jamais de suppression physique).
// - `demandes_dpae_sites` : clé primaire composée (demande, site), clés étrangères vers les deux
//   tables. Suppression d'une demande -> ses liens partent avec (cascade) ; un site référencé ne
//   peut pas être supprimé (restrict, défaut) — on le désactive.
// - La colonne texte `demandes_dpae.hotel` est CONSERVÉE (demande explicite) : les demandes
//   existantes la gardent, l'affichage retombe dessus quand une demande n'a aucun site lié.
// - Insertion initiale IDEMPOTENTE (ON CONFLICT DO NOTHING, voir requeteInsertionSitesInitiaux) :
//   relancer l'insertion ne crée aucun doublon. Entité recherchée par son code, jamais par un id en
//   dur ; si « accecit » n'existe pas (autre déploiement), rien n'est inséré. Noms et initiales
//   écrits EXACTEMENT comme fournis (casse comprise, ex. « HOTEL DE France », « YUNA montmartre »).

const CODE_ENTITE_SITES_INITIAUX = 'accecit';

// [nom, initiales] — 69 sites, liste fournie par l'utilisateur le 2026-09-29.
const SITES_AFFECTATION_INITIAUX = [
  ['AIGLON', 'AIG'],
  ['ALBE', 'AL'],
  ['ALL SUITE PARIS 13', 'ASP13'],
  ['AVALON', 'AVA'],
  ['B55', 'B55'],
  ['BLACK DOOR', 'BD'],
  ['BOHEM', 'BOH'],
  ['BRIT ROSNY', 'BR'],
  ['BRIT THIAIS', 'BH'],
  ['CADRAN', 'CAD'],
  ['CAYRE', 'CAY'],
  ['CHAMPERRET', 'CH'],
  ['COLISEE HOTEL', 'COL'],
  ['COSY AVALON', 'CAV'],
  ['DELAMBRE', 'BL'],
  ['DIESE HOTEL BASTILLE', 'DIE'],
  ['DRESS CODE', 'DC'],
  ['ECLA NOISY', 'ECN'],
  ['ECLA PALAISEAU', 'ECP'],
  ['ECLA VILLEJUIF', 'ECV'],
  ['EIFFEL PETIT LOUVRE', 'EPL'],
  ['ESPERANCE', 'ESP'],
  ['FABRIC', 'FAB'],
  ['GABRIEL', 'GAB'],
  ['GOBELINS', 'GHG'],
  ['GRAND CŒUR LATIN', 'GCL'],
  ['GRAND HOTEL DES BALCONS', 'GHB'],
  ['HIFE ISSY', 'HILM'],
  ['HIFE PARIS', 'HIP'],
  ['HIFE VELIZY', 'HIV'],
  ['HOLIDAY INN MONTMARTRE', 'HI'],
  ['HOTEL HOR', 'HO'],
  ['HOR LES LUMIERES', 'HLL'],
  ['HOTEL DE France', 'HDF'],
  ['KLEY CLICHY', 'KLC'],
  ['KLEY SAINT OUEN', 'KLSO'],
  ['LA BOURDONNAIS', 'LB'],
  ['LA COMTESSE', 'LC'],
  ['LALA', 'LA'],
  ['LES 2 GIRAFES', 'L2G'],
  ['LES BAINS', 'BA'],
  ['LES HESPERIDES', 'HESP'],
  ['LIB. AUSTERLITZ', 'AUS'],
  ['LIB. CANAL SAINT MARTIN', 'CSM'],
  ["LIB. GARE DE L'EST", 'GDE'],
  ['LIB. GARE DU NORD SUEDE', 'GNS'],
  ['LIB. MONTMARTRE DUPERRE', 'MD'],
  ['MAISON BREGUET', 'MB'],
  ['MASSE', 'MAS'],
  ['MODERNISTE', 'MOD'],
  ['MONGE', 'MG'],
  ['PALYM', 'PAL'],
  ['PASTEL', 'PAS'],
  ['PETIT PARIS', 'PP'],
  ['RANELAGH / Sœur Assomption', 'RAN'],
  ['REGENT', 'REG'],
  ['RESIDENCE LE MONDE', 'RM'],
  ['ROCROY', 'ROC'],
  ['SAINTE BEUVE', 'HSB'],
  ['SIXTEEN', 'SIX'],
  ['SOLLY', 'SOL'],
  ['VICTOR HUGO', 'VIL'],
  ['VILLA PARIS ORLY', 'VPO'],
  ['X. O.', 'XO'],
  ['YUNA BLANCHE/OPERA', 'YBO'],
  ['YUNA HALLES/ST HONORE', 'YHSH'],
  ['YUNA montmartre', 'YMO'],
  ['YUNA Porte Maillot', 'YPM'],
  ['YUNA Saint Germain', 'YSG'],
];

// Requête d'insertion seule (sans exécution) — séparée pour être testable sans base : le test
// vérifie le SQL généré (ON CONFLICT DO NOTHING, 69 lignes), voir sitesAffectationMigration.test.js.
function requeteInsertionSitesInitiaux(knex, entiteId) {
  return knex('sites_affectation')
    .insert(SITES_AFFECTATION_INITIAUX.map(([nom, initiales]) => ({ entite_id: entiteId, nom, initiales })))
    .onConflict()
    .ignore();
}

async function insererSitesInitiaux(knex) {
  const entite = await knex('entites').where({ code: CODE_ENTITE_SITES_INITIAUX }).first('id');
  if (!entite) return;
  await requeteInsertionSitesInitiaux(knex, entite.id);
}

exports.up = async (knex) => {
  if (!(await knex.schema.hasTable('sites_affectation'))) {
    await knex.schema.createTable('sites_affectation', (table) => {
      table.increments('id').primary();
      table.integer('entite_id').notNullable().references('id').inTable('entites');
      table.string('nom').notNullable();
      table.string('initiales', 5).notNullable();
      table.boolean('actif').notNullable().defaultTo(true);
      table.timestamp('date_creation', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('date_maj', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
  }
  await knex.raw(
    'CREATE UNIQUE INDEX IF NOT EXISTS sites_affectation_entite_nom_unique ON sites_affectation (entite_id, lower(nom))',
  );
  await knex.raw(
    'CREATE UNIQUE INDEX IF NOT EXISTS sites_affectation_entite_initiales_unique ON sites_affectation (entite_id, lower(initiales))',
  );

  if (!(await knex.schema.hasTable('demandes_dpae_sites'))) {
    await knex.schema.createTable('demandes_dpae_sites', (table) => {
      table.integer('demande_dpae_id').notNullable().references('id').inTable('demandes_dpae').onDelete('CASCADE');
      table.integer('site_affectation_id').notNullable().references('id').inTable('sites_affectation');
      table.primary(['demande_dpae_id', 'site_affectation_id']);
    });
  }

  await insererSitesInitiaux(knex);
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('demandes_dpae_sites');
  await knex.schema.dropTableIfExists('sites_affectation');
};

// Exposés pour les tests (sitesAffectationMigration.test.js) — knex n'appelle que up/down.
exports.SITES_AFFECTATION_INITIAUX = SITES_AFFECTATION_INITIAUX;
exports.requeteInsertionSitesInitiaux = requeteInsertionSitesInitiaux;
exports.insererSitesInitiaux = insererSitesInitiaux;
