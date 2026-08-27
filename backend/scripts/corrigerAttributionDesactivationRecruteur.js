// Correctif ponctuel — 3 entrées journal_audit mal attribuées, créées par erreur QUELQUES MINUTES
// PLUS TÔT dans la même session que scripts/desactiverComptesRoleRecruteur.js (audit du rôle
// Recruteur, 2026-08-27), jamais une entrée historique préexistante.
//
// Cause : la requête de résolution du compte système (jointure utilisateurs/roles) n'utilisait
// pas de `.select()` explicite — les deux tables ont chacune une colonne `id`, et `roles.id`
// (sélectionné en dernier par la jointure) écrasait silencieusement `utilisateurs.id` dans l'objet
// résultat. Conséquence : `utilisateurSysteme.id` valait systématiquement 5 (l'id du RÔLE
// 'systeme', pas celui d'un compte), ce qui correspondait par coïncidence au vrai compte système
// Adaptel (entite_id=2) mais PAS au compte système ACCECIT (entite_id=1, id réel 2) — 3 des 4
// entrées créées (comptes #4, #23, #75, tous ACCECIT) ont donc été attribuées à tort au compte
// système d'Adaptel. La 4e (compte #7, Adaptel) était juste par coïncidence.
//
// Corrige UNIQUEMENT ces 3 entrées précises (utilisateur_id 5 -> 2), jamais les 216 entrées
// historiques préexistantes qui référencent les 8 comptes Recruteur eux-mêmes comme AUTEUR
// (utilisateur_id IN (4,7,10,23,40,46,48,75)) — ces entrées-là restent hors du périmètre de ce
// script (aucune clause WHERE ci-dessous ne peut les atteindre, elles n'ont pas
// action='utilisateur_desactivation').
//
// Idempotent : si les entrées ont déjà été corrigées, ne fait rien.
//
// Usage : node scripts/corrigerAttributionDesactivationRecruteur.js

const { obtenirKnex } = require('../src/db/knex');

const ENTREES_A_CORRIGER = [
  { id: 2459, cibleId: 4 },
  { id: 2461, cibleId: 23 },
  { id: 2462, cibleId: 75 },
];
const UTILISATEUR_ID_ERRONE = 5;
const UTILISATEUR_ID_CORRECT = 2; // compte système ACCECIT (systeme@accecit.interne)

async function main() {
  const bd = await obtenirKnex();
  try {
    const systemeAccecit = await bd('utilisateurs').where({ id: UTILISATEUR_ID_CORRECT }).first();
    if (!systemeAccecit || systemeAccecit.email !== 'systeme@accecit.interne') {
      throw new Error(`Le compte #${UTILISATEUR_ID_CORRECT} n'est pas systeme@accecit.interne — arrêt sans rien modifier.`);
    }

    for (const { id, cibleId } of ENTREES_A_CORRIGER) {
      // eslint-disable-next-line no-await-in-loop -- 3 entrées seulement, séquentiel suffisant.
      const entree = await bd('journal_audit').where({ id }).first();
      if (!entree) {
        console.log(`Entrée #${id} introuvable — ignorée.`);
        // eslint-disable-next-line no-continue
        continue;
      }
      if (entree.action !== 'utilisateur_desactivation' || entree.cible_id !== cibleId || entree.entite_id !== 1) {
        throw new Error(
          `Entrée #${id} ne correspond pas au cas attendu (action="${entree.action}", cible_id=${entree.cible_id}, entite_id=${entree.entite_id}) — arrêt sans rien modifier, ce script ne corrige que ce cas précis.`,
        );
      }
      if (entree.utilisateur_id === UTILISATEUR_ID_CORRECT) {
        console.log(`Entrée #${id} déjà corrigée — rien à faire.`);
        // eslint-disable-next-line no-continue
        continue;
      }
      if (entree.utilisateur_id !== UTILISATEUR_ID_ERRONE) {
        throw new Error(`Entrée #${id} a un utilisateur_id inattendu (${entree.utilisateur_id}) — arrêt sans rien modifier.`);
      }

      const donnees = typeof entree.donnees === 'string' ? JSON.parse(entree.donnees) : entree.donnees;
      donnees.correctifAttribution =
        `utilisateur_id corrigé le ${new Date().toISOString().slice(0, 10)} (${UTILISATEUR_ID_ERRONE} -> ${UTILISATEUR_ID_CORRECT}) — ` +
        "bug de jointure SQL (roles.id écrasait utilisateurs.id dans scripts/desactiverComptesRoleRecruteur.js) : le compte système Adaptel avait été attribué par erreur à une action ACCECIT.";

      // eslint-disable-next-line no-await-in-loop
      await bd('journal_audit').where({ id }).update({
        utilisateur_id: UTILISATEUR_ID_CORRECT,
        donnees: JSON.stringify(donnees),
      });
      console.log(`Entrée #${id} (cible_id=${cibleId}) corrigée : utilisateur_id ${UTILISATEUR_ID_ERRONE} -> ${UTILISATEUR_ID_CORRECT} ✔`);
    }
  } finally {
    await bd.destroy();
  }
}

main().catch((erreur) => {
  console.error('Échec ✘');
  console.error(erreur.message);
  process.exitCode = 1;
});
