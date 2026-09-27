// Accès aux corrections de disponibilité "Validé - prêt à l'embauche" (migration 065, audit
// 2026-09-28) — une ligne par correction, jamais de UPDATE en place (voir le commentaire de la
// migration). Aucune connaissance métier ici (validation, droits) : voir
// disponibiliteEmbaucheService.js.

// Insère une nouvelle correction — la déclaration d'origine (bloc 'disponibilites' du dossier)
// n'est jamais lue ni modifiée par cette fonction.
//
// date_debut/date_fin renvoyées telles que REÇUES en entrée (jamais relues depuis `.returning()`) :
// une colonne `date` PostgreSQL revient du driver `pg` sous forme d'objet Date JS (fuseau local),
// qu'un `new Date(...).toISOString()` en aval décalerait potentiellement d'un jour — même piège
// déjà documenté et évité ailleurs dans ce projet pour ce type de donnée (voir
// InformationsInscription.jsx, commentaire de versDateInput). Ici, inutile de relire quoi que ce
// soit : la valeur qu'on vient d'insérer est déjà la chaîne 'AAAA-MM-JJ' exacte reçue en argument.
async function enregistrerCorrection(trx, { dossierId, dateDebut, dateFin, commentaire, utilisateurId }) {
  const [ligne] = await trx('disponibilites_embauche_corrigees')
    .insert({
      dossier_id: dossierId,
      date_debut: dateDebut,
      date_fin: dateFin,
      commentaire,
      utilisateur_id: utilisateurId,
    })
    .returning(['id', 'created_at']);
  return [{ id: ligne.id, date_debut: dateDebut, date_fin: dateFin, commentaire, created_at: ligne.created_at }];
}

// La plus récente correction pour un dossier fait foi (voir la migration) — created_at DESC puis
// id DESC en repli (deux corrections à la même seconde, cas limite mais possible sur un `now()`
// peu précis) : jamais un simple ORDER BY created_at seul, qui laisserait l'ordre indéterminé
// entre deux lignes strictement égales.
// date_debut/date_fin castées en texte (`::text`) dans le SELECT — même raison que
// enregistrerCorrection ci-dessus, mais ici la valeur vient RÉELLEMENT d'une relecture en base
// (une correction PASSÉE), donc pas de raccourci possible : sans ce cast, le driver `pg` les
// renverrait en objets Date JS (fuseau local), au risque d'un décalage d'un jour une fois
// sérialisées en JSON pour le front.
function trouverDerniereCorrection(bd, dossierId) {
  return bd('disponibilites_embauche_corrigees as c')
    .leftJoin('utilisateurs as u', 'u.id', 'c.utilisateur_id')
    .where('c.dossier_id', dossierId)
    .select(
      'c.id',
      bd.raw('c.date_debut::text as date_debut'),
      bd.raw('c.date_fin::text as date_fin'),
      'c.commentaire',
      'c.created_at',
      'u.prenom as auteur_prenom',
      'u.nom as auteur_nom',
    )
    .orderBy([
      { column: 'c.created_at', order: 'desc' },
      { column: 'c.id', order: 'desc' },
    ])
    .first();
}

module.exports = { enregistrerCorrection, trouverDerniereCorrection };
