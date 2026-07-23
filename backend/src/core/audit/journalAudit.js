// Traçabilité RGPD ("qui, quoi, quand", voir CLAUDE.md section Contraintes RGPD) — écriture
// simple dans `journal_audit` (migration 023), aucune règle métier ici.
//
// `cible_id` est NOT NULL en base (migration 023) alors que certaines actions (ex : une
// connexion échouée sur un email inconnu) n'ont pas de ligne "cible" naturelle. Convention
// retenue : 0 sert de sentinel "aucune cible identifiée" pour ces cas — à documenter/valider
// avec le développeur senior si une valeur NULL explicite est préférée à terme (voir
// CLAUDE.auth-rbac.md).
//
// `adresse_ip` est NOT NULL en base elle aussi, mais `req.ip` (toujours ce qui est transmis ici,
// voir les appelants) s'est révélé occasionnellement vide/undefined en pratique — observé sur une
// requête HTTP tout à fait légitime, sans lien avec le proxy/la couche réseau habituelle du projet
// (pas de `trust proxy` configuré, voir app.js). Plutôt que de laisser la contrainte NOT NULL
// transformer une IP simplement indéterminée en échec 500 de toute l'action déjà accomplie
// (l'écriture métier qui précède cet appel a déjà réussi à ce stade), même convention sentinel
// que cible_id ci-dessus : 'inconnue' à la place d'un null/vide — à valider avec le développeur
// senior au même titre, notamment si un reverse proxy est ajouté en production (auquel cas
// `trust proxy` + `X-Forwarded-For` deviendront pertinents pour obtenir la vraie IP cliente,
// question distincte de ce correctif).
async function enregistrerAction(bd, { utilisateurId = null, entiteId, action, tableCible, cibleId = 0, donnees = {}, adresseIp }) {
  await bd('journal_audit').insert({
    utilisateur_id: utilisateurId,
    entite_id: entiteId,
    action,
    table_cible: tableCible,
    cible_id: cibleId,
    donnees: JSON.stringify(donnees),
    adresse_ip: adresseIp || 'inconnue',
  });
}

module.exports = { enregistrerAction };
