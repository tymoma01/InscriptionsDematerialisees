const db = require('../../db/knex');
const lieuRepository = require('./lieuRepository');
const rendezvousRepository = require('../rendezvous/rendezvousRepository');
const notificationChangementLieuService = require('../rendezvous/notificationChangementLieuService');

// Erreur métier distincte d'une Error générique (500 opaque) — même principe que
// ErreurStatistiquesInvalide (statistiquesService.js) : lieux.routes.js la traduit en 404 avec un
// message directement affichable à l'agent plutôt que de laisser un lieuId inexistant (ou d'une
// autre entité, voir modifierLieu ci-dessous) tomber dans le gestionnaire d'erreurs générique.
class ErreurLieuIntrouvable extends Error {
  constructor(message) {
    super(message);
    this.name = 'ErreurLieuIntrouvable';
  }
}

// Suppression demandée sans lieu de destination alors que ce lieu est encore associé à au moins
// un rendez-vous (voir supprimerLieu plus bas) — porte la liste des rendez-vous concernés
// (`rendezvousAssocies`, même forme que listerRendezvousAssocies) pour que lieux.routes.js puisse
// répondre 409 avec de quoi afficher directement le panneau de migration côté front, même si
// l'agent n'a pas fait l'appel GET de vérification en amont.
class ErreurMigrationRequise extends Error {
  constructor(rendezvousAssocies) {
    super('Ce lieu est encore associé à au moins un rendez-vous — une migration vers un autre lieu est requise avant suppression.');
    this.name = 'ErreurMigrationRequise';
    this.rendezvousAssocies = rendezvousAssocies;
  }
}

// Lieu de destination invalide à la migration : identique au lieu supprimé, introuvable, ou hors
// entité — distincte de ErreurLieuIntrouvable (qui vise le lieu À SUPPRIMER) pour que la route
// puisse renvoyer un message ciblé sur le bon champ.
class ErreurLieuDestinationInvalide extends Error {
  constructor(message) {
    super(message);
    this.name = 'ErreurLieuDestinationInvalide';
  }
}

// Sert le sélecteur de lieu de ModalePlanificationTest.jsx (voir lieux.routes.js) — même patron
// que utilisateurService.listerFormateursEtInspecteurs pour le sélecteur de formateur.
async function listerLieuxActifs(entite) {
  const bd = await db.obtenirKnex();
  return lieuRepository.listerLieuxActifs(bd, entite.id);
}

