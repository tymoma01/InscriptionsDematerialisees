// Les notes de refus définitif et de levée sont générées par l'application (blacklistService) au même
// instant, pour le même dossier et le même auteur que la ligne d'historique_statuts correspondante
// (même transaction, donc même now()). C'est ce couple, et non une recherche de texte sur toutes les
// notes, qui désigne une note générée : une note saisie à la main n'a pas de ligne d'historique jumelle.
//
// Anciens formats réécrits (note ET commentaire d'historique, jamais le journal d'audit) :
//   « Blacklisté — <motif> : <commentaire> »   ou « Refus définitif — <motif> : <commentaire> »
//     -> « Refus définitif (<motif>) : <commentaire> »
//   « Retrait de la blacklist : <c> »           ou « Levée du refus définitif : <c> »
//     -> « Refus définitif levé : <c> »
const CODE_STATUT = 'blackliste';
const CATEGORIE_MOTIF = 'blacklister';
const PREFIXES_REFUS = ['Blacklisté', 'Refus définitif'];
const PREFIXES_LEVEE = ['Retrait de la blacklist', 'Levée du refus définitif'];

// Fonctions pures (testées hors de ce dossier) : renvoient les nouveaux textes, ou null si la ligne
// n'a pas le format généré par l'application.
function reecrireRefus({ contenu, commentaire, libelle }) {
  const prefixe = PREFIXES_REFUS.map((p) => `${p} — ${libelle} : `).find((p) => contenu.startsWith(p));
  if (!prefixe) return null;
  const nouveau = `Refus définitif (${libelle}) : ${contenu.slice(prefixe.length)}`;
  const ancienHistorique = `${libelle} — ${contenu.slice(prefixe.length)}`;
  return { note: nouveau, historique: commentaire === ancienHistorique ? nouveau : null };
}

function reecrireLevee({ contenu, commentaire }) {
  const prefixeNote = PREFIXES_LEVEE.map((p) => `${p} : `).find((p) => contenu.startsWith(p));
  const historiqueAncien = PREFIXES_LEVEE.some((p) => (commentaire ?? '').startsWith(`${p} — `));
  if (!prefixeNote || !historiqueAncien) return null;
  const nouveau = `Refus définitif levé : ${contenu.slice(prefixeNote.length)}`;
  return { note: nouveau, historique: nouveau };
}

exports.reecrireRefus = reecrireRefus;
exports.reecrireLevee = reecrireLevee;

const jumelage = function jumelage() {
  this.on('h.dossier_id', 'n.dossier_id').andOn('h.utilisateur_id', 'n.auteur_id').andOn('h.date_changement', 'n.date_creation');
};

async function appliquer(knex, ligne, resultat) {
  await knex('notes_dossier').where({ id: ligne.note_id }).update({ contenu: resultat.note });
  if (resultat.historique) {
    await knex('historique_statuts').where({ id: ligne.historique_id }).update({ commentaire: resultat.historique });
  }
}

exports.up = async (knex) => {
  let modifiees = 0;

  // Refus : note jumelée à une ligne d'historique vers le statut de refus portant un motif de la catégorie.
  const refus = await knex('notes_dossier as n')
    .join('historique_statuts as h', jumelage)
    .join('statuts as s', 's.id', 'h.statut_id')
    .join('motifs as m', 'm.id', 'h.motif_id')
    .where('s.code', CODE_STATUT)
    .where('m.categorie', CATEGORIE_MOTIF)
    .select('n.id as note_id', 'n.contenu', 'h.id as historique_id', 'h.commentaire', 'm.libelle');
  for (const ligne of refus) {
    const resultat = reecrireRefus(ligne);
    if (resultat) {
      await appliquer(knex, ligne, resultat);
      modifiees += 1;
    }
  }

  // Levée : note jumelée à une ligne d'historique dont le commentaire porte l'ancien préfixe de levée.
  const levees = await knex('notes_dossier as n')
    .join('historique_statuts as h', jumelage)
    .select('n.id as note_id', 'n.contenu', 'h.id as historique_id', 'h.commentaire');
  for (const ligne of levees) {
    const resultat = reecrireLevee(ligne);
    if (resultat) {
      await appliquer(knex, ligne, resultat);
      modifiees += 1;
    }
  }

  console.log(`Migration 099 : ${modifiees} note(s) de refus définitif ou de levée réécrite(s).`);
};

// Les anciens textes ne sont pas restitués : le contenu saisi par l'utilisateur est conservé tel quel.
exports.down = async () => {};
