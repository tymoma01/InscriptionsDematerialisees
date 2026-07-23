const rateLimit = require('express-rate-limit');

// 10 tentatives / 15 min / IP — assez large pour un usage légitime (une recruteuse qui se
// trompe une ou deux fois), assez strict pour freiner un brute-force (CLAUDE.md, section
// Authentification et rôles : "Rate limiting sur /login").
const limiteurConnexion = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erreur: 'Trop de tentatives de connexion. Merci de réessayer plus tard.' },
});

// Vérification d'unicité NIR/email au blur (candidats.routes.js POST /disponibilite) : plus
// permissif que la connexion (un candidat peut corriger sa saisie plusieurs fois de suite au
// clavier tactile), mais toujours limité — endpoint public, sans quoi il permettrait à un tiers
// d'énumérer par force brute les NIR/email déjà enregistrés.
const limiteurVerificationDisponibilite = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erreur: 'Trop de vérifications. Merci de réessayer plus tard.' },
});

module.exports = { limiteurConnexion, limiteurVerificationDisponibilite };
