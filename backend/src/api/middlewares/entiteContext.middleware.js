const { obtenirKnex } = require('../../db/knex');
const { ENTITE_PAR_DEFAUT } = require('../../config/env');

// Résout l'entité courante à partir du sous-domaine (accecit.xxx.fr, adaptel.xxx.fr) et
// l'attache à req.entite — point d'entrée unique de cette résolution, exécuté avant toute
// route métier, de sorte qu'aucun contrôleur n'a besoin de reconnaître une entité en dur
// (voir docs/architecture-technique.md §1.2). En local (hostname sans sous-domaine), on
// retombe sur ENTITE_PAR_DEFAUT pour permettre le développement sans DNS multi-sous-domaines.
async function entiteContext(req, res, next) {
  try {
    const sousDomaine = req.hostname.split('.')[0];
    const codeEntite = ['localhost', 'www', req.hostname].includes(sousDomaine)
      ? ENTITE_PAR_DEFAUT
      : sousDomaine;

    if (!codeEntite) {
      console.warn(`entiteContext : sous-domaine absent pour l'hôte « ${req.hostname} », aucune entité par défaut configurée.`);
      return res.status(400).json({
        erreur: "Entité non résolue : sous-domaine absent et aucune entité par défaut configurée.",
      });
    }

    const bd = await obtenirKnex();
    const entite = await bd('entites').where({ code: codeEntite, actif: true }).first();

    if (!entite) {
      console.warn(`entiteContext : entité « ${codeEntite} » introuvable ou inactive (hôte « ${req.hostname} »).`);
      return res.status(404).json({ erreur: `Entité « ${codeEntite} » introuvable ou inactive.` });
    }

    req.entite = entite;
    next();
  } catch (erreur) {
    next(erreur);
  }
}

module.exports = { entiteContext };
