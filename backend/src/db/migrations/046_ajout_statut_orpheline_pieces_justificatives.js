// Ajoute 'orpheline' aux valeurs autorisées de statut_verification (migration 028 : en_attente,
// valide, rejete). Distinct de 'rejete', qui signifie qu'un humain (recruteur/accueil) a examiné
// la pièce et l'a jugée insuffisante (mauvais document, photo illisible...) — 'orpheline' signifie
// que le fichier lui-même a disparu du stockage documentaire (OneDrive/SharePoint), constaté par
// le système au moment d'un export ZIP (voir pieceJustificativeService.listerPiecesJustificativesAvecContenu,
// correctif du 2026-08-06) et non par un jugement humain. Mélanger les deux sous 'rejete' aurait
// laissé croire qu'un recruteur a examiné une pièce qu'il n'a en réalité jamais pu voir.
//
// Volontairement PAS ajouté à STATUTS_VERIFICATION_AUTORISES (pieceJustificativeService.js) : ce
// statut n'est jamais choisi par une action humaine (les boutons Valider/Rejeter du back-office
// restent à 2 choix), seulement posé par un script serveur (voir scripts/marquerPiecesOrphelines.js).
const CONTRAINTE = 'pieces_justificatives_statut_verification_check';
const VALEURS_AVANT = ['en_attente', 'valide', 'rejete'];
const VALEURS_APRES = [...VALEURS_AVANT, 'orpheline'];

exports.up = (knex) =>
  knex
    .raw(`ALTER TABLE pieces_justificatives DROP CONSTRAINT ${CONTRAINTE}`)
    .then(() =>
      knex.raw(
        `ALTER TABLE pieces_justificatives
         ADD CONSTRAINT ${CONTRAINTE}
         CHECK (statut_verification IN (${VALEURS_APRES.map((v) => `'${v}'`).join(', ')}))`,
      ),
    );

// Pas de retour arrière automatique vers l'ancienne contrainte plus stricte si des lignes
// 'orpheline' existent déjà en base au moment du rollback : down() échouerait alors avec une
// violation de contrainte, ce qui est le comportement voulu (empêcher un rollback qui rendrait
// des lignes existantes invalides silencieusement) plutôt que de les convertir arbitrairement
// vers une autre valeur.
exports.down = (knex) =>
  knex
    .raw(`ALTER TABLE pieces_justificatives DROP CONSTRAINT ${CONTRAINTE}`)
    .then(() =>
      knex.raw(
        `ALTER TABLE pieces_justificatives
         ADD CONSTRAINT ${CONTRAINTE}
         CHECK (statut_verification IN (${VALEURS_AVANT.map((v) => `'${v}'`).join(', ')}))`,
      ),
    );
