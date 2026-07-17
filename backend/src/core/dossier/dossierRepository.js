// Accès données pour candidats/dossiers/données de bloc — uniquement des requêtes,
// aucune règle métier ici (orchestrée par dossierService.js).

async function insererCandidat(
  trx,
  { entiteId, nom, nomNaissance, lieuNaissance, nationalite, prenom, dateNaissance, situationFamiliale, nirChiffre, nirIv }
) {
  const [candidat] = await trx('candidats')
    .insert({
      entite_id: entiteId,
      nom,
      nom_naissance: nomNaissance,
      lieu_naissance: lieuNaissance,
      nationalite,
      prenom,
      date_naissance: dateNaissance,
      situation_familiale: situationFamiliale,
      nir: nirChiffre,
      nir_iv: nirIv,
    })
    .returning('id');
  return candidat.id;
}

function trouverStatutInitial(trx, entiteId) {
  return trx('statuts').where({ entite_id: entiteId, est_initial: true }).first();
}

async function creerDossier(trx, { candidatId, entiteId, statutId }) {
  const [dossier] = await trx('dossiers')
    .insert({ candidat_id: candidatId, entite_id: entiteId, statut_id: statutId })
    .returning('id');
  return dossier.id;
}

function enregistrerDonneesBloc(trx, { dossierId, blocCode, donnees }) {
  return trx('dossier_donnees_formulaire').insert({
    dossier_id: dossierId,
    bloc_code: blocCode,
    donnees: JSON.stringify(donnees),
  });
}

module.exports = { insererCandidat, trouverStatutInitial, creerDossier, enregistrerDonneesBloc };
