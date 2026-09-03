const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { entiteContext } = require('./api/middlewares/entiteContext.middleware');
const { creerMiddlewareSession } = require('./core/auth/session');
const authRoutes = require('./api/routes/auth.routes');
const candidatsRoutes = require('./api/routes/candidats.routes');
const dossiersRoutes = require('./api/routes/dossiers.routes');
const piecesRoutes = require('./api/routes/pieces.routes');
const relancesRoutes = require('./api/routes/relances.routes');
const notesRoutes = require('./api/routes/notes.routes');
const formationRoutes = require('./api/routes/formation.routes');
const rendezvousRoutes = require('./api/routes/rendezvous.routes');
const rendezvousDisponibilitesRoutes = require('./api/routes/rendezvousDisponibilites.routes');
const transitionsRoutes = require('./api/routes/transitions.routes');
const evaluationsRoutes = require('./api/routes/evaluations.routes');
const utilisateursRoutes = require('./api/routes/utilisateurs.routes');
const moiRoutes = require('./api/routes/moi.routes');
const formateursRoutes = require('./api/routes/formateurs.routes');
const lieuxRoutes = require('./api/routes/lieux.routes');
const statistiquesRoutes = require('./api/routes/statistiques.routes');
const { FRONTEND_URL } = require('./config/env');

// Build statique du front (React/Vite), copié dans public/ à la racine du conteneur par le
// Dockerfile (stage frontend-build) — servi par ce même serveur Express plutôt qu'un hébergement
// séparé, pour éviter un coût Azure supplémentaire et pour que la résolution d'entité par
// sous-domaine (entiteContext, basée sur req.hostname) reste sans complication de
// proxy/CORS/cookies cross-origin. __dirname = backend/src à l'exécution ; public/ est un
// dossier frère de src/ (voir Dockerfile : WORKDIR /app, COPY src ./src, COPY --from=frontend-build /frontend/dist ./public).
const REPERTOIRE_PUBLIC = path.join(__dirname, '../public');

