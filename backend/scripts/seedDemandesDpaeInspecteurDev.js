// Données de test DPAE saisies par l'Inspecteur Hôtellerie — base de DEV UNIQUEMENT.
//
// Crée 6 demandes fictives (salariés « TEST-INSP 01 » à « TEST-INSP 06 ») avec les MÊMES fonctions
// que l'application : validation du corps par le schéma de la route (dpae.routes.js, mêmes règles
// que le formulaire), création par demandeDpaeService.creerEtEnvoyer avec le rôle de l'inspecteur
// (statut « À valider par le Planning », notifications au Planning), trace journal_audit identique
// à la route POST /, puis renvoi à l'inspecteur (note du Planning + demandeDpaeService.renvoyerAInspecteur).
// Aucune insertion directe, aucune date ajustée : les pastilles d'urgence sont calculées à partir de
// l'heure de lancement (premier jour et heure d'arrivée relatifs à maintenant).
//
// Usage (depuis backend/, az login préalable) :
//   node scripts/seedDemandesDpaeInspecteurDev.js
//   node scripts/seedDemandesDpaeInspecteurDev.js --supprimer
// Relancer ne crée aucun doublon. --supprimer retire UNIQUEMENT les demandes « TEST-INSP » avec leurs
// liens de sites, notes et notifications ; le journal d'audit n'est jamais modifié.
//
// Sécurité : refuse de tourner si NODE_ENV=production ou si la base visée est celle de production.

const { NODE_ENV } = require('../src/config/env');
const { obtenirConnectionString } = require('../src/db/config');
const { obtenirKnex } = require('../src/db/knex');
const journalAudit = require('../src/core/audit/journalAudit');
const demandeDpaeService = require('../src/core/dpae/demandeDpaeService');
const notesDemandeDpaeService = require('../src/core/dpae/notesDemandeDpaeService');
const { demandeBodySchema, normaliserDemande } = require('../src/api/routes/dpae.routes');
const { ROLES } = require('../src/core/auth/rbac');
const { jourParis, decalerJour } = require('../src/core/dpae/tableauDeBordDpaeService');

// Point de terminaison Neon de la base de PRODUCTION (voir docs/architecture-technique.md §6).
const HOTE_NEON_PRODUCTION = 'ep-late-dust-b1rzwwcb';
const PREFIXE_TEST = 'TEST-INSP';
const CODE_ENTITE = 'accecit';
const ADRESSE_IP = 'script-seed-dev';
const HEURE_MS = 3600 * 1000;

function arreter(message) {
  console.error(`\n⛔ ${message}\n`);
  process.exit(1);
}

// « Semaine type » : par jour, [heureDebut, heureFin, [initiales des sites]] ; null = repos.
const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
function semaineType(planning, sitesParInitiales) {
  return JOURS.map((jour, index) => {
    const cree = planning[index];
    if (!cree) return { jour, statut: 'repos' };
    const [heureDebut, heureFin, initiales] = cree;
    return { jour, statut: 'travail', heureDebut, heureFin, siteIds: initiales.map((i) => sitesParInitiales[i]) };
  });
}

// Heure de Paris d'un instant, « HH:MM ».
function heureParis(instant) {
  const parties = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  const valeur = (type) => parties.find((p) => p.type === type).value;
  return `${valeur('hour')}:${valeur('minute')}`;
}

