const crypto = require('crypto');

// SHA-256 du texte exact de la charte — sert à identifier de façon stable une version de
// charte (voir table `chartes`, colonne `hash`). Toujours calculé côté serveur à partir du
// texte réellement stocké, jamais reçu tel quel d'un client.
function calculerHashCharte(texte) {
  return crypto.createHash('sha256').update(texte, 'utf8').digest('hex');
}

module.exports = { calculerHashCharte };
