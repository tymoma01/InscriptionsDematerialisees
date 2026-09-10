// Correctif ponctuel — associe un lieu par défaut PROPRE à deux formateurs ACCECIT du secteur
// hôtel (décision utilisateur, 2026-09-10 : "Tiana -> hotel du cadran, Anni -> hotel B55"), et
// bascule le calendrier Outlook d'Anni vers sa propre boîte plutôt que le calendrier départemental
// partagé (utilisateurs.calendrier_personnel, migration 063 — voir graphCalendarService.
// resoudreCalendrierPourUtilisateur). Passe par les fonctions du repository
// (definirLieuParDefautUtilisateur/definirCalendrierPersonnel) plutôt qu'un UPDATE direct, même
// principe que definirFormateurParDefautAccecit.js/definirLieuxParDefautAccecit.js.
//
// "Inspecteurs -> bureau Accecit" (troisième association demandée) délibérément SANS action ici :
// contrairement à Tiana/Anni (deux formateurs du MÊME secteur hôtel, qui ont donc besoin chacun
// d'un lieu par défaut propre — le secteur "hotel" n'en admet qu'un seul via lieux.par_defaut),
// TOUS les inspecteurs sont déjà exclusivement assignés à des dossiers secteur bureau
// (roleImposeParSecteur, planificationParDefaut.js) — le lieu par défaut du secteur bureau (déjà
// "Bureau ACCECIT", voir definirLieuxParDefautAccecit.js) couvre donc déjà tous les inspecteurs,
// présents ET futurs, sans qu'aucune association individuelle ne soit nécessaire ni souhaitable
// (une association individuelle figée devrait sinon être répétée pour chaque nouvel inspecteur).
// Ce script se contente de VÉRIFIER cette hypothèse (voir la section dédiée plus bas) plutôt que
// d'écrire quoi que ce soit pour ce cas.
//
// Recherche par EMAIL pour les utilisateurs (jamais par id, décision déjà actée dans
// definirFormateurParDefautAccecit.js — id différent entre dev/prod, email seule clé stable) et
// par un extrait d'ADRESSE pour les lieux (id également différent entre dev/prod) : ce script
// échoue plutôt que de deviner si l'un des critères ne correspond plus.
//
// Idempotent : relancer ce script sur un état déjà correct ne fait que réappliquer les mêmes
// valeurs.
//
// Usage : node scripts/definirLieuxCalendrierFormateursAccecit.js

const { obtenirKnex } = require('../src/db/knex');
const utilisateurRepository = require('../src/core/auth/utilisateurRepository');

const CODE_ENTITE = 'accecit';

const ASSOCIATIONS = [
  {
    emailFormateur: 'formation@accecit.com',
    nomAttendu: 'RANORO',
    prenomAttendu: 'Tiana',
    extraitAdresseLieu: 'Cadran',
    calendrierPersonnel: false,
  },
  {
    emailFormateur: 'adeville@accecit.com',
    nomAttendu: 'Neacsu',
    prenomAttendu: 'Anni',
    extraitAdresseLieu: 'B55',
    calendrierPersonnel: true,
  },
];

async function main() {
  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: CODE_ENTITE }).first();
    if (!entite) {
      throw new Error(`Entité « ${CODE_ENTITE} » introuvable.`);
    }

    for (const { emailFormateur, nomAttendu, prenomAttendu, extraitAdresseLieu, calendrierPersonnel } of ASSOCIATIONS) {
      // eslint-disable-next-line no-await-in-loop -- deux formateurs seulement, séquentiel suffisant.
      const utilisateur = await utilisateurRepository.trouverUtilisateurParEmailGlobal(bd, emailFormateur);
      if (!utilisateur) {
        throw new Error(`Aucun utilisateur trouvé pour l'email « ${emailFormateur} » — arrêt sans rien modifier.`);
      }
      if (utilisateur.entite_id !== entite.id) {
        throw new Error(
          `Utilisateur « ${emailFormateur} » trouvé mais rattaché à une autre entité (entite_id=${utilisateur.entite_id}, ` +
            `attendu ${entite.id}) — arrêt sans rien modifier.`,
        );
      }
      if (utilisateur.nom !== nomAttendu || utilisateur.prenom !== prenomAttendu) {
        throw new Error(
          `Utilisateur « ${emailFormateur} » trouvé mais nom/prénom différents de ceux attendus ` +
            `(actuel : "${utilisateur.prenom} ${utilisateur.nom}", attendu : "${prenomAttendu} ${nomAttendu}") — ` +
            'arrêt sans rien modifier.',
        );
      }

      // eslint-disable-next-line no-await-in-loop
      const lieux = await bd('lieux').where({ entite_id: entite.id, secteur: 'hotel' }).whereRaw('adresse ILIKE ?', [`%${extraitAdresseLieu}%`]);
      if (lieux.length !== 1) {
        throw new Error(
          `Attendu exactement un lieu secteur hôtel dont l'adresse contient « ${extraitAdresseLieu} », ` +
            `${lieux.length} trouvé(s) — arrêt sans rien modifier.`,
        );
      }
      const [lieu] = lieux;

      // eslint-disable-next-line no-await-in-loop
      await bd.transaction((trx) => utilisateurRepository.definirLieuParDefautUtilisateur(trx, entite.id, utilisateur.id, lieu.id));
      console.log(
        `Utilisateur #${utilisateur.id} (« ${prenomAttendu} ${nomAttendu} », ${emailFormateur}) : lieu par défaut -> ` +
          `« ${lieu.adresse} » (#${lieu.id}) ✔`,
      );

      // eslint-disable-next-line no-await-in-loop
      await bd.transaction((trx) => utilisateurRepository.definirCalendrierPersonnel(trx, entite.id, utilisateur.id, calendrierPersonnel));
      console.log(
        `Utilisateur #${utilisateur.id} (« ${prenomAttendu} ${nomAttendu} ») : calendrier_personnel -> ${calendrierPersonnel} ✔`,
      );
    }

    // Vérification (pas une écriture, voir commentaire d'en-tête) : le lieu par défaut du secteur
    // bureau doit déjà exister et être "Bureau ACCECIT" — c'est lui qui couvre "Inspecteurs ->
    // bureau Accecit" pour tous les inspecteurs, sans association individuelle.
    const lieuBureauParDefaut = await bd('lieux').where({ entite_id: entite.id, secteur: 'bureau', par_defaut: true }).first();
    if (!lieuBureauParDefaut) {
      console.warn(
        "⚠ Aucun lieu par défaut pour le secteur bureau — 'Inspecteurs -> bureau Accecit' ne sera donc PAS appliqué " +
          '(voir scripts/definirLieuxParDefautAccecit.js pour le configurer).',
      );
    } else {
      console.log(`Vérifié : lieu par défaut secteur bureau = « ${lieuBureauParDefaut.adresse} » (#${lieuBureauParDefaut.id}) — couvre déjà tous les inspecteurs ✔`);
    }
  } finally {
    await bd.destroy();
  }
}

main().catch((erreur) => {
  console.error('Échec du correctif ✘');
  console.error(erreur.message);
  process.exitCode = 1;
});
