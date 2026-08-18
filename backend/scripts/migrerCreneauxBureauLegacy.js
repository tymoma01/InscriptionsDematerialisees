// Migration ponctuelle — 18 dossiers "typePoste: bureau" dont les créneaux sont encore au
// vocabulaire Hôtel (matin/midi/soir), créés avant l'ajout des créneaux Bureau (6h-9h/9h-18h/
// 18h-21h, voir commit "Ajoute les créneaux bureau (6h-9h/9h-18h/18h-21h) et leur contrainte") —
// sans migration de rattrapage à l'époque. Diagnostic complet : audit du 2026-08-19 (échec 400 du
// bouton "Modifier" sur le dossier #39, InformationsInscription.jsx).
//
// Mapping approximatif appliqué (décision utilisateur, 2026-08-19) :
//   - "matin" ou "midi" présent -> ajoute "9h-18h"
//   - "soir" présent -> ajoute "6h-9h" ET "18h-21h"
// Un dossier peut cumuler plusieurs correspondances (ex. matin+soir -> 9h-18h + 6h-9h + 18h-21h).
//
// Après mapping, seuls les dossiers dont le résultat respecte la règle de validation actuelle
// (dossierService.js, modificationInscriptionSchema : au moins "6h-9h" ou "18h-21h", "9h-18h"
// jamais seul) sont migrés. Les dossiers qui n'avaient que "matin"/"midi" (donc mappés uniquement
// vers "9h-18h" seul) NE SONT PAS migrés automatiquement : ajouter arbitrairement "6h-9h" ou
// "18h-21h" ne refléterait pas les disponibilités réellement déclarées par le candidat — ils
// restent au vocabulaire Hôtel, à corriger manuellement par un agent via le formulaire d'édition
// (qui, une fois corrigé une première fois, repassera par la validation normale).
//
// Écriture via dossierRepository.mettreAJourDonneesBloc (upsert par dossier_id+bloc_code, migration
// 013) — même fonction que celle utilisée par dossierService.modifierInscription (bouton
// "Modifier") — plutôt qu'un UPDATE SQL brut sur le JSONB : reste cohérent avec le chemin
// applicatif normal d'écriture de ce bloc. Seul le champ `creneaux` change ; tous les autres champs
// du bloc "disponibilites" (typePoste, postes, jours, langues...) sont repris tels quels.
//
// Revérifie juste avant migration (dans la transaction) que les créneaux actuels correspondent
// encore exactement à ceux observés lors de l'audit, pour ne rien migrer si un agent a déjà
// corrigé un dossier entre-temps.
//
// Une seule transaction DB. Usage : node scripts/migrerCreneauxBureauLegacy.js

const { obtenirKnex } = require('../src/db/knex');
const dossierRepository = require('../src/core/dossier/dossierRepository');

const CRENEAUX_ATTENDUS_PAR_DOSSIER = {
  29: ['matin', 'soir'],
  33: ['matin', 'midi', 'soir'],
  35: ['matin', 'midi', 'soir'],
  36: ['matin', 'midi', 'soir'],
  38: ['matin', 'midi', 'soir'],
  39: ['matin', 'midi', 'soir'],
  41: ['matin', 'midi', 'soir'],
  46: ['matin'],
  49: ['matin', 'midi'],
  50: ['matin', 'midi'],
  51: ['midi'],
  55: ['matin', 'midi'],
  58: ['matin', 'midi', 'soir'],
  69: ['matin', 'midi'],
  74: ['matin', 'midi'],
  75: ['matin', 'midi'],
  89: ['matin', 'midi', 'soir'],
  91: ['matin'],
};

function meEnsemblesEgaux(a, b) {
  if (a.length !== b.length) return false;
  const ensembleA = new Set(a);
  return b.every((valeur) => ensembleA.has(valeur));
}

function mapperCreneauxBureau(creneauxHotel) {
  const resultat = new Set();
  if (creneauxHotel.includes('matin') || creneauxHotel.includes('midi')) resultat.add('9h-18h');
  if (creneauxHotel.includes('soir')) {
    resultat.add('6h-9h');
    resultat.add('18h-21h');
  }
  return [...resultat];
}

function estValidePourBureau(creneauxBureau) {
  return creneauxBureau.includes('6h-9h') || creneauxBureau.includes('18h-21h');
}

async function main() {
  const bd = await obtenirKnex();
  const migres = [];
  const nonMigres = [];
  try {
    await bd.transaction(async (trx) => {
      for (const [dossierIdStr, creneauxAttendus] of Object.entries(CRENEAUX_ATTENDUS_PAR_DOSSIER)) {
        const dossierId = Number(dossierIdStr);
        const bloc = await trx('dossier_donnees_formulaire')
          .where({ dossier_id: dossierId, bloc_code: 'disponibilites' })
          .first();
        if (!bloc) {
          throw new Error(`Dossier #${dossierId} : bloc "disponibilites" introuvable — arrêt sans rien migrer.`);
        }
        const donnees = bloc.donnees;
        if (donnees.typePoste !== 'bureau' || !meEnsemblesEgaux(donnees.creneaux ?? [], creneauxAttendus)) {
          throw new Error(
            `Dossier #${dossierId} : données différentes de l'audit (typePoste=${donnees.typePoste}, ` +
              `creneaux=${JSON.stringify(donnees.creneaux)}, attendu creneaux=${JSON.stringify(creneauxAttendus)}) — ` +
              'arrêt sans rien migrer, un agent a peut-être déjà corrigé ce dossier.',
          );
        }

        const creneauxMappes = mapperCreneauxBureau(donnees.creneaux);
        if (!estValidePourBureau(creneauxMappes)) {
          nonMigres.push({ dossierId, creneauxAvant: donnees.creneaux, creneauxMappesInvalides: creneauxMappes });
          continue;
        }

        await dossierRepository.mettreAJourDonneesBloc(trx, {
          dossierId,
          blocCode: 'disponibilites',
          donnees: { ...donnees, creneaux: creneauxMappes },
        });
        migres.push({ dossierId, creneauxAvant: donnees.creneaux, creneauxApres: creneauxMappes });
      }
    });
  } finally {
    await bd.destroy();
  }

  console.log(`--- Migrés (${migres.length}) ---`);
  for (const m of migres) {
    console.log(`  Dossier #${m.dossierId} : ${JSON.stringify(m.creneauxAvant)} -> ${JSON.stringify(m.creneauxApres)}`);
  }
  console.log(`\n--- Non migrés, correction manuelle requise (${nonMigres.length}) ---`);
  for (const n of nonMigres) {
    console.log(
      `  Dossier #${n.dossierId} : ${JSON.stringify(n.creneauxAvant)} -> mapping donnerait ${JSON.stringify(n.creneauxMappesInvalides)} ` +
        '(9h-18h seul, insuffisant) — laissé tel quel.',
    );
  }
}

main().catch((erreur) => {
  console.error('Échec de la migration ✘');
  console.error(erreur.message);
  process.exitCode = 1;
});
