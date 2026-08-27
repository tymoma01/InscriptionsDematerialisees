const http = require('http');
const { creerApp } = require('./app');
const { PORT } = require('./config/env');
const { demarrerCronBasculeTestNonRealise } = require('./jobs/basculeTestNonRealiseCron');

// Filet de sécurité contre les rejets de promesse jamais rattrapés — sans lui, Node (depuis la
// v15, comportement par défaut) tue TOUT le process au premier rejet non observé. Constaté en
// audit (2026-08-27, calendrier hebdomadaire Outlook, dossier #88) : le SDK Azure
// (@azure/identity / @azure/keyvault-secrets, client HTTP @typespec/ts-http-runtime) peut, lors
// d'un ECONNREFUSED en tentant de joindre Key Vault ou l'endpoint de token Microsoft, rejeter une
// promesse INTERNE au SDK que notre code n'awaite jamais directement (donc qu'aucun try/catch
// applicatif ne peut intercepter) — reproduit en pointant artificiellement la résolution DNS de
// secretsforinscriptions.vault.azure.net vers une adresse sans service à l'écoute. Le symptôme
// observé était un crash silencieux du serveur (le calendrier de la modale de planification/
// replanification se retrouve bloqué, la trace Node brute de l'erreur apparaissant côté client
// via la requête restée sans réponse). Chaque appel réseau applicatif reste par ailleurs déjà
// couvert par son propre try/catch (voir graphCalendarService.js, keyVaultClient.js) : ce
// handler global est un dernier filet pour ce qui échappe à ces couches, jamais un remplacement.
process.on('unhandledRejection', (raison) => {
  console.error('Rejet de promesse non intercepté (voir commentaire process.on(\'unhandledRejection\') dans server.js) :');
  console.error(raison);
});

// creerApp() est asynchrone (attend la connection string Neon depuis Azure Key Vault pour
// monter le middleware de session, voir core/auth/session.js) — le serveur n'écoute qu'une fois
// l'app entièrement construite.
async function demarrer() {
  const app = await creerApp();
  const serveur = http.createServer(app);

  serveur.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
  });

  // Démarré une seule fois au lancement du serveur (audit 2026-08-21, dossier #84) — voir
  // jobs/basculeTestNonRealiseCron.js pour la fréquence et le verrou anti-chevauchement.
  demarrerCronBasculeTestNonRealise();

  // Arrêt propre : on attend la fin des requêtes en cours, mais serveur.close() seul ne coupe
  // pas les connexions keep-alive déjà établies (ex: onglet front resté ouvert) - sans ça son
  // callback n'est jamais appelé et le process reste vivant indéfiniment après un SIGINT/SIGTERM,
  // silencieusement (observé en pratique : process orphelin de plusieurs jours après un Ctrl+C).
  // closeAllConnections() force leur fermeture immédiate ; le délai de secours force la sortie
  // si l'arrêt traîne quand même au-delà d'un temps raisonnable.
  function arreter(signal) {
    console.log(`Signal ${signal} reçu, arrêt du serveur...`);

    const delaiSecours = setTimeout(() => {
      console.warn('Arrêt propre trop long, sortie forcée.');
      process.exit(1);
    }, 5000);
    delaiSecours.unref();

    serveur.close(() => {
      clearTimeout(delaiSecours);
      console.log('Serveur arrêté proprement.');
      process.exit(0);
    });
    serveur.closeAllConnections();
  }

  process.on('SIGTERM', () => arreter('SIGTERM'));
  process.on('SIGINT', () => arreter('SIGINT'));
}

demarrer().catch((erreur) => {
  console.error('Échec du démarrage du serveur ✘');
  console.error(erreur);
  process.exit(1);
});