// Fabrique asynchrone (plutôt qu'un export synchrone de `app`) : le middleware de session a
// besoin de la connection string Neon, récupérée depuis Azure Key Vault (voir
// core/auth/session.js), avant de pouvoir être monté — server.js attend creerApp() avant
// d'écouter le port.
async function creerApp() {
  const app = express();

  app.use(helmet());
  // credentials: true impose une origine explicite (jamais "*") — voir FRONTEND_URL dans
  // config/env.js, cohérent avec la résolution d'entité par sous-domaine (entiteContext).
  app.use(cors({ origin: FRONTEND_URL, credentials: true }));
  app.use(express.json());

  // Log de chaque requête reçue avec son statut de réponse — utile pour distinguer une requête
  // qui n'atteint jamais le backend (souci proxy/CORS côté front) d'une requête traitée mais
  // rejetée en amont des routes (ex. entiteContext, voir plus bas).
  app.use((req, res, next) => {
    const debut = Date.now();
    res.on('finish', () => {
      console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - debut}ms)`);
    });
    next();
  });

  // Fichiers statiques du build front (JS/CSS/images) — monté avant entiteContext/session,
  // scopés eux-mêmes à /api juste après : une requête d'asset statique n'a pas besoin de
  // résolution d'entité (requête SQL) ni de session, et ne doit jamais 404 à cause de ça.
  app.use(express.static(REPERTOIRE_PUBLIC));

  // entiteContext et le middleware de session sont scopés à /api uniquement (pas globaux) :
  // sinon chaque requête de fichier statique déclencherait inutilement une résolution d'entité
  // (requête SQL) et pourrait échouer à tort (ex. sous-domaine sans entité active).
  app.use('/api', entiteContext);
  // Doit être monté après entiteContext (req.entite) et avant toute route protégée : les
  // middlewares d'authentification (auth.middleware.js) comparent req.session.utilisateur à
  // req.entite pour l'isolation multi-entité.
  app.use('/api', await creerMiddlewareSession());

  app.use('/api/auth', authRoutes);
  app.use('/api/candidats', candidatsRoutes);
  // Vue centralisée des dossiers (liste + statuts, voir dossiers.routes.js) — monté avant le
  // routeur pièces justificatives ci-dessous, qui vit sur un sous-chemin plus spécifique.
  app.use('/api/dossiers', dossiersRoutes);
  // Protégée par requireAuth + requireRole (voir pieces.routes.js) — non protégée jusqu'à ce
  // correctif, voir CLAUDE.auth-rbac.md pour le détail de l'état précédent.
  app.use('/api/dossiers/:dossierId/pieces', piecesRoutes);
  // Historique des relances par dossier (CLAUDE.md, besoin Accueil/Coordination : "ne pas
  // relancer en double") — même patron que le routeur pièces justificatives ci-dessus.
  app.use('/api/dossiers/:dossierId/relances', relancesRoutes);
  // Journal de notes libres, indépendant des relances (voir notes.routes.js) — même patron que
  // le routeur relances ci-dessus.
  app.use('/api/dossiers/:dossierId/notes', notesRoutes);
  // Historique de formation par dossier (onglet "Formation" de la fiche dossier, audit
  // 2026-08-28) — lecture seule, même patron que le routeur relances ci-dessus.
  app.use('/api/dossiers/:dossierId/formation', formationRoutes);
  // Reprogrammations et désistements (CLAUDE.md, besoin Accueil/Coordination : "motif de
  // désistement enregistré systématiquement") — même patron que les deux routeurs ci-dessus.
  app.use('/api/dossiers/:dossierId/rendezvous', rendezvousRoutes);
  // Disponibilités Outlook réelles d'un formateur/inspecteur (calendrier hebdomadaire,
  // ModalePlanificationTest.jsx) — top-level, PAS scopé à un dossier (voir
  // rendezvousDisponibilites.routes.js) : préfixe distinct de '/api/dossiers/:dossierId/rendezvous'
  // ci-dessus, aucune ambiguïté de routage possible entre les deux.
  app.use('/api/rendezvous', rendezvousDisponibilitesRoutes);
  // Machine à états des dossiers (CLAUDE.md, contrainte de modularité n°1 : statuts/transitions
  // pilotés par configuration) — moteur générique, voir core/workflow/workflowEngine.js.
  app.use('/api/dossiers/:dossierId/transitions', transitionsRoutes);
  // Évaluation du test (CLAUDE.md, section Rôles : "Formateur ... évalue les candidats") — top-
  // level, pas nichée sous un dossier précis (voir evaluations.routes.js).
  app.use('/api/evaluations', evaluationsRoutes);
  // Gestion des comptes (CLAUDE.md, section Rôles : "Admin : gestion globale") — admin
  // uniquement, voir utilisateurs.routes.js.
  app.use('/api/utilisateurs', utilisateursRoutes);
  // Self-service "Mon profil" (n'importe quel rôle authentifié, sur SON PROPRE compte uniquement)
  // — distinct de /api/utilisateurs ci-dessus (admin, tous comptes), voir moi.routes.js.
  app.use('/api/moi', moiRoutes);
  // Liste des formateurs (Accueil/Coordination/Recruteur/Admin) — distinct de /api/utilisateurs
  // (admin uniquement) : sert à assigner un formateur lors de la planification d'un test, voir
  // formateurs.routes.js.
  app.use('/api/formateurs', formateursRoutes);
  // Liste des lieux de test (Accueil/Coordination/Recruteur/Admin) — même patron que
  // /api/formateurs ci-dessus : sert à choisir le lieu lors de la planification d'un test, voir
  // lieux.routes.js.
  app.use('/api/lieux', lieuxRoutes);
  // Tableau de bord KPI (CLAUDE.md, section Tableau de bord : "indicateurs de pilotage et
  // filtres") — Recruteur/Admin uniquement, voir statistiques.routes.js.
  app.use('/api/statistiques', statistiquesRoutes);

  // Une requête /api/* qui n'a matché aucune route ci-dessus est une vraie 404 d'API — à
  // renvoyer en JSON, jamais laisser tomber jusqu'à la route de repli SPA ci-dessous (qui,
  // elle, matche n'importe quel chemin y compris /api/*, voir son commentaire).
  app.use('/api', (req, res) => {
    res.status(404).json({ erreur: 'Route API introuvable.' });
  });

  // Route de repli SPA (React Router) : sert index.html pour toute route front, y compris un
  // rechargement direct sur une route profonde (ex. /candidat/tableau-de-bord) qui n'existe pas
  // comme fichier statique — nécessaire pour que le routing côté client fonctionne. Montée en
  // tout dernier (après le handler 404 /api/* ci-dessus) pour ne jamais intercepter une route API.
  // Syntaxe Express 5 (path-to-regexp v8) : un wildcard nommé est obligatoire ('*' seul lève une
  // erreur), et '/{*splat}' (groupe optionnel) est nécessaire pour matcher aussi la racine '/'.
  app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(REPERTOIRE_PUBLIC, 'index.html'));
  });

  // Gestionnaire d'erreurs générique : ne jamais renvoyer la stack ni le détail interne au client.
  // eslint-disable-next-line no-unused-vars
  app.use((erreur, req, res, next) => {
    console.error(erreur);
    res.status(500).json({ erreur: 'Une erreur est survenue. Merci de réessayer.' });
  });

  return app;
}

module.exports = { creerApp };
