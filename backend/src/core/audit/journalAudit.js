// Traçabilité RGPD ("qui, quoi, quand", voir CLAUDE.md section Contraintes RGPD) — écriture
// simple dans `journal_audit` (migration 023), aucune règle métier ici.
//
// `cible_id` est NOT NULL en base (migration 023) alors que certaines actions (ex : une
// connexion échouée sur un email inconnu) n'ont pas de ligne "cible" naturelle. Convention
// retenue : 0 sert de sentinel "aucune cible identifiée" pour ces cas — à documenter/valider
// avec le développeur senior si une valeur NULL explicite est préférée à terme (voir
// CLAUDE.auth-rbac.md).
async function enregistrerAction(bd, { utilisateurId = null, entiteId, action, tableCible, cibleId = 0, donnees = {}, adresseIp }) {
  await bd('journal_audit').insert({
    utilisateur_id: utilisateurId,
    entite_id: entiteId,
    action,
    table_cible: tableCible,
    cible_id: cibleId,
    donnees: JSON.stringify(donnees),
    adresse_ip: adresseIp,
  });
}

module.exports = { enregistrerAction };
