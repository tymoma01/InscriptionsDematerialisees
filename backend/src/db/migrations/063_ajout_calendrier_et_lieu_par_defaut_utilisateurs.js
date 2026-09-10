// Deux ajouts indépendants sur `utilisateurs`, demande utilisateur 2026-09-10 :
//
// 1. `calendrier_personnel` (booléen, false par défaut) — bascule le routage Outlook de CE
//    formateur/inspecteur précis vers SA PROPRE boîte Microsoft 365 (`utilisateurs.email`) plutôt
//    que le calendrier départemental partagé habituel (voir graphCalendarService.js,
//    CALENDRIER_PAR_ROLE — décision du 2026-08-26 : "jamais la boîte personnelle de chaque
//    formateur/inspecteur", toujours vraie par défaut ici, cette colonne n'introduit qu'une
//    exception explicite compte par compte). Jamais activé automatiquement : à cocher au cas par
//    cas à mesure qu'une boîte personnelle est effectivement provisionnée côté Microsoft 365 avec
//    la permission Calendars.ReadWrite (sans quoi la création d'événement échouerait).
//
// 2. `lieu_par_defaut_id` (FK nullable vers `lieux`) — lieu présélectionné dans
//    ModalePlanificationTest.jsx/ModaleReplanificationGroupee.jsx quand CE formateur/inspecteur
//    précis est choisi, prioritaire sur le lieu par défaut du secteur (lieux.par_defaut, migration
//    054) qui reste le repli si l'utilisateur n'a aucun lieu propre configuré. Sans quoi deux
//    formateurs hôtel (ex. Tiana/Anni) ne pourraient jamais avoir des lieux par défaut différents,
//    le secteur "hotel" n'admettant qu'un seul lieu par défaut à la fois. Pas de bascule
//    transactionnelle façon lieuRepository.definirLieuParDefaut/utilisateurRepository.
//    definirUtilisateurParDefaut : contrairement à ces deux-là, plusieurs utilisateurs peuvent
//    parfaitement partager le même lieu par défaut (aucune contrainte d'unicité à faire respecter
//    ici), un simple UPDATE suffit.
exports.up = (knex) =>
  knex.schema.alterTable('utilisateurs', (table) => {
    table.boolean('calendrier_personnel').notNullable().defaultTo(false);
    table.integer('lieu_par_defaut_id').nullable().references('id').inTable('lieux');
  });

exports.down = (knex) =>
  knex.schema.alterTable('utilisateurs', (table) => {
    table.dropColumn('calendrier_personnel');
    table.dropColumn('lieu_par_defaut_id');
  });
