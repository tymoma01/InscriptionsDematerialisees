// Utilisateurs factices des tests de notifications DPAE : remplace la lecture de l'auteur et du
// demandeur (demandeDpaeRepository.trouverUtilisateurAvecRole). `parId` : { [id]: { role_code, ... } },
// tout identifiant absent est un compte actif Admin.
const demandeDpaeRepository = require('./demandeDpaeRepository');

function mockerUtilisateurs(t, parId = {}) {
  return t.mock.method(demandeDpaeRepository, 'trouverUtilisateurAvecRole', async (_trx, _entiteId, id) => ({
    id,
    prenom: 'Alice',
    nom: `Durand${id}`,
    actif: true,
    role_code: 'admin',
    role_libelle: 'Admin',
    ...parId[id],
  }));
}

module.exports = { mockerUtilisateurs };
