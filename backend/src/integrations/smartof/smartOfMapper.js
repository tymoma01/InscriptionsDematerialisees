// Traduit les champs internes (candidats, dossier_donnees_formulaire) vers le format attendu par
// l'API SmartOF (POST /api/apprenant/create) — voir docs/architecture-technique.md §3.2 : "la
// seule couche qui connaît à la fois le modèle interne et le modèle SmartOF". Pure : aucun accès
// DB ni HTTP ici (voir smartOfService.js pour l'orchestration), pour rester testable isolément.

// 20 custom_field_N obligatoires côté SmartOF (chaîne, potentiellement vide). Seul custom_field_1
// a une correspondance ACCECIT connue à ce jour : le NIR (décision utilisateur, 2026-08-21 —
// champ déjà configuré/libellé "NIR" côté admin SmartOF). Les 19 autres restent à '' par défaut,
// à remplir si/quand SmartOF confirme un usage précis pour l'un d'eux.
function champsPersonnalisesVides(nir) {
  const champs = {};
  for (let i = 1; i <= 20; i += 1) {
    champs[`custom_field_${i}`] = '';
  }
  champs.custom_field_1 = nir || '';
  return champs;
}

// 'monsieur'/'madame' (candidats.civilite, voir BlocInfosPerso.jsx) -> enum SmartOF exact
// ("Monsieur"/"Madame"/"Non renseigné") — toute valeur non reconnue retombe sur "Non renseigné"
// plutôt que d'échouer (Modularité, CLAUDE.md : ce mapper ne doit pas bloquer une entité dont le
// vocabulaire de civilité diffère).
const CIVILITE_SMARTOF = { monsieur: 'Monsieur', madame: 'Madame' };
function civiliteSmartOf(civilite) {
  return CIVILITE_SMARTOF[civilite] ?? 'Non renseigné';
}

function dateNaissanceSmartOf(dateNaissance) {
  if (!dateNaissance) return '';
  const date = dateNaissance instanceof Date ? dateNaissance : new Date(dateNaissance);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

// Construit le payload POST /api/apprenant/create pour UN candidat.
//
// `inscription` : forme renvoyée par dossierRepository.trouverInscriptionCompleteParDossierId
// ({ candidat: {civilite, nom, nomNaissance, prenom, dateNaissance, ...}, blocs: {coordonnees,
// disponibilites, mutuelle, consentement_rgpd} }).
// `dossierId` : posé en `customId` — c'est le SEUL champ de la réponse SmartOF (voir
// smartOfClient.creerApprenant) qui permette de relier a posteriori un Apprenant SmartOF à un
// dossier ACCECIT, d'où son importance (voir smartof_sync.dossier_id, table déjà prévue pour ça).
// `entrepriseUid` : résolu par smartOfService.js (résolution par rôle, voir
// entites.smartof_config.entreprises_par_role), pas ici — ce mapper ne connaît aucun rôle ni
// aucune règle métier de résolution, seulement la traduction de champs déjà résolus.
// `nir` : NIR déjà déchiffré par smartOfService.js (jamais ici — ce mapper reste pur, aucun accès
// Key Vault) ; chaîne vide si absent/déchiffrement en échec, voir custom_field_1 ci-dessous.
//
// Champs SmartOF sans source ACCECIT connue à ce jour (fonction/lieuActivite/numeroCompteComptable/
// statutBPF, complementAdresse) : laissés vides plutôt que devinés — voir le commentaire de chacun
// ci-dessous. Point ouvert à trancher avec SmartOF/l'équipe avant mise en production si l'un de ces
// champs s'avère en réalité obligatoire pour eux au-delà du typage OpenAPI (qui les marque
// "required" au sens "présent", pas "non vide").
function construirePayloadApprenant({ dossierId, inscription, entrepriseUid, nir }) {
  const { candidat, blocs } = inscription;
  const coordonnees = blocs?.coordonnees ?? {};

  return {
    // "APPX-<id dossier>" (décision utilisateur, 2026-08-21) : customId est réellement obligatoire
    // côté SmartOF (testé le même jour : omis -> 400 "customId Required", pas d'auto-incrément
    // façon APP-00XX pour une création via l'API, ce préfixe n'a donc pas à suivre LEUR séquence)
    // — sert seulement de référence pour nous, à retrouver le dossier ACCECIT d'origine depuis
    // SmartOF (voir smartof_sync.dossier_id, qui porte déjà cette même information côté ACCECIT).
    customId: `APPX-${dossierId}`,
    // coordonnees.email prioritaire sur candidats.email : c'est la valeur que le candidat a
    // effectivement confirmée au bloc "Coordonnées" du formulaire (CLAUDE.md, étape 2) — les deux
    // sont identiques dans l'immense majorité des cas (candidats.email sert surtout à la
    // détection de doublon, voir dossierRepository.trouverCandidatParEmail), coordonnees.email
    // reste la source la plus proche de "ce que le candidat a déclaré vouloir comme contact".
    email: coordonnees.email || candidat.email || '',
    custom_fields: champsPersonnalisesVides(nir),
    meta: {
      nom: candidat.nom ?? '',
      // Pas de "nom d'usage" distinct dans le formulaire ACCECIT (BlocInfosPerso.jsx : nom,
      // naissance, n° SS, situation familiale) — nomNaissance existe côté ACCECIT mais désigne
      // autre chose (nom de naissance, pas nom d'usage) ; nom retenu comme valeur par défaut la
      // plus proche de ce que SmartOF affichera au quotidien, plutôt qu'une chaîne vide.
      nomUsage: candidat.nom ?? '',
      prenom: candidat.prenom ?? '',
      // Pas de source ACCECIT : ce champ SmartOF désigne la fonction/le poste occupé côté client
      // (contexte B2B), sans équivalent direct pour un candidat en recherche d'emploi.
      fonction: '',
      // Pas de source ACCECIT : lieu d'exercice de l'activité (contexte B2B, entreprise cliente).
      lieuActivite: '',
      dateNaissance: dateNaissanceSmartOf(candidat.dateNaissance),
      tel: coordonnees.telephone ?? '',
      adresse: {
        // BlocCoordonnees.jsx collecte le numéro et nom de rue dans `adresse` (champ dédié,
        // renommé fonctionnellement pour ça — décision utilisateur, 2026-08-21), et codePostal/
        // ville séparément depuis la même date. complementAdresse reste vide : pas de champ ACCECIT
        // équivalent, et pas de découpage inventé sur du texte libre (contrairement à l'ancienne
        // version de ce mapper, où seul `adresse` existait).
        rue: coordonnees.adresse ?? '',
        complementAdresse: '',
        codePostal: coordonnees.codePostal ?? '',
        ville: coordonnees.ville ?? '',
      },
      civilite: civiliteSmartOf(candidat.civilite),
      // Pas de source ACCECIT (comptabilité SmartOF interne).
      numeroCompteComptable: '',
      // Pas de source ACCECIT : ACCECIT ne déclare pas la provenance BPF au sens Bilan Pédagogique
      // et Financier pour chaque candidat au moment de l'envoi en formation — valeur autorisée la
      // plus neutre de l'enum SmartOF (chaîne vide), à trancher avec l'équipe si un choix
      // spécifique est en réalité attendu.
      statutBPF: '',
    },
    entrepriseUids: entrepriseUid ? [entrepriseUid] : [],
    archived: false,
  };
}

module.exports = { construirePayloadApprenant };
