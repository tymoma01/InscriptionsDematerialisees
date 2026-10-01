// Données de test DPAE — base de DEV UNIQUEMENT (2026-09-30).
//
// Crée 10 demandes DPAE fictives (salariés « TEST-DPAE 01 » à « TEST-DPAE 10 ») en passant par les
// MÊMES fonctions que l'application : validation du corps par le schéma de la route
// (dpae.routes.js, demandeBodySchema), création par demandeDpaeService.creerEtEnvoyer (sites
// vérifiés, transaction), puis validation/rejet RH par demandeDpaeService.valider/rejeter
// (notifications au demandeur comprises), et les mêmes entrées journal_audit que les routes.
//
// Seules les DATES ne peuvent pas être fixées par les services (ils posent now()) : date de
// création/envoi, date de décision RH et date_maj des demandes, et, pour rester cohérent, la
// date des entrées journal_audit et des notifications liées à CES demandes de test. Elles sont
// ajustées en base, uniquement pour ces demandes, dans une transaction.
//
// Usage (depuis backend/, az login préalable) :
//   node scripts/seedDemandesDpaeDev.js [--admin=<id>] [--planning=<id>] [--rh=<id>]
//   node scripts/seedDemandesDpaeDev.js --sans-planning   (DEV sans compte Planning : 2e Admin)
//   node scripts/seedDemandesDpaeDev.js --supprimer
// Sans option, les comptes sont choisis parmi les comptes ACTIFS de l'entité « accecit » (Admin et
// Planning : demandeurs ; RH, à défaut Admin : traitant). Relancer ne crée aucun doublon.
// --supprimer : supprime UNIQUEMENT ces demandes de test et leurs liens de sites — rien d'autre
// (les entrées journal_audit et notifications restent, comme pour toute action tracée).
//
// Sécurité : refuse de tourner si NODE_ENV=production ou si la base visée est celle de production.

const { NODE_ENV } = require('../src/config/env');
const { obtenirConnectionString } = require('../src/db/config');
const { obtenirKnex } = require('../src/db/knex');
const journalAudit = require('../src/core/audit/journalAudit');
const demandeDpaeService = require('../src/core/dpae/demandeDpaeService');
const { demandeBodySchema } = require('../src/api/routes/dpae.routes');
const { jourParis, decalerJour } = require('../src/core/dpae/tableauDeBordDpaeService');

// Point de terminaison Neon de la base de PRODUCTION (voir docs/architecture-technique.md §6).
const HOTE_NEON_PRODUCTION = 'ep-late-dust-b1rzwwcb';
const PREFIXE_TEST = 'TEST-DPAE';
const CODE_ENTITE = 'accecit';
const ADRESSE_IP = 'script-seed-dev';

function arreter(message) {
  console.error(`\n⛔ ${message}\n`);
  process.exit(1);
}

function lireOption(nom) {
  const argument = process.argv.find((a) => a.startsWith(`--${nom}=`));
  return argument ? Number(argument.split('=')[1]) : null;
}

