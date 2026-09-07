// Correctif ponctuel — marque le compte formateur "Tiana RANORO" comme formateur par défaut du
// secteur Hôtel (audit planification des tests, 2026-09-07, décision utilisateur). Passe par
// utilisateurRepository.definirUtilisateurParDefaut (même chemin applicatif/transactionnel que
// lieuRepository.definirLieuParDefaut) plutôt qu'un UPDATE direct — garantit la même bascule et le
// même index unique partiel (migration 059) que la voie normale.
//
// Recherche par EMAIL, jamais par id (décision utilisateur) : l'id de ce compte diffère entre dev
// et prod (seed distinct), l'email est la seule clé stable des deux côtés — voir aussi
// utilisateurRepository.trouverUtilisateurParEmailGlobal, déjà globale pour la même raison
// (unicité de l'email, migration 003). Nom/prénom et rôle revérifiés en plus de l'email avant toute
// écriture : ce script échoue plutôt que de deviner si l'un des trois ne correspond plus (compte
// renommé, changé de rôle entre-temps, etc.).
//
// Idempotent : relancer ce script sur un compte déjà par_defaut=true ne fait que réappliquer la
// même valeur (definirUtilisateurParDefaut n'échoue pas sur un no-op, voir son commentaire).
//
// Usage : node scripts/definirFormateurParDefautAccecit.js

const { obtenirKnex } = require('../src/db/knex');
const utilisateurRepository = require('../src/core/auth/utilisateurRepository');

const CODE_ENTITE = 'accecit';
const EMAIL_FORMATEUR = 'formation@accecit.com';
const NOM_ATTENDU = 'RANORO';
const PRENOM_ATTENDU = 'Tiana';
const ROLE_ATTENDU = 'formateur';

async function main() {
  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: CODE_ENTITE }).first();
    if (!entite) {
      throw new Error(`Entité « ${CODE_ENTITE} » introuvable.`);
    }

    const utilisateur = await utilisateurRepository.trouverUtilisateurParEmailGlobal(bd, EMAIL_FORMATEUR);
    if (!utilisateur) {
      throw new Error(`Aucun utilisateur trouvé pour l'email « ${EMAIL_FORMATEUR} » — arrêt sans rien modifier.`);
    }
    if (utilisateur.entite_id !== entite.id) {
      throw new Error(
        `Utilisateur « ${EMAIL_FORMATEUR} » trouvé mais rattaché à une autre entité (entite_id=${utilisateur.entite_id}, ` +
          `attendu ${entite.id}) — arrêt sans rien modifier.`,
      );
    }
    if (utilisateur.nom !== NOM_ATTENDU || utilisateur.prenom !== PRENOM_ATTENDU) {
      throw new Error(
        `Utilisateur « ${EMAIL_FORMATEUR} » trouvé mais nom/prénom différents de ceux attendus ` +
          `(actuel : "${utilisateur.prenom} ${utilisateur.nom}", attendu : "${PRENOM_ATTENDU} ${NOM_ATTENDU}") — ` +
          'arrêt sans rien modifier.',
      );
    }
    if (!utilisateur.actif) {
      throw new Error(`Utilisateur « ${EMAIL_FORMATEUR} » trouvé mais désactivé — arrêt sans rien modifier.`);
    }

    const role = await utilisateurRepository.trouverRoleParCode(bd, ROLE_ATTENDU);
    if (!role) {
      throw new Error(`Rôle « ${ROLE_ATTENDU} » introuvable.`);
    }
    if (utilisateur.role_id !== role.id) {
      throw new Error(
        `Utilisateur « ${EMAIL_FORMATEUR} » trouvé mais son rôle actuel (role_id=${utilisateur.role_id}) n'est pas ` +
          `« ${ROLE_ATTENDU} » (role_id=${role.id}) — arrêt sans rien modifier.`,
      );
    }

    await bd.transaction((trx) => utilisateurRepository.definirUtilisateurParDefaut(trx, entite.id, utilisateur.id, role.id));
    console.log(
      `Utilisateur #${utilisateur.id} (« ${PRENOM_ATTENDU} ${NOM_ATTENDU} », ${EMAIL_FORMATEUR}) défini comme formateur ` +
        'par défaut (secteur Hôtel) ✔',
    );
  } finally {
    await bd.destroy();
  }
}

main().catch((erreur) => {
  console.error('Échec du correctif ✘');
  console.error(erreur.message);
  process.exitCode = 1;
});