// ---------------------------------------------------------------------------------------------
// Jeu de données. `debut` : { jours } (décalage en jours, heure d'arrivée 08:00) ou { heures }
// (échéance = maintenant + N heures, pour viser une tranche précise de la pastille d'urgence).
// Pastille : > 72 h vert ; 48 à 72 h orange ; < 48 h rouge ; échéance dépassée « En retard ».
// ---------------------------------------------------------------------------------------------
const DEMANDES = [
  {
    numero: '01', prenom: 'Aïcha', division: 'hotellerie', typeDemande: 'nouvelle_embauche', dejaEmploye: false, poste: 'femme_valet_chambre',
    contrat: 'cdd', motif: 'surcroit_activite', raisonSurcroit: 'Séminaire de fin de mois', debut: { jours: 1 }, dureeJours: 15, sites: ['AIG'],
    semaine: [['08:00', '16:00', ['AIG']], ['08:00', '16:00', ['AIG']], ['08:00', '16:00', ['AIG']], ['08:00', '16:00', ['AIG']], ['08:00', '16:00', ['AIG']], null, null],
  },
  {
    // Orange : échéance dans 60 h (2 jours et demi).
    numero: '02', prenom: 'Bruno', division: 'hotellerie', typeDemande: 'nouvelle_embauche', dejaEmploye: true, poste: 'equipier',
    contrat: 'cdd', motif: 'surcroit_activite', raisonSurcroit: 'Forte fréquentation', debut: { heures: 60 }, dureeJours: 21, sites: ['AIG', 'CAD'],
    semaine: [['09:00', '17:00', ['AIG']], ['09:00', '17:00', ['AIG', 'CAD']], null, ['09:00', '17:00', ['CAD']], null, null, null],
  },
  {
    numero: '03', prenom: 'Chloé', division: 'hotellerie', typeDemande: 'nouvelle_embauche', dejaEmploye: false, poste: 'cafetier',
    contrat: 'cdd', motif: 'remplacement_absent', remplace: 'Mme DUPUIS', debut: { jours: 10 }, dureeJours: 30, sites: ['AIG', 'CAD', 'MG'],
    semaine: [
      ['07:00', '15:00', ['AIG']], ['07:00', '15:00', ['CAD']], ['07:00', '15:00', ['MG']], ['12:00', '20:00', ['AIG', 'MG']],
      ['12:00', '20:00', ['CAD']], ['08:00', '14:00', ['MG']], null,
    ],
  },
  {
    numero: '04', prenom: 'Diego', division: 'tertiaire', typeDemande: 'passage_cdi', dejaEmploye: true, poste: 'gouvernant',
    contrat: 'cdi', debut: { jours: 5 }, sites: ['MG'],
    semaine: [['09:00', '17:00', ['MG']], ['09:00', '17:00', ['MG']], ['09:00', '17:00', ['MG']], ['09:00', '17:00', ['MG']], ['09:00', '17:00', ['MG']], null, null],
  },
  {
    numero: '05', prenom: 'Élodie', division: 'hotellerie', typeDemande: 'prolongation', dejaEmploye: true, poste: 'femme_valet_chambre',
    contrat: 'cdd', motif: 'surcroit_activite', raisonSurcroit: 'Remplacement de dernière minute', debut: { jours: -1 }, dureeJours: 10, sites: ['CAD'],
  },
  {
    // Renvoyée à l'inspecteur par le Planning de test (si le compte existe).
    numero: '06', prenom: 'Farid', division: 'hotellerie', typeDemande: 'nouvelle_embauche', dejaEmploye: false, poste: 'equipier',
    contrat: 'cdd', motif: 'remplacement_absent', remplace: 'M. LEROY', debut: { jours: 7 }, dureeJours: 14, sites: ['AIG', 'YMO'],
    semaine: [['08:00', '16:00', ['AIG']], ['08:00', '16:00', ['YMO']], ['08:00', '16:00', ['AIG', 'YMO']], null, null, ['08:00', '14:00', ['AIG']], null],
    renvoi: 'Merci de préciser les horaires du samedi',
  },
];

async function verifierBaseDev() {
  if (NODE_ENV === 'production') arreter('NODE_ENV=production : ce script ne s’exécute que sur la base de DEV.');
  const hote = new URL(await obtenirConnectionString()).hostname;
  if (hote.includes(HOTE_NEON_PRODUCTION)) arreter(`La base visée (${hote}) est celle de PRODUCTION : arrêt, rien n’a été modifié.`);
  console.log(`Base visée : ${hote} (DEV)`);
}

