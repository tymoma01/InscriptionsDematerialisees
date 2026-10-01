// Boîte Outlook dans laquelle l'événement d'un rendez-vous a été CRÉÉ (correctif 2026-10-01).
//
// Incident de production : pour un formateur dont `utilisateurs.calendrier_personnel` est actif
// (Anni Neacsu, adeville@accecit.com — migration 063), l'événement est créé dans SA boîte, mais la
// synchronisation Outlook (syncCalendrierManuelService.js) le relisait dans la boîte du RÔLE
// (formation@accecit.com) : 404 ErrorItemNotFound, donc rendez-vous annulé à tort (10 rendez-vous
// en 30 jours), avec courriel d'annulation au candidat et au formateur.
//
// Désormais, la boîte est enregistrée sur le rendez-vous à la création (rendezvousService.
// creerRendezvous) et TOUTE lecture/suppression ultérieure de l'événement l'utilise — jamais
// l'option actuelle du formateur, qui peut changer après la création.
//
// Remplissage des rendez-vous existants (événement Outlook ET formateur assignés uniquement) :
// - formateur avec calendrier_personnel ET rendez-vous créé à partir du 2026-09-10 (date
//   d'introduction de l'option, migration 063 ; compte d'Anni créé ce même jour) -> sa boîte
//   (utilisateurs.email) ;
// - sinon -> boîte du rôle, telle que le code la résolvait à l'époque.
// La date de création vient de journal_audit (rendezvous_cree / rendezvous_cree_avec_transitions),
// `rendezvous` n'ayant pas de colonne de date de création ; sans trace, l'option du formateur fait foi.
//
// Boîtes par rôle FIGÉES ici (copie de graphCalendarService.CALENDRIER_PAR_ROLE au 2026-10-01) :
// une migration ne doit pas changer de résultat si cette constante évolue plus tard.
const CALENDRIER_PAR_ROLE = {
  formateur: 'formation@accecit.com',
  inspecteur: 'test-tertiaire@accecit.com',
};
const DATE_INTRODUCTION_CALENDRIER_PERSONNEL = '2026-09-10';

exports.up = async (knex) => {
  await knex.schema.alterTable('rendezvous', (table) => {
    table.string('outlook_calendrier').nullable();
  });

  const rendezvous = await knex('rendezvous as rv')
    .join('utilisateurs as u', 'u.id', 'rv.formateur_id')
    .join('roles as r', 'r.id', 'u.role_id')
    .whereNotNull('rv.outlook_event_id')
    .select(
      'rv.id',
      'u.email',
      'u.calendrier_personnel',
      'r.code as role_code',
      knex.raw(
        `(select min(j.date_action) from journal_audit j
          where j.table_cible = 'rendezvous' and j.cible_id = rv.id
            and j.action in ('rendezvous_cree', 'rendezvous_cree_avec_transitions')) as date_creation`,
      ),
    );

  for (const ligne of rendezvous) {
    const creeApresIntroduction =
      !ligne.date_creation || new Date(ligne.date_creation) >= new Date(`${DATE_INTRODUCTION_CALENDRIER_PERSONNEL}T00:00:00+02:00`);
    const boite =
      ligne.calendrier_personnel && ligne.email && creeApresIntroduction ? ligne.email : CALENDRIER_PAR_ROLE[ligne.role_code] ?? null;
    if (boite) {
      // eslint-disable-next-line no-await-in-loop -- quelques centaines de lignes au plus, une seule fois.
      await knex('rendezvous').where({ id: ligne.id }).update({ outlook_calendrier: boite });
    }
  }
};

exports.down = (knex) =>
  knex.schema.alterTable('rendezvous', (table) => {
    table.dropColumn('outlook_calendrier');
  });
