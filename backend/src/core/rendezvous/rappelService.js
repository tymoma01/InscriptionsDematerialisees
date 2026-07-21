const db = require('../../db/knex');
const dossierRepository = require('../dossier/dossierRepository');
const relanceRepository = require('../dossier/relanceRepository');
const rendezvousRepository = require('./rendezvousRepository');
const notificationFactory = require('../../integrations/notifications/notificationFactory');

// Fenêtre par défaut du rappel automatique de créneau (CLAUDE.md : "confirmation de présence à
// un créneau avant le jour J") — pas de valeur idéale démontrée à ce stade, 48h laisse le temps
// à l'accueil de reprogrammer en cas de désistement annoncé ; à ajuster si besoin, ce n'est pas
// une contrainte issue du terrain à ce jour (point à confirmer avec la coordination).
const FENETRE_RAPPEL_HEURES = 48;

const CANAUX_AUTORISES = ['sms', 'email'];

function construireMessageRappel({ candidat_prenom: prenom, candidat_nom: nom, type_rdv: typeRdv, date_heure: dateHeure }) {
  const date = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(dateHeure));
  return `Bonjour ${prenom} ${nom}, rappel de votre rendez-vous (${typeRdv}) le ${date}. Merci de confirmer votre présence auprès de l'accueil.`;
}

// Point d'entrée unique du rappel automatique — idempotent (voir
// rendezvousRepository.listerRendezvousARappeler, qui exclut déjà les rendez-vous ayant reçu un
// rappel), donc rejouable sans risque de double envoi quel que soit le mécanisme de
// déclenchement choisi en production (cron externe, tâche planifiée, Azure Function Timer — non
// tranché à ce stade, voir scripts/executerRappels.js). N'invoque jamais le prestataire de
// notification si `entite.sms_actif` est faux (voir docs/architecture-technique.md §3.3) : une
// entité sans intégration SMS/email activée n'a simplement aucun rappel envoyé.
async function executerRappels(entite) {
  if (!entite.sms_actif) {
    return { envoyes: 0, echecs: 0, ignores: 0, desactive: true };
  }

  const canal = entite.canal_rappel;
  if (!CANAUX_AUTORISES.includes(canal)) {
    throw new Error(`Canal de rappel "${canal}" invalide pour l'entité « ${entite.code} » (attendu : ${CANAUX_AUTORISES.join(', ')}).`);
  }

  const bd = await db.obtenirKnex();

  const utilisateurSysteme = await dossierRepository.trouverUtilisateurSysteme(bd, entite.id);
  if (!utilisateurSysteme) {
    throw new Error(`Utilisateur système non configuré pour l'entité « ${entite.code} » (voir scripts/seedUtilisateurSysteme.js).`);
  }

  const rendezvousARappeler = await rendezvousRepository.listerRendezvousARappeler(bd, entite.id, {
    fenetreHeures: FENETRE_RAPPEL_HEURES,
  });

  const notificationProvider = notificationFactory();

  let envoyes = 0;
  let echecs = 0;
  let ignores = 0;

  for (const rendezvous of rendezvousARappeler) {
    const coordonnees = await rendezvousRepository.trouverCoordonneesCandidat(bd, rendezvous.dossier_id);
    const destinataire = canal === 'email' ? coordonnees?.email : coordonnees?.telephone;

    if (!destinataire) {
      console.error(
        `Rappel ignoré pour le rendez-vous ${rendezvous.id} (dossier ${rendezvous.dossier_id}) : pas de ${canal === 'email' ? 'email' : 'téléphone'} renseigné.`,
      );
      ignores += 1;
      continue;
    }

    try {
      await notificationProvider.envoyer(destinataire, canal, construireMessageRappel(rendezvous));
      // N'enregistre la relance qu'après un envoi réussi : c'est cette ligne qui empêche un
      // futur run de renvoyer un rappel pour ce même rendez-vous (voir
      // rendezvousRepository.listerRendezvousARappeler) — un échec doit au contraire rester
      // éligible à une nouvelle tentative au prochain run.
      await relanceRepository.enregistrerRelance(bd, {
        dossierId: rendezvous.dossier_id,
        canal,
        resultat: 'envoye',
        utilisateurId: utilisateurSysteme.id,
        rendezvousId: rendezvous.id,
      });
      envoyes += 1;
    } catch (erreur) {
      console.error(`Échec de l'envoi du rappel pour le rendez-vous ${rendezvous.id} :`, erreur.message);
      echecs += 1;
    }
  }

  return { envoyes, echecs, ignores, total: rendezvousARappeler.length };
}

module.exports = { executerRappels, FENETRE_RAPPEL_HEURES };