async function supprimer(bd, entite) {
  const ids = (await bd('demandes_dpae').where({ entite_id: entite.id }).andWhere('salarie_nom', 'like', `${PREFIXE_TEST} %`).select('id')).map((d) => d.id);
  if (ids.length === 0) {
    console.log('Aucune demande de test à supprimer.');
    return;
  }
  await bd.transaction(async (trx) => {
    const notifications = await trx('notifications').where({ table_cible: 'demandes_dpae' }).whereIn('cible_id', ids).del();
    const notes = await trx('notes_demande_dpae').whereIn('demande_dpae_id', ids).del();
    const liens = await trx('demandes_dpae_sites').whereIn('demande_dpae_id', ids).del();
    const demandes = await trx('demandes_dpae').whereIn('id', ids).del();
    console.log(
      `Supprimé : ${demandes} demande(s) de test (ids ${ids.join(', ')}), ${liens} lien(s) de sites, ${notes} note(s), ${notifications} notification(s). Journal d’audit intact.`,
    );
  });
}

async function trouverCompte(bd, entite, role) {
  return bd('utilisateurs as u')
    .join('roles as r', 'r.id', 'u.role_id')
    .where({ 'u.entite_id': entite.id, 'u.actif': true, 'r.code': role })
    .select('u.id', 'u.prenom', 'u.nom')
    .orderBy('u.id')
    .first();
}

function construireCorps(d, nom, sitesParInitiales, maintenant) {
  const sitesAffectationIds = d.sites.map((initiales) => {
    if (!sitesParInitiales[initiales]) arreter(`Site « ${initiales} » introuvable ou inactif dans le référentiel.`);
    return sitesParInitiales[initiales];
  });
  let dateDebut;
  let heureArrivee = '08:00';
  if (d.debut.heures !== undefined) {
    const echeance = new Date(maintenant.getTime() + d.debut.heures * HEURE_MS);
    dateDebut = jourParis(echeance);
    heureArrivee = heureParis(echeance);
  } else {
    dateDebut = decalerJour(jourParis(maintenant), d.debut.jours);
  }
  const estCdd = d.contrat === 'cdd';
  return {
    typeDemande: d.typeDemande,
    salarieNom: nom,
    salariePrenom: d.prenom,
    salarieTelephone: `06399801${d.numero}`,
    salarieDejaEmploye: d.dejaEmploye,
    sitesAffectationIds,
    typeContrat: d.contrat,
    motifCdd: estCdd ? d.motif : undefined,
    salarieRemplaceNom: estCdd && d.motif === 'remplacement_absent' ? d.remplace : undefined,
    raisonSurcroit: estCdd && d.motif === 'surcroit_activite' ? d.raisonSurcroit : undefined,
    division: d.division,
    poste: d.poste,
    dateDebut,
    dateFin: estCdd ? decalerJour(dateDebut, d.dureeJours - 1) : undefined,
    heureArriveeJ1: heureArrivee,
    heuresParMois: estCdd ? 120 : 151.67,
    semaineType: d.semaine ? semaineType(d.semaine, sitesParInitiales) : undefined,
    horairesDifferentsParJour: d.semaine ? true : undefined,
    verifBesoinHotel: true,
    verifTousJoursInclus: true,
    verifNonPlanification: true,
  };
}

