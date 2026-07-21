// Accès données générique pour `motifs` (migration 007) — table réutilisée par plusieurs
// domaines (relances, rendez-vous, machine à états des dossiers), chacun avec sa propre
// `categorie` (voir Modularité, CLAUDE.md : "motifs : vocabulaire des motifs [...] propre à
// chaque entité"). Un seul point de requête plutôt qu'une fonction dupliquée par domaine.

function trouverMotifParCode(bd, entiteId, categorie, code) {
  return bd('motifs').where({ entite_id: entiteId, categorie, code, actif: true }).first();
}

function listerMotifsParCategorie(bd, entiteId, categorie) {
  return bd('motifs').where({ entite_id: entiteId, categorie, actif: true }).orderBy('id', 'asc');
}

module.exports = { trouverMotifParCode, listerMotifsParCategorie };