// ---------------------------------------------------------------------------------------------
// Jeu de données — dates RELATIVES au jour du lancement (heure de Paris).
//   creation : { jours, heure } = il y a N jours à HH:MM (Paris), ou { heures } = il y a N heures.
//   delaiMinutes : délai de traitement RH (validées/rejetées).
//   debut/fin : décalage en jours par rapport à aujourd'hui (Paris).
// Sites : initiales du référentiel ; AIG, CAD et MG reviennent souvent (top des sites parlant).
// ---------------------------------------------------------------------------------------------
const DEMANDES = [
  {
    numero: '01', prenom: 'Aïcha', statut: 'validee', demandeur: 'admin', creation: { jours: 34, heure: '09:00' }, delaiMinutes: 48 * 60,
    typeDemande: 'nouvelle_embauche', dejaEmploye: false, poste: 'femme_valet_chambre', contrat: 'cdd', motif: 'remplacement_absent', remplace: 'Mme DUPUIS',
    sites: ['AIG'], debut: -30, fin: 40,
  },
  {
    numero: '02', prenom: 'Bruno', statut: 'validee', demandeur: 'planning', creation: { jours: 27, heure: '14:00' }, delaiMinutes: 35,
    typeDemande: 'passage_cdi', dejaEmploye: true, poste: 'gouvernant', contrat: 'cdi', sites: ['AIG', 'CAD'], debut: -20,
  },
  {
    numero: '03', prenom: 'Chloé', statut: 'rejetee', demandeur: 'admin', creation: { jours: 20, heure: '11:00' }, delaiMinutes: 3 * 60,
    typeDemande: 'nouvelle_embauche', dejaEmploye: false, poste: 'cafetier', contrat: 'cdd', motif: 'surcroit_activite',
    sites: ['AIG', 'CAD', 'MG'], debut: -15, fin: -1, motifRejet: 'Besoin non confirmé par l’hôtel.',
  },
  {
    // RETARD : validée le lendemain de son premier jour.
    numero: '04', prenom: 'Diego', statut: 'validee', demandeur: 'planning', creation: { jours: 13, heure: '09:00' }, delaiMinutes: 28 * 60,
    typeDemande: 'prolongation', dejaEmploye: true, poste: 'equipier', contrat: 'cdd', motif: 'surcroit_activite',
    sites: ['AIG', 'CAD', 'MG', 'BOH'], debut: -13, fin: 12,
  },
  {
    numero: '05', prenom: 'Élodie', statut: 'rejetee', demandeur: 'admin', creation: { jours: 8, heure: '16:00' }, delaiMinutes: 10,
    typeDemande: 'changement_horaires_affectation', dejaEmploye: true, poste: 'cafetier', contrat: 'cdi', sites: ['CAD'], debut: -2,
    motifRejet: 'Doublon d’une demande déjà traitée.',
  },
  {
    // ANTICIPATION 7 jours : CDD validé dont le dernier jour tombe dans 5 jours.
    numero: '06', prenom: 'Farid', statut: 'validee', demandeur: 'admin', creation: { jours: 6, heure: '08:30' }, delaiMinutes: 5 * 60,
    typeDemande: 'ajout_retrait_jours', dejaEmploye: true, poste: 'femme_valet_chambre', contrat: 'cdd', motif: 'remplacement_absent', remplace: 'M. LEROY',
    sites: ['MG', 'YMO'], debut: -1, fin: 5,
  },
  {
    // PRIORITÉ : en attente depuis plus de 24 h.
    numero: '07', prenom: 'Gaëlle', statut: 'envoyee', demandeur: 'planning', creation: { jours: 3, heure: '10:00' },
    typeDemande: 'nouvelle_embauche', dejaEmploye: false, poste: 'equipier', contrat: 'cdd', motif: 'remplacement_absent', remplace: 'Mme BERTRAND',
    sites: ['AIG', 'GCL', 'RAN'], debut: 5, fin: 60,
  },
  {
    // PRIORITÉ : en attente, premier jour AUJOURD'HUI.
    numero: '08', prenom: 'Hugo', statut: 'envoyee', demandeur: 'admin', creation: { heures: 3 },
    typeDemande: 'nouvelle_embauche', dejaEmploye: false, poste: 'gouvernant', contrat: 'cdi', sites: ['AIG', 'CAD', 'MG', 'YMO'], debut: 0,
  },
  {
    // PRIORITÉ : en attente, premier jour DEMAIN.
    numero: '09', prenom: 'Inès', statut: 'envoyee', demandeur: 'planning', creation: { heures: 5 },
    typeDemande: 'prolongation', dejaEmploye: true, poste: 'cafetier', contrat: 'cdd', motif: 'remplacement_absent', remplace: 'M. GARNIER',
    sites: ['CAD'], debut: 1, fin: 30,
  },
  {
    numero: '10', prenom: 'Jules', statut: 'envoyee', demandeur: 'admin', creation: { heures: 1 },
    typeDemande: 'passage_cdi', dejaEmploye: true, poste: 'autre', posteAutre: 'Plongeur', contrat: 'cdi', sites: ['MG'], debut: 10,
  },
];

// Instant de création : « il y a N heures », ou « il y a N jours à HH:MM » heure de Paris (toutes les
// dates du jeu tombent en heure d'été, UTC+2, jusqu'au 25/10 ; le décalage est lu par Intl pour
// rester juste même après).
function instantCreation(creation, maintenant) {
  if (creation.heures !== undefined) return new Date(maintenant.getTime() - creation.heures * 3600 * 1000);
  const jour = decalerJour(jourParis(maintenant), -creation.jours);
  const midiUtc = new Date(`${jour}T12:00:00Z`);
  // formatToParts (et non format) : en français, une heure seule se formate « 14 h ».
  const heureParisAMidiUtc = Number(
    new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(midiUtc)
      .find((partie) => partie.type === 'hour').value,
  );
  const decalageHeures = heureParisAMidiUtc - 12;
  const [h, m] = creation.heure.split(':').map(Number);
  return new Date(Date.UTC(...jour.split('-').map((v, i) => (i === 1 ? Number(v) - 1 : Number(v))), h - decalageHeures, m));
}

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
    const liens = await trx('demandes_dpae_sites').whereIn('demande_dpae_id', ids).del();
    const demandes = await trx('demandes_dpae').whereIn('id', ids).del();
    console.log(`Supprimé : ${demandes} demande(s) de test et ${liens} lien(s) de sites (ids ${ids.join(', ')}). Rien d’autre.`);
  });
}

