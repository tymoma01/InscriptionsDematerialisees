// Module « Demandes DPAE » (2026-09-28) : demande de staffing hôtel adressée à la RH (nouvelle
// embauche, prolongation, ajout/retrait de jours, passage CDI, changement horaires/affectation) —
// spécifique à ACCECIT pour l'instant (voir CLAUDE.md, Modularité : pas de moteur générique
// configurable par entité ici, décision actée avec l'utilisateur), mais `entite_id` conservé pour
// rester cohérent avec la traçabilité RGPD et le reste du schéma (toutes les tables métier du
// projet le portent, voir `candidats`/`dossiers`).
//
// Pas de statut `brouillon` : une demande créée est immédiatement `envoyee` (voir
// demandeDpaeService.creerEtEnvoyer) — la maquette d'origine désactive déjà l'envoi tant que le
// formulaire n'est pas complet, donc rien à faire d'une demande à moitié remplie côté back.
//
// `jours_concernes`/`semaine_type` en `jsonb` (pas de tables de jointure séparées) : même pattern
// déjà en place dans le projet pour une liste de forme variable rattachée à une seule ligne parente
// (voir `rendezvous.postes_selectionnes`, migration 039 ; `dossier_donnees_formulaire.donnees`,
// migration 013) — ces deux listes ne sont interrogées qu'à travers leur demande, jamais
// requêtées transversalement.
//
// `division` (ACCHOT/RM/autre dans la maquette) plutôt que `entite` : évite toute collision avec
// le concept multi-tenant `entites` du projet, qui n'a rien à voir ici.
//
// `hotel` texte libre (pas une FK vers `lieux`, retiré avant toute application de cette migration
// en dev — décision utilisateur) : `lieux` liste les lieux où un TEST candidat se déroule (voir
// migration 044), une notion distincte de "quel hôtel est concerné par cette demande de staffing"
// — la confusion des deux ici aurait forcé à maintenir `lieux` à jour avec tous les hôtels clients
// plutôt que de simplement laisser l'agent taper le nom.
exports.up = (knex) =>
  knex.schema.createTable('demandes_dpae', (table) => {
    table.increments('id').primary();
    table.integer('entite_id').notNullable().references('id').inTable('entites');
    table.integer('demandeur_id').notNullable().references('id').inTable('utilisateurs');

    table.string('statut').notNullable().defaultTo('envoyee');
    table.string('type_demande').notNullable();

    table.string('salarie_nom').notNullable();
    table.string('salarie_prenom').notNullable();
    table.string('salarie_telephone').nullable();
    table.boolean('salarie_deja_employe').notNullable().defaultTo(false);
    // Rempli uniquement si sélectionné via l'autocomplétion (RechercheCandidatSalarie.jsx) —
    // une saisie libre (nouveau salarié, ou candidat non retrouvé) laisse ce champ nul.
    table.integer('candidat_id').nullable().references('id').inTable('candidats');

    table.string('hotel').nullable();

    table.string('type_contrat').nullable();
    table.string('motif_cdd').nullable();
    table.string('salarie_remplace_nom').nullable();
    table.date('date_fin_absence').nullable();
    table.text('raison_surcroit').nullable();

    table.string('division').nullable();
    // Précision libre quand `division` vaut 'autre' — même patron que `poste_autre` ci-dessous.
    table.string('division_autre').nullable();
    table.string('poste').nullable();
    table.string('poste_autre').nullable();
    table.date('date_debut').nullable();
    table.date('date_fin').nullable();
    table.time('heure_arrivee_j1').nullable();
    table.decimal('heures_par_mois', 5, 2).nullable();

    table.boolean('modifications_demandees').notNullable().defaultTo(false);
    table.boolean('modification_horaires').notNullable().defaultTo(false);
    table.boolean('modification_jours_repos').notNullable().defaultTo(false);
    table.boolean('modification_affectation').notNullable().defaultTo(false);
    table.string('nouvelle_affectation').nullable();

    table.string('type_changement_jours').nullable();
    table.jsonb('jours_concernes').notNullable().defaultTo('[]');
    table.text('raison_changement_jours').nullable();
    table.string('raison_identique_contrat').nullable();

    table.jsonb('semaine_type').notNullable().defaultTo('[]');
    table.boolean('horaires_differents_par_jour').notNullable().defaultTo(false);

    table.text('autre_chose_signaler').nullable();
    table.boolean('verif_besoin_hotel').notNullable().defaultTo(false);
    table.boolean('verif_tous_jours_inclus').notNullable().defaultTo(false);
    table.boolean('verif_non_planification').notNullable().defaultTo(false);

    table.text('motif_rejet').nullable();
    table.integer('traite_par_utilisateur_id').nullable().references('id').inTable('utilisateurs');

    table.timestamp('date_creation', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('date_maj', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('date_traitement', { useTz: true }).nullable();

    // Index séparés (plutôt qu'un composite unique) : la file RH filtre par (entite_id, statut),
    // "mes demandes" filtre par demandeur_id seul — deux accès distincts, voir
    // demandeDpaeRepository.js.
    table.index(['entite_id', 'statut'], 'demandes_dpae_entite_statut_idx');
    table.index(['demandeur_id'], 'demandes_dpae_demandeur_idx');
  });

exports.down = (knex) => knex.schema.dropTableIfExists('demandes_dpae');