// `code` (migration 044) sert d'identifiant stable de repli/debug (voir seedLieux.js : 'accecit',
// 'hotel_du_cadran') — un lieu créé à la volée depuis la modale de planification n'en a pas, ce
// slug le dérive de l'ADRESSE saisie (accents retirés, tout ce qui n'est pas alphanumérique réduit
// à un seul '_', bornes coupées) plutôt que de laisser l'agent en saisir un : ce n'est pas une
// information qu'un utilisateur d'Accueil a de raison de connaître ou de choisir. Dérivé de
// `adresse` seule depuis la migration 047 (champs structurés) — jamais de `metroAcces`/
// `instructions` : ce sont des compléments, pas ce qui identifie le lieu, un slug qui les inclurait
// deviendrait un pavé de texte illisible pour un simple identifiant de repli/debug.
function slugifier(texte) {
  return texte
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Nombre d'essais borné (pas de boucle infinie) — au-delà, la collision est traitée comme une
// anomalie plutôt que réessayée indéfiniment (voir obtenirCodeUnique ci-dessous).
const TENTATIVES_MAX_CODE_UNIQUE = 50;

// `code` n'a pas de contrainte UNIQUE en base (voir lieuRepository.trouverLieuParCode) — vérifié
// ici plutôt que de laisser deux lieux à l'adresse proche collisionner silencieusement sur le même
// code. Suffixe numérique (_2, _3, ...) en cas de collision, même principe que la désambiguïsation
// de fichiers dupliqués (voir azureOneDriveConnector.js).
async function obtenirCodeUnique(bd, entiteId, adresse) {
  const base = slugifier(adresse) || 'lieu';
  for (let tentative = 1; tentative <= TENTATIVES_MAX_CODE_UNIQUE; tentative += 1) {
    const code = tentative === 1 ? base : `${base}_${tentative}`;
    // eslint-disable-next-line no-await-in-loop -- tentatives séquentielles nécessaires : chaque
    // essai dépend du résultat (encore pris ?) du précédent, pas parallélisable.
    const existant = await lieuRepository.trouverLieuParCode(bd, entiteId, code);
    if (!existant) return code;
  }
  throw new Error(`Impossible de générer un code de lieu unique pour "${adresse}" après ${TENTATIVES_MAX_CODE_UNIQUE} tentatives.`);
}

// '' (champ optionnel laissé vide côté formulaire) -> null, jamais une chaîne vide stockée en
// base ni transmise à un `undefined` (voir lieuRepository.js : knex/pg lève une erreur sur un
// binding `undefined`) — même logique que le repli lieuId '' -> undefined déjà fait côté front
// (ModalePlanificationTest.jsx) pour un champ optionnel.
function normaliserChampOptionnel(valeur) {
  const nettoyee = typeof valeur === 'string' ? valeur.trim() : valeur;
  return nettoyee ? nettoyee : null;
}

// Création à la volée depuis la modale de planification de test (voir ModalePlanificationTest.jsx,
// lieuService.js front, lieux.routes.js) — trois champs structurés depuis la migration 047 :
// `adresse` (obligatoire, identifie le lieu physique), `metroAcces`/`instructions` (optionnels,
// compléments d'accès). Avant cette migration, un seul champ `libelle` texte libre portait les
// trois informations concaténées à la main (voir audit du 2026-08-13) — remplacé ici par des
// colonnes dédiées, plus besoin de convention de formatage côté agent.
//
// `secteur`/`parDefaut` (migration 054, audit 2026-08-27) : `secteur` seul est un simple champ de
// plus, écrit tel quel. `parDefaut` coché ("Définir comme lieu par défaut pour ce secteur",
// ModalePlanificationTest.jsx) déclenche la même bascule transactionnelle que
// definirLieuParDefaut ci-dessous — englobée ici dans UNE SEULE transaction avec l'INSERT du lieu
// lui-même (jamais un lieu créé d'abord puis basculé dans un second aller-retour) : soit la
// création ET la bascule réussissent ensemble, soit aucune des deux n'est actée, cohérent avec le
// reste des écritures multi-étapes de ce service (voir supprimerLieu plus bas).
async function creerLieu(entite, { adresse, metroAcces, instructions, secteur, parDefaut }) {
  const bd = await db.obtenirKnex();
  const code = await obtenirCodeUnique(bd, entite.id, adresse);
  const secteurNormalise = normaliserChampOptionnel(secteur);
  const donneesLieu = {
    code,
    adresse,
    metroAcces: normaliserChampOptionnel(metroAcces),
    instructions: normaliserChampOptionnel(instructions),
    secteur: secteurNormalise,
  };

  if (!parDefaut) {
    const [lieu] = await lieuRepository.creerLieu(bd, entite.id, donneesLieu);
    return lieu;
  }

  return bd.transaction(async (trx) => {
    const [lieuCree] = await lieuRepository.creerLieu(trx, entite.id, donneesLieu);
    const [lieu] = await lieuRepository.definirLieuParDefaut(trx, entite.id, lieuCree.id, secteurNormalise);
    return lieu;
  });
}

// Modification à la volée depuis la même modale (bouton crayon à côté du sélecteur, voir
// ModalePlanificationTest.jsx) — `adresse`/`metroAcces`/`instructions` modifiables, `code` reste
// inchangé (pas regénéré depuis la nouvelle adresse : c'est un identifiant technique de repli/
// debug, pas une information qui a besoin de suivre une correction de texte, voir slugifier
// ci-dessus).
//
// Impact sur les rendez-vous déjà planifiés à ce lieu (point vérifié avant d'écrire cette
// fonction, toujours valable depuis la migration 047) : `rendezvous.lieu_id` est une FK vers
// `lieux` (migration 045), jamais une copie de l'adresse — invitationTestService.
// envoyerInvitationTest résout adresse/metroAcces/instructions à la volée à partir de cet id à
// CHAQUE appel, il n'existe nulle part de snapshot au moment de la planification. Concrètement :
// modifier un lieu ici change immédiatement l'adresse vue sur toute planification FUTURE utilisant
// ce lieu, et sur l'affichage back-office d'un rendez-vous existant s'il re-résout le lieu (même
// mécanisme). Mais envoyerInvitationTest n'est appelé qu'UNE SEULE fois, au moment de la création
// du rendez-vous (voir planificationRendezvousService.js) — une convocation SMS/email déjà envoyée
// à un candidat est un message déjà délivré, rien ne la régénère ni ne la renvoie automatiquement
// après coup. Donc : si l'adresse d'un lieu change après qu'une convocation a déjà été envoyée pour
// un rendez-vous à ce lieu, ce candidat garde l'ancienne adresse dans sa boîte mail/SMS tant que
// personne ne le relance manuellement — à signaler à l'agent Accueil comme point de vigilance
// opérationnel, pas quelque chose que ce correctif peut résoudre côté code (aucun mécanisme de
// renvoi automatique de convocation n'existe dans ce projet).
async function modifierLieu(entite, lieuId, { adresse, metroAcces, instructions }) {
  const bd = await db.obtenirKnex();
  const [lieu] = await lieuRepository.modifierLieu(bd, entite.id, lieuId, {
    adresse,
    metroAcces: normaliserChampOptionnel(metroAcces),
    instructions: normaliserChampOptionnel(instructions),
  });
  if (!lieu) {
    throw new ErreurLieuIntrouvable(`Lieu "${lieuId}" introuvable pour l'entité « ${entite.code} ».`);
  }
  return lieu;
}

// Forme exposée à l'agent (GET /api/lieux/:lieuId/rendezvous, panneau de suppression
// ModalePlanificationTest.jsx) — jamais les coordonnées candidat (email/téléphone, portées par
// rendezvousRepository.listerRendezvousParLieu pour la notification uniquement, voir
// supprimerLieu ci-dessous) : l'agent n'a besoin que d'identifier le rendez-vous (candidat + date),
// pas de voir ses coordonnées à cet écran.
function serialiserRendezvousAssocie(rendezvous) {
  return {
    id: rendezvous.id,
    dateHeure: rendezvous.date_heure,
    candidatNom: rendezvous.candidat_nom,
    candidatPrenom: rendezvous.candidat_prenom,
  };
}

// Rendez-vous encore associés à ce lieu — sert au panneau de suppression pour décider entre
// suppression directe (aucun) et migration (au moins un), voir ModalePlanificationTest.jsx.
async function listerRendezvousAssocies(entite, lieuId) {
  const bd = await db.obtenirKnex();
  const lieu = await lieuRepository.trouverLieuParId(bd, entite.id, lieuId);
  if (!lieu) {
    throw new ErreurLieuIntrouvable(`Lieu "${lieuId}" introuvable pour l'entité « ${entite.code} ».`);
  }
  const rendezvousAssocies = await rendezvousRepository.listerRendezvousParLieu(bd, entite.id, lieuId);
  return rendezvousAssocies.map(serialiserRendezvousAssocie);
}

// Suppression d'un lieu (bouton poubelle, ModalePlanificationTest.jsx) — deux chemins :
//  - aucun rendez-vous associé : suppression directe, `lieuDestinationId` ignoré s'il est fourni
//    (rien à migrer).
//  - au moins un rendez-vous associé : `lieuDestinationId` obligatoire — migration puis
//    suppression dans une seule transaction (rendezvousRepository.migrerRendezvousVersLieu avant
//    lieuRepository.supprimerLieu : la FK rendezvous.lieu_id, migration 045, n'a pas de ON DELETE
//    CASCADE/SET NULL, la migration doit donc précéder la suppression pour ne pas violer la
//    contrainte référentielle).
//
// Re-vérifie les rendez-vous associés à l'intérieur de cette fonction plutôt que de faire
// confiance à un comptage déjà fait côté agent (voir listerRendezvousAssocies) : un rendez-vous a
// pu être créé entre les deux appels, le back reste seul juge au moment de l'action — même
// principe que rendezvousService.creerRendezvous/compterRendezvousFormateurAuCreneau.
//
// Notifications (email + SMS aux candidats migrés) envoyées APRÈS la transaction, jamais dedans —
// même principe que planificationRendezvousService.js : un envoi lent ne doit pas garder une
// connexion DB ouverte, et un échec d'envoi ne doit jamais faire échouer une migration/suppression
// déjà actée en base. journal_audit n'est PAS écrit ici : convention du projet (voir
// rendezvous.routes.js/utilisateurs.routes.js) — c'est la route qui journalise, après l'appel au
// service, avec `bd` (jamais `trx`), pas cette couche.
async function supprimerLieu(entite, lieuId, { lieuDestinationId } = {}) {
  const bd = await db.obtenirKnex();

  const lieu = await lieuRepository.trouverLieuParId(bd, entite.id, lieuId);
  if (!lieu) {
    throw new ErreurLieuIntrouvable(`Lieu "${lieuId}" introuvable pour l'entité « ${entite.code} ».`);
  }

  const rendezvousAssocies = await rendezvousRepository.listerRendezvousParLieu(bd, entite.id, lieuId);

  if (rendezvousAssocies.length === 0) {
    await lieuRepository.supprimerLieu(bd, entite.id, lieuId);
    return { lieu, lieuDestination: null, rendezvousMigres: 0, rendezvousAssocies: [], notifications: [] };
  }

  if (!lieuDestinationId) {
    throw new ErreurMigrationRequise(rendezvousAssocies.map(serialiserRendezvousAssocie));
  }
  if (Number(lieuDestinationId) === Number(lieuId)) {
    throw new ErreurLieuDestinationInvalide('Le lieu de destination doit être différent du lieu supprimé.');
  }
  const lieuDestination = await lieuRepository.trouverLieuParId(bd, entite.id, lieuDestinationId);
  if (!lieuDestination) {
    throw new ErreurLieuDestinationInvalide(`Lieu de destination "${lieuDestinationId}" introuvable pour l'entité « ${entite.code} ».`);
  }

  await bd.transaction(async (trx) => {
    await rendezvousRepository.migrerRendezvousVersLieu(trx, { lieuIdOrigine: lieuId, lieuIdDestination: lieuDestination.id });
    await lieuRepository.supprimerLieu(trx, entite.id, lieuId);
  });

  // Objet structuré depuis la migration 047 (plus un simple libelle string) — voir
  // notificationChangementLieuService.js pour ce qui est fait de chacun des trois champs (SMS/.ics
  // limités à adresse+metroAcces, email HTML seul à inclure aussi instructions).
  const nouveauLieu = {
    adresse: lieuDestination.adresse,
    metroAcces: lieuDestination.metro_acces,
    instructions: lieuDestination.instructions,
  };
  const notifications = await Promise.all(
    rendezvousAssocies.map((rendezvous) =>
      notificationChangementLieuService.envoyerNotificationChangementLieu(entite, rendezvous, nouveauLieu),
    ),
  );

  return {
    lieu,
    lieuDestination,
    rendezvousMigres: rendezvousAssocies.length,
    rendezvousAssocies: rendezvousAssocies.map(serialiserRendezvousAssocie),
    notifications,
  };
}

module.exports = {
  listerLieuxActifs,
  creerLieu,
  modifierLieu,
  listerRendezvousAssocies,
  supprimerLieu,
  ErreurLieuIntrouvable,
  ErreurMigrationRequise,
  ErreurLieuDestinationInvalide,
};