async function resoudreComptes(bd, entite) {
  const compte = async (role, idOption) => {
    const requete = bd('utilisateurs as u')
      .join('roles as r', 'r.id', 'u.role_id')
      .where({ 'u.entite_id': entite.id, 'u.actif': true, 'r.code': role })
      .select('u.id', 'u.prenom', 'u.nom')
      .orderBy('u.id');
    if (idOption) requete.andWhere('u.id', idOption);
    return requete.first();
  };
  const admin = await compte('admin', lireOption('admin'));
  let planning = await compte('planning', lireOption('planning'));
  const rh = (await compte('rh', lireOption('rh'))) ?? admin;
  if (!admin) arreter('Aucun compte Admin actif trouvé dans l’entité « accecit » (ou --admin=<id> invalide).');
  // --sans-planning (choix explicite, 2026-09-30 : la base DEV n'a aucun compte Planning) : les
  // demandes « Planning » sont attribuées à un SECOND compte Admin actif — aucun compte créé.
  if (!planning && process.argv.includes('--sans-planning')) {
    planning = await bd('utilisateurs as u')
      .join('roles as r', 'r.id', 'u.role_id')
      .where({ 'u.entite_id': entite.id, 'u.actif': true, 'r.code': 'admin' })
      .whereNot('u.id', admin.id)
      .select('u.id', 'u.prenom', 'u.nom')
      .orderBy('u.id')
      .first();
    if (!planning) arreter('--sans-planning : aucun second compte Admin actif disponible.');
    console.log('⚠ Aucun compte Planning : les demandes « Planning » sont attribuées à un second compte Admin (--sans-planning).');
  }
  if (!planning) {
    arreter(
      'Aucun compte Planning actif trouvé dans l’entité « accecit » (ou --planning=<id> invalide). ' +
        'Créez-en un en DEV (écran « Comptes utilisateurs ») puis relancez, éventuellement avec --planning=<id>, ' +
        'ou relancez avec --sans-planning pour utiliser un second compte Admin.',
    );
  }
  return { admin, planning, rh };
}

