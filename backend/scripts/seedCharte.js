// Amorce la charte active d'une entité dans la table `chartes` (texte + hash SHA-256
// précalculé) — texte propre à chaque entité (voir TEXTES_CHARTE plus bas), pas un catalogue
// global. Idempotent : ré-exécutable sans dupliquer de ligne (une nouvelle version n'est créée
// que si le texte a changé, voir comparaison par hash) — la recherche d'une charte existante est
// scopée par entite_id ET hash : `chartes.hash` est UNIQUE au niveau base (migration 024), mais
// GLOBALEMENT, pas par entité — sans le filtre entite_id ici, deux entités partageant un texte de
// charte identique (même hash) se verraient à tort l'une renvoyer la charte de l'autre comme
// "déjà active", laissant la seconde entité sans charte du tout (voir dossierRepository.
// trouverCharteActive, qui lui est correctement scopé par entite_id).
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

// PLACEHOLDER — pas le vrai texte Adaptel (jamais fourni à ce stade du projet), uniquement pour
// vérifier que le mécanisme (scroll-gate, hash, FK charte_id) fonctionne pour une seconde entité
// indépendamment d'ACCECIT (voir Modularité, CLAUDE.md). À remplacer avant toute mise en
// production d'Adaptel.
const TEXTE_CHARTE_ADAPTEL = `Charte Adaptel — Règlement intérieur (texte provisoire)

Ce texte est un espace réservé en attente du règlement intérieur réel d'Adaptel. Il sert
uniquement à vérifier que la signature électronique de la charte fonctionne correctement pour
cette entité, indépendamment de la configuration d'ACCECIT.`;

const TEXTES_CHARTE = {
  accecit: TEXTE_CHARTE_ACCECIT,
  adaptel: TEXTE_CHARTE_ADAPTEL,
};

async function seedCharte(codeEntite) {
  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: codeEntite }).first();
    if (!entite) {
      throw new Error(`Entité « ${codeEntite} » introuvable — lancer seedEntite.js d'abord.`);
    }

    const texteCharte = TEXTES_CHARTE[codeEntite];
    if (!texteCharte) {
      throw new Error(`Aucun texte de charte défini pour « ${codeEntite} » dans ce script.`);
    }

    const hash = calculerHashCharte(texteCharte);
    const existante = await bd('chartes').where({ hash, entite_id: entite.id }).first();

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
        .insert({ version, texte: texteCharte, hash, entite_id: entite.id, actif: true })
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
