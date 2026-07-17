// Amorce la charte ACCECIT active dans la table `chartes` (texte + hash SHA-256 précalculé) —
// un seul de ces scripts (contrairement à seedBlocsDisponibles.js) car le texte est propre à
// chaque entité, pas un catalogue global. Idempotent : ré-exécutable sans dupliquer de ligne
// (une nouvelle version n'est créée que si le texte a changé, voir comparaison par hash).
//
// Usage : node scripts/seedCharte.js <code_entite>
// Exemple : node scripts/seedCharte.js accecit

const { obtenirKnex } = require('../src/db/knex');
const { calculerHashCharte } = require('../src/core/securite/charteHash');

const TEXTE_CHARTE_ACCECIT = `Charte ACCECIT — Règlement intérieur

Préambule
Le présent règlement a pour objet de préciser les règles applicables au sein d'ACCECIT et chez ses entreprises clientes, dans l'intérêt de tous et pour la bonne marche du travail. Il s'applique à l'ensemble du personnel intérimaire et temporaire pendant la durée de sa mission.

Article I — Ponctualité
Le salarié doit se présenter à son poste de travail à l'heure fixée, en tenue de travail complète et conforme aux exigences du poste.

Article II — Respect du règlement et de la clientèle
Le salarié s'engage à respecter le règlement intérieur de l'entreprise cliente ainsi que sa clientèle. Ce règlement est disponible à l'accueil de l'agence et dans le cahier de correspondance de chaque site.

Article III — Interdictions
Sont notamment interdits :
- la diffusion de tracts ou l'affichage non autorisé ;
- la circulation sans motif dans les zones réservées à la clientèle ;
- l'utilisation des chambres, salles de bains ou WC réservés à la clientèle ;
- toute vente ou tout achat avec les clients ou les employés de l'entreprise cliente ;
- les communications et visites personnelles, sauf urgence ;
- l'exécution de travaux personnels sur les lieux de travail ;
- l'emport non autorisé d'objets appartenant à l'entreprise cliente ;
- la dégradation d'affiches ;
- toute propagande politique, religieuse ou philosophique ;
- la réduction volontaire de la production.

Article IV — Comportement et hygiène
Le salarié doit adopter un comportement courtois envers la clientèle. Il est interdit de pénétrer sur le lieu de travail en état d'ébriété ou d'y introduire des boissons alcoolisées, ainsi que de fumer dans les zones où cela est signalé. Le salarié doit veiller à sa propreté vestimentaire et corporelle. Toute absence ou tout retard doit être signalé sans délai, et un justificatif doit être fourni dans un délai de 48 heures.

En cas d'urgence, un numéro est joignable au 01.56.56.69.56, du lundi au vendredi de 8h à 12h et de 14h à 18h, et le samedi et le dimanche de 8h à 15h. En dehors de ces horaires, un message peut être laissé.`;

async function seedCharte(codeEntite) {
  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: codeEntite }).first();
    if (!entite) {
      throw new Error(`Entité « ${codeEntite} » introuvable — lancer seedEntite.js d'abord.`);
    }

    const hash = calculerHashCharte(TEXTE_CHARTE_ACCECIT);
    const existante = await bd('chartes').where({ hash }).first();

    if (existante) {
      if (!existante.actif) {
        await bd.transaction(async (trx) => {
          await trx('chartes').where({ entite_id: entite.id }).update({ actif: false });
          await trx('chartes').where({ id: existante.id }).update({ actif: true });
        });
        console.log(`Charte « ${codeEntite} » (id=${existante.id}, version=${existante.version}) réactivée ✔`);
      } else {
        console.log(`Charte « ${codeEntite} » déjà active (id=${existante.id}, version=${existante.version}) ✔`);
      }
      return;
    }

    const derniere = await bd('chartes').where({ entite_id: entite.id }).orderBy('version', 'desc').first();
    const version = derniere ? derniere.version + 1 : 1;

    await bd.transaction(async (trx) => {
      await trx('chartes').where({ entite_id: entite.id }).update({ actif: false });
      const [inseree] = await trx('chartes')
        .insert({ version, texte: TEXTE_CHARTE_ACCECIT, hash, entite_id: entite.id, actif: true })
        .returning('id');
      console.log(`Charte « ${codeEntite} » créée (id=${inseree.id}, version=${version}) ✔`);
    });
  } finally {
    await bd.destroy();
  }
}

const codeEntite = process.argv[2];
if (!codeEntite) {
  console.error('Usage : node scripts/seedCharte.js <code_entite>');
  process.exit(1);
}

seedCharte(codeEntite).catch((erreur) => {
  console.error('Échec du seed ✘');
  console.error(erreur.message);
  process.exit(1);
});