async function creerDemandes(bd, entite, comptes, maintenant) {
  const aujourdhui = jourParis(maintenant);
  const sitesParInitiales = Object.fromEntries(
    (await bd('sites_affectation').where({ entite_id: entite.id, actif: true }).select('id', 'initiales')).map((s) => [s.initiales, s.id]),
  );

  for (const d of DEMANDES) {
    const nom = `${PREFIXE_TEST} ${d.numero}`;
    const existante = await bd('demandes_dpae').where({ entite_id: entite.id, salarie_nom: nom }).first('id');
    if (existante) {
      console.log(`  • ${nom} existe déjà (demande n° ${existante.id}) — non recréée.`);
      continue;
    }
    const demandeur = comptes[d.demandeur];
    const sitesAffectationIds = d.sites.map((initiales) => {
      if (!sitesParInitiales[initiales]) arreter(`Site « ${initiales} » introuvable ou inactif dans le référentiel.`);
      return sitesParInitiales[initiales];
    });

    // Même validation que POST /api/dpae.
    const donnees = demandeBodySchema.parse({
      typeDemande: d.typeDemande,
      salarieNom: nom,
      salariePrenom: d.prenom,
      salarieTelephone: '0600000000',
      salarieDejaEmploye: d.dejaEmploye,
      sitesAffectationIds,
      typeContrat: d.contrat,
      motifCdd: d.contrat === 'cdd' ? d.motif : undefined,
      salarieRemplaceNom: d.contrat === 'cdd' && d.motif === 'remplacement_absent' ? d.remplace : undefined,
      poste: d.poste,
      posteAutre: d.posteAutre,
      dateDebut: decalerJour(aujourdhui, d.debut),
      dateFin: d.fin !== undefined ? decalerJour(aujourdhui, d.fin) : undefined,
      heureArriveeJ1: '08:00',
      heuresParMois: d.contrat === 'cdi' ? 151.67 : 120,
      verifBesoinHotel: true,
      verifTousJoursInclus: true,
      verifNonPlanification: true,
    });

    // Création (service de l'application) + trace journal_audit identique à la route POST /.
    const id = await demandeDpaeService.creerEtEnvoyer(entite, demandeur.id, donnees);
    await journalAudit.enregistrerAction(bd, {
      utilisateurId: demandeur.id,
      entiteId: entite.id,
      action: 'demande_dpae_creation',
      tableCible: 'demandes_dpae',
      cibleId: id,
      donnees: { typeDemande: donnees.typeDemande, sitesAffectationIds },
      adresseIp: ADRESSE_IP,
    });

    // Décision RH (service de l'application) + trace identique aux routes PATCH /:id/valider|rejeter.
    if (d.statut === 'validee') {
      await demandeDpaeService.valider(entite, id, comptes.rh.id);
      await journalAudit.enregistrerAction(bd, {
        utilisateurId: comptes.rh.id,
        entiteId: entite.id,
        action: 'demande_dpae_validation',
        tableCible: 'demandes_dpae',
        cibleId: id,
        donnees: {},
        adresseIp: ADRESSE_IP,
      });
    } else if (d.statut === 'rejetee') {
      await demandeDpaeService.rejeter(entite, id, comptes.rh.id, d.motifRejet);
      await journalAudit.enregistrerAction(bd, {
        utilisateurId: comptes.rh.id,
        entiteId: entite.id,
        action: 'demande_dpae_rejet',
        tableCible: 'demandes_dpae',
        cibleId: id,
        donnees: { motifRejet: d.motifRejet },
        adresseIp: ADRESSE_IP,
      });
    }

    // Seules dates que les services ne permettent pas de fixer : ajustées pour CETTE demande.
    const dateCreation = instantCreation(d.creation, maintenant);
    const dateDecision = d.delaiMinutes !== undefined ? new Date(dateCreation.getTime() + d.delaiMinutes * 60 * 1000) : null;
    await bd.transaction(async (trx) => {
      await trx('demandes_dpae').where({ id }).update({
        date_creation: dateCreation,
        date_traitement: dateDecision,
        date_maj: dateDecision ?? dateCreation,
      });
      await trx('journal_audit').where({ table_cible: 'demandes_dpae', cible_id: id, action: 'demande_dpae_creation' }).update({ date_action: dateCreation });
      if (dateDecision) {
        await trx('journal_audit')
          .where({ table_cible: 'demandes_dpae', cible_id: id })
          .whereIn('action', ['demande_dpae_validation', 'demande_dpae_rejet'])
          .update({ date_action: dateDecision });
        await trx('notifications').where({ table_cible: 'demandes_dpae', cible_id: id }).update({ date_creation: dateDecision });
      }
    });
    console.log(`  ✔ ${nom} créée (demande n° ${id}, ${d.statut})`);
  }
}

async function afficherRecapitulatif(bd, entite) {
  const demandes = await bd('demandes_dpae as d')
    .join('utilisateurs as u', 'u.id', 'd.demandeur_id')
    .join('roles as r', 'r.id', 'u.role_id')
    .where('d.entite_id', entite.id)
    .andWhere('d.salarie_nom', 'like', `${PREFIXE_TEST} %`)
    .select(
      'd.id',
      'd.salarie_nom',
      'd.salarie_prenom',
      'd.type_contrat',
      'd.motif_cdd',
      'd.statut',
      bd.raw("to_char(d.date_creation AT TIME ZONE 'Europe/Paris', 'DD/MM/YYYY HH24:MI') AS demande_le"),
      bd.raw("to_char(d.date_traitement AT TIME ZONE 'Europe/Paris', 'DD/MM/YYYY HH24:MI') AS traitee_le"),
      bd.raw("to_char(d.date_debut, 'DD/MM/YYYY') AS premier_jour"),
      bd.raw("to_char(d.date_fin, 'DD/MM/YYYY') AS dernier_jour"),
      bd.raw("u.prenom || ' ' || u.nom || ' (' || r.code || ')' AS demandeur"),
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
    const comptes = await resoudreComptes(bd, entite);
    console.log(
      `Demandeurs : Admin ${comptes.admin.prenom} ${comptes.admin.nom} (n° ${comptes.admin.id}), second demandeur ${comptes.planning.prenom} ${comptes.planning.nom} (n° ${comptes.planning.id}) ; traitant RH : ${comptes.rh.prenom} ${comptes.rh.nom} (n° ${comptes.rh.id})`,
    );
    await creerDemandes(bd, entite, comptes, new Date());
    await afficherRecapitulatif(bd, entite);
  } finally {
    await bd.destroy();
  }
}

executer().catch((erreur) => {
  console.error('\nÉCHEC :', erreur.message);
  process.exit(1);
});