async function creerDemandes(bd, entite, inspecteur, planning, maintenant) {
  const sitesParInitiales = Object.fromEntries(
    (await bd('sites_affectation').where({ entite_id: entite.id, actif: true }).select('id', 'initiales')).map((s) => [s.initiales, s.id]),
  );
  const renvoiImpossible = [];

  for (const d of DEMANDES) {
    const nom = `${PREFIXE_TEST} ${d.numero}`;
    let id;
    const existante = await bd('demandes_dpae').where({ entite_id: entite.id, salarie_nom: nom }).first('id', 'statut', 'version');
    if (existante) {
      id = existante.id;
      console.log(`  • ${nom} existe déjà (demande n° ${id}, ${existante.statut}) — non recréée.`);
    } else {
      // Même validation et même normalisation que POST /api/dpae.
      const donnees = normaliserDemande(demandeBodySchema.parse(construireCorps(d, nom, sitesParInitiales, maintenant)));
      id = await demandeDpaeService.creerEtEnvoyer(entite, inspecteur.id, donnees, { roleCode: ROLES.INSPECTEUR_HOTELLERIE });
      await journalAudit.enregistrerAction(bd, {
        utilisateurId: inspecteur.id,
        entiteId: entite.id,
        action: 'demande_dpae_creation',
        tableCible: 'demandes_dpae',
        cibleId: id,
        donnees: { typeDemande: donnees.typeDemande, sitesAffectationIds: donnees.sitesAffectationIds },
        adresseIp: ADRESSE_IP,
      });
      console.log(`  ✔ ${nom} créée (demande n° ${id})`);
    }

    // Renvoi par le Planning de test : seulement si la demande attend encore sa décision.
    if (d.renvoi) {
      const courante = await bd('demandes_dpae').where({ id }).first('statut', 'version');
      if (courante.statut !== 'a_valider_planning') continue;
      if (!planning) {
        renvoiImpossible.push(nom);
        continue;
      }
      // Plus de motif saisi au renvoi : la raison est une note de la demande, écrite par le Planning.
      await notesDemandeDpaeService.ajouterNote(entite, { demandeId: id, contenu: d.renvoi, auteurId: planning.id, roleCode: ROLES.PLANNING });
      await demandeDpaeService.renvoyerAInspecteur(entite, id, planning.id, {
        version: courante.version,
        adresseIp: ADRESSE_IP,
        roleCode: ROLES.PLANNING,
      });
      console.log(`    ↩ ${nom} renvoyée à l’inspecteur par ${planning.prenom} ${planning.nom} (note : « ${d.renvoi} »)`);
    }
  }
  if (renvoiImpossible.length > 0) {
    console.log(`\n⚠ Aucun compte Planning actif : ${renvoiImpossible.join(', ')} créée(s) sans être renvoyée(s).`);
  }
}

async function afficherRecapitulatif(bd, entite) {
  const demandes = await bd('demandes_dpae as d')
    .where('d.entite_id', entite.id)
    .andWhere('d.salarie_nom', 'like', `${PREFIXE_TEST} %`)
    .select(
      'd.id', 'd.salarie_nom', 'd.salarie_prenom', 'd.type_contrat', 'd.motif_cdd', 'd.division', 'd.statut',
      bd.raw("to_char(d.date_debut, 'DD/MM/YYYY') AS premier_jour"),
      bd.raw("to_char(d.date_fin, 'DD/MM/YYYY') AS dernier_jour"),
      'd.heure_arrivee_j1',
    )
    .orderBy('d.salarie_nom');
  const liens = await bd('demandes_dpae_sites as l')
    .join('sites_affectation as s', 's.id', 'l.site_affectation_id')
    .whereIn('l.demande_dpae_id', demandes.map((d) => d.id))
    .select('l.demande_dpae_id', 's.initiales')
    .orderBy('s.initiales');
  console.log('\nRÉCAPITULATIF');
  for (const d of demandes) {
    const sites = liens.filter((l) => l.demande_dpae_id === d.id).map((l) => l.initiales).join(', ');
    console.log(JSON.stringify({ ...d, sites }));
  }
}

async function executer() {
  await verifierBaseDev();
  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: CODE_ENTITE }).first();
    if (!entite) arreter(`Entité « ${CODE_ENTITE} » introuvable.`);
    if (process.argv.includes('--supprimer')) {
      await supprimer(bd, entite);
      return;
    }
    const inspecteur = await trouverCompte(bd, entite, ROLES.INSPECTEUR_HOTELLERIE);
    if (!inspecteur) arreter('Aucun compte actif du rôle Inspecteur Hôtellerie dans l’entité « accecit » : rien n’a été créé.');
    const planning = await trouverCompte(bd, entite, ROLES.PLANNING);
    console.log(`Auteur : ${inspecteur.prenom} ${inspecteur.nom} (n° ${inspecteur.id}) ; Planning : ${planning ? `${planning.prenom} ${planning.nom} (n° ${planning.id})` : 'aucun'}`);
    await creerDemandes(bd, entite, inspecteur, planning, new Date());
    await afficherRecapitulatif(bd, entite);
  } finally {
    await bd.destroy();
  }
}

executer().catch((erreur) => {
  console.error('\nÉCHEC :', erreur.message);
  process.exit(1);
});
