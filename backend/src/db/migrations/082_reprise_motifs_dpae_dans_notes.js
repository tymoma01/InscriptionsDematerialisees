// Les motifs de rejet, de mise en attente et de renvoi ne sont plus saisis : la raison d'une décision
// se consigne dans les notes de la demande. Cette migration reprend l'existant : pour chaque demande
// portant un motif non vide, une note « Motif de … : <texte> » est créée dans `notes_demande_dpae`,
// avec l'auteur et la date de la décision (dernière entrée du journal d'audit de l'action, à défaut
// l'auteur enregistré sur la demande et sa date de dernière modification). Les colonnes de motif
// restent en base, sans plus être lues ni écrites.
//
// Idempotente : une note reprise est repérée par `reprise_motif` ; une demande dont la note est déjà
// là n'en reçoit pas de seconde. `down` ne supprime que les notes reprises par cette migration.

const MOTIFS = [
  { colonne: 'motif_rejet', prefixe: 'Motif de rejet', action: 'demande_dpae_rejet', auteurRepli: 'traite_par_utilisateur_id' },
  { colonne: 'motif_mise_en_attente', prefixe: 'Motif de mise en attente', action: 'demande_dpae_mise_en_attente', auteurRepli: 'mis_en_attente_par_id' },
  // Aucune colonne d'auteur pour le renvoi : à défaut d'entrée d'audit, l'auteur de la demande.
  { colonne: 'motif_renvoi', prefixe: 'Motif de renvoi', action: 'demande_dpae_renvoi_inspecteur', auteurRepli: 'demandeur_id' },
];

// Notes à créer, pour des demandes déjà jointes à leur dernière décision d'audit — fonction pure.
// `demandes` : lignes { id, demandeur_id, date_maj, <colonnes de motif>, <auteurs de repli>, audit_<colonne>_auteur, audit_<colonne>_date }.
// `dejaReprises` : Set de « demandeId|prefixe » déjà présents.
function construireNotes(demandes, dejaReprises) {
  const notes = [];
  for (const demande of demandes) {
    for (const { colonne, prefixe, auteurRepli } of MOTIFS) {
      const motif = demande[colonne]?.trim();
      if (!motif || dejaReprises.has(`${demande.id}|${prefixe}`)) continue;
      const auteurId = demande[`audit_${colonne}_auteur`] ?? demande[auteurRepli] ?? demande.demandeur_id;
      const date = demande[`audit_${colonne}_date`] ?? demande.date_maj;
      notes.push({ demande_dpae_id: demande.id, auteur_id: auteurId, contenu: `${prefixe} : ${motif}`, date_creation: date, reprise_motif: true });
    }
  }
  return notes;
}

exports.construireNotes = construireNotes;

exports.up = async (knex) => {
  if (!(await knex.schema.hasColumn('notes_demande_dpae', 'reprise_motif'))) {
    await knex.schema.alterTable('notes_demande_dpae', (table) => {
      table.boolean('reprise_motif').notNullable().defaultTo(false);
    });
  }

  const audit = (action, champ) =>
    `(SELECT a.${champ} FROM journal_audit a WHERE a.table_cible = 'demandes_dpae' AND a.cible_id = d.id AND a.action = '${action}' ORDER BY a.date_action DESC, a.id DESC LIMIT 1)`;
  const colonnesAudit = MOTIFS.map(
    ({ colonne, action }) => `${audit(action, 'utilisateur_id')} AS audit_${colonne}_auteur, ${audit(action, 'date_action')} AS audit_${colonne}_date`,
  ).join(', ');
  const { rows: demandes } = await knex.raw(
    `SELECT d.id, d.demandeur_id, d.date_maj, d.traite_par_utilisateur_id, d.mis_en_attente_par_id,
            d.motif_rejet, d.motif_mise_en_attente, d.motif_renvoi, ${colonnesAudit}
     FROM demandes_dpae d
     WHERE coalesce(btrim(d.motif_rejet), '') <> '' OR coalesce(btrim(d.motif_mise_en_attente), '') <> '' OR coalesce(btrim(d.motif_renvoi), '') <> ''`,
  );

  const existantes = await knex('notes_demande_dpae').where({ reprise_motif: true }).select('demande_dpae_id', 'contenu');
  const dejaReprises = new Set();
  for (const { demande_dpae_id: id, contenu } of existantes) {
    for (const { prefixe } of MOTIFS) if (contenu.startsWith(`${prefixe} : `)) dejaReprises.add(`${id}|${prefixe}`);
  }

  const notes = construireNotes(demandes, dejaReprises);
  if (notes.length > 0) await knex('notes_demande_dpae').insert(notes);
  console.log(`Migration 082 : ${notes.length} note(s) créée(s) à partir des motifs existants.`);
};

exports.down = async (knex) => {
  if (!(await knex.schema.hasColumn('notes_demande_dpae', 'reprise_motif'))) return;
  await knex('notes_demande_dpae').where({ reprise_motif: true }).del();
  await knex.schema.alterTable('notes_demande_dpae', (table) => {
    table.dropColumn('reprise_motif');
  });
};
