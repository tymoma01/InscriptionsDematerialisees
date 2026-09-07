// Correctif ponctuel — corrige le texte des deux lieux par défaut ACCECIT (un par secteur, voir
// migration 054/definirLieuxParDefautAccecit.js) : coquilles relevées côté Bureau et adresse/accès/
// instructions mis à jour côté Hôtel (audit planification des tests, 2026-09-07, décision
// utilisateur — l'adresse "16 Rue de Valadon" est la bonne, "14" était erroné).
//
//   Bureau (secteur 'bureau') :
//     metro_acces  : "RER B GENTILLY" -> "RER B Gentilly"
//     instructions : "Munissez vous de l'originale  de votre pièce d'idendité" (double espace +
//                     coquille "idendité") -> "Munissez vous de l'originale de votre pièce
//                     d'identité"
//     adresse inchangée.
//
//   Hôtel (secteur 'hotel') :
//     adresse      : "Hôtel du Cadran - 14 Rue de Valadon, 75007 Paris"
//                     -> "Hôtel Cadran - 16 Rue de Valadon, 75007 Paris"
//     metro_acces  : "Métro - Ecole Militaire - Ligne 8" -> "Métro Ecole Militaire - Ligne 8"
//     instructions : "Muni(e) de votre pièce d'identité originale, Appuyez sur l'interphone et
//                     dites ** TEST pour ACCECIT **" -> "Munissez vous de votre pièce d'identité
//                     en originale. Appuyez sur l'interphone et dites 'TEST pour ACCECIT'"
//
// Les lieux sont retrouvés par (entite_id, secteur, par_defaut=true) plutôt que par id ou par
// l'ancienne adresse : l'index unique partiel de la migration 054 garantit qu'il en existe au plus
// un par secteur, et ça reste vrai indépendamment de l'id réel en prod (voir
// definirLieuxParDefautAccecit.js, même principe). Passe par lieuService.modifierLieu (même chemin
// applicatif que le bouton crayon de ModalePlanificationTest.jsx) plutôt qu'un UPDATE direct —
// `code`/`secteur`/`par_defaut` restent inchangés, seuls adresse/metro_acces/instructions bougent.
//
// Idempotent : si un lieu a déjà exactement le texte cible, il est sauté sans erreur. Si son texte
// actuel ne correspond ni à l'état "avant" attendu ni à l'état "après" (adresse déjà modifiée
// autrement entre-temps, etc.), le script échoue sans rien modifier plutôt que de deviner — même
// garde-fou que corrigerLieu4HotelDuCadran.js.
//
// Impact convocations déjà envoyées : aucun (voir lieuService.modifierLieu — une convocation SMS/
// email déjà envoyée n'est jamais régénérée après coup, seules les planifications FUTURES verront
// le texte corrigé).
//
// Usage : node scripts/corrigerTexteLieuxDefautAccecit.js

const { obtenirKnex } = require('../src/db/knex');
const lieuService = require('../src/core/lieux/lieuService');

const CODE_ENTITE = 'accecit';

const CORRECTIFS = [
  {
    secteur: 'bureau',
    avant: {
      metroAcces: 'RER B GENTILLY',
      instructions: "Munissez vous de l'originale  de votre pièce d'idendité",
    },
    apres: {
      // adresse omise : inchangée pour ce lieu, voir modifierLieu (adresse toujours requise par le
      // service — on relit celle déjà en base au moment de l'appel, jamais devinée ici).
      metroAcces: 'RER B Gentilly',
      instructions: "Munissez vous de l'originale de votre pièce d'identité",
    },
  },
  {
    secteur: 'hotel',
    avant: {
      adresse: 'Hôtel du Cadran - 14 Rue de Valadon, 75007 Paris',
      metroAcces: 'Métro - Ecole Militaire - Ligne 8',
      instructions: "Muni(e) de votre pièce d'identité originale, Appuyez sur l'interphone et dites ** TEST pour ACCECIT **",
    },
    apres: {
      adresse: 'Hôtel Cadran - 16 Rue de Valadon, 75007 Paris',
      metroAcces: 'Métro Ecole Militaire - Ligne 8',
      instructions: "Munissez vous de votre pièce d'identité en originale. Appuyez sur l'interphone et dites 'TEST pour ACCECIT'",
    },
  },
];

async function main() {
  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: CODE_ENTITE }).first();
    if (!entite) {
      throw new Error(`Entité « ${CODE_ENTITE} » introuvable.`);
    }

    for (const { secteur, avant, apres } of CORRECTIFS) {
      // eslint-disable-next-line no-await-in-loop -- deux lieux seulement, séquentiel suffisant.
      const lieu = await bd('lieux').where({ entite_id: entite.id, secteur, par_defaut: true }).first();
      if (!lieu) {
        throw new Error(`Aucun lieu par défaut trouvé pour le secteur « ${secteur} » — arrêt sans rien modifier.`);
      }

      const cibleAdresse = apres.adresse ?? lieu.adresse;
      const dejaCorrige =
        lieu.adresse === cibleAdresse && lieu.metro_acces === apres.metroAcces && lieu.instructions === apres.instructions;
      if (dejaCorrige) {
        console.log(`Lieu #${lieu.id} (secteur « ${secteur} ») déjà corrigé — rien à faire.`);
        continue; // eslint-disable-line no-continue
      }

      const adresseAttendue = avant.adresse ?? lieu.adresse;
      const etatAvantInattendu =
        lieu.adresse !== adresseAttendue || lieu.metro_acces !== avant.metroAcces || lieu.instructions !== avant.instructions;
      if (etatAvantInattendu) {
        throw new Error(
          `Lieu #${lieu.id} (secteur « ${secteur} ») : état actuel différent de celui attendu avant correctif ` +
            `(adresse="${lieu.adresse}", metro_acces="${lieu.metro_acces}", instructions="${lieu.instructions}") — ` +
            'arrêt sans rien modifier.',
        );
      }

      console.log(`Lieu #${lieu.id} (secteur « ${secteur} ») avant correctif :`);
      console.log(`  adresse      : ${lieu.adresse}`);
      console.log(`  metro_acces  : ${lieu.metro_acces}`);
      console.log(`  instructions : ${lieu.instructions}`);

      // eslint-disable-next-line no-await-in-loop
      await lieuService.modifierLieu(entite, lieu.id, {
        adresse: cibleAdresse,
        metroAcces: apres.metroAcces,
        instructions: apres.instructions,
      });

      console.log(`Lieu #${lieu.id} (secteur « ${secteur} ») après correctif :`);
      console.log(`  adresse      : ${cibleAdresse}`);
      console.log(`  metro_acces  : ${apres.metroAcces}`);
      console.log(`  instructions : ${apres.instructions}`);
      console.log(`Lieu #${lieu.id} corrigé ✔ (code/secteur/par_defaut inchangés)\n`);
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
