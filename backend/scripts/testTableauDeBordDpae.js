// Test d'intégration du « Tableau de bord DPAE » (2026-09-30) — exécute les VRAIES requêtes SQL
// (tableauDeBordDpaeRepository.js : agrégats calculés en base, heure de Paris) sur la base Neon de
// DEV, avec un jeu de données de test créé DANS UNE TRANSACTION TOUJOURS ANNULÉE : rien n'est
// jamais écrit durablement. Complète les tests unitaires (npm test), qui n'ont pas de base.
// Même principe que scripts/testUniciteInscriptionCandidat.js.
//
// Usage : node scripts/testTableauDeBordDpae.js (nécessite az login préalable). Refuse de tourner
// avec NODE_ENV=production.
const assert = require('node:assert/strict');
const { NODE_ENV } = require('../src/config/env');
const { obtenirKnex } = require('../src/db/knex');
const tableauDeBordDpaeService = require('../src/core/dpae/tableauDeBordDpaeService');

if (NODE_ENV === 'production') {
  console.error('Refus : ce script de test est réservé à la base de DEV.');
  process.exit(1);
}

// « Maintenant » figé : 15/10/2026 à 12 h 00, heure de Paris (10 h 00 UTC). Aujourd'hui = 15/10,
// demain = 16/10. Période par défaut : 16/09 -> 15/10.
const MAINTENANT = new Date('2026-10-15T10:00:00Z');
const ANNULATION = new Error('annulation volontaire du jeu de test');

const resultats = [];
function verifier(libelle, fonction) {
  fonction();
  resultats.push(libelle);
  console.log(`  ✔ ${libelle}`);
}

async function creerJeuDeTest(trx) {
  const suffixe = Date.now();
  const [entiteA] = await trx('entites').insert({ code: `test-tdb-a-${suffixe}`, nom: 'Test TDB A', connecteur_stockage: 'test' }).returning('*');
  const [entiteB] = await trx('entites').insert({ code: `test-tdb-b-${suffixe}`, nom: 'Test TDB B', connecteur_stockage: 'test' }).returning('*');
  const { id: roleId } = await trx('roles').where({ code: 'planning' }).first('id');
  const utilisateur = async (entiteId, prenom) =>
    (
      await trx('utilisateurs')
        .insert({ entite_id: entiteId, role_id: roleId, nom: 'Test', prenom, email: `${prenom}-${suffixe}@exemple-test.local`, mot_de_passe_hash: 'x' })
        .returning('*')
    )[0];
  const u1 = await utilisateur(entiteA.id, 'Ursule');
  const u2 = await utilisateur(entiteA.id, 'Victor');
  const uB = await utilisateur(entiteB.id, 'Autre');
  const site = async (nom, initiales) => (await trx('sites_affectation').insert({ entite_id: entiteA.id, nom, initiales }).returning('*'))[0];
  const s1 = await site('SITE UN', 'SU');
  const s2 = await site('SITE DEUX', 'SD');
  const s3 = await site('SITE TROIS', 'ST');

  const demande = async ({ entite = entiteA, demandeur = u1, sites = [], ...champs }) => {
    const [ligne] = await trx('demandes_dpae')
      .insert({ entite_id: entite.id, demandeur_id: demandeur.id, type_demande: 'nouvelle_embauche', salarie_nom: champs.nom, salarie_prenom: 'Test', ...champs.colonnes })
      .returning('id');
    if (sites.length) await trx('demandes_dpae_sites').insert(sites.map((s) => ({ demande_dpae_id: ligne.id, site_affectation_id: s.id })));
    return ligne.id;
  };

  const ids = {
    // En attente, envoyée il y a 2 h, premier jour DEMAIN, sur DEUX sites.
    d1: await demande({ nom: 'D1', sites: [s1, s2], colonnes: { statut: 'envoyee', date_creation: '2026-10-15T08:00:00Z', date_debut: '2026-10-16', type_contrat: 'cdd', motif_cdd: 'surcroit_activite', poste: 'cafetier', salarie_deja_employe: false } }),
    // En attente depuis plus de 24 h.
    d2: await demande({ nom: 'D2', demandeur: u2, sites: [s1], colonnes: { statut: 'envoyee', date_creation: '2026-10-13T09:00:00Z', date_debut: '2026-10-20', type_contrat: 'cdi', poste: 'equipier', salarie_deja_employe: true } }),
    // RETARD : validée le 06/10 pour un premier jour au 05/10 ; délai 122 h ; CDD finissant le 20/10 (<= 7 j).
    d3: await demande({ nom: 'D3', sites: [s2], colonnes: { statut: 'validee', date_creation: '2026-10-01T08:00:00Z', date_traitement: '2026-10-06T10:00:00Z', date_debut: '2026-10-05', date_fin: '2026-10-20', type_contrat: 'cdd', motif_cdd: 'remplacement_absent', poste: 'cafetier', salarie_deja_employe: false } }),
    // ANCIENNE demande sans site lié (texte libre), rejetée en 2 h ; CDD rejeté finissant le 18/10 (exclu de l'anticipation).
    d4: await demande({ nom: 'D4', demandeur: u2, colonnes: { statut: 'rejetee', hotel: 'Ancien hôtel', date_creation: '2026-10-02T08:00:00Z', date_traitement: '2026-10-02T10:00:00Z', date_debut: '2026-10-10', date_fin: '2026-10-18', type_contrat: 'cdd', motif_cdd: 'remplacement_absent', poste: 'femme_valet_chambre', salarie_deja_employe: false } }),
    // Validée à temps (4 h) ; CDD finissant le 28/10 (entre 8 et 15 j).
    d5: await demande({ nom: 'D5', sites: [s3], colonnes: { statut: 'validee', date_creation: '2026-09-20T08:00:00Z', date_traitement: '2026-09-20T12:00:00Z', date_debut: '2026-09-25', date_fin: '2026-10-28', type_contrat: 'cdd', motif_cdd: 'surcroit_activite', poste: 'equipier', salarie_deja_employe: true } }),
    // HORS période (créée le 01/08) : CDD finissant dans 2 jours, jamais compté.
    d6: await demande({ nom: 'D6', sites: [s1], colonnes: { statut: 'validee', date_creation: '2026-08-01T08:00:00Z', date_traitement: '2026-08-01T09:00:00Z', date_fin: '2026-10-17', type_contrat: 'cdd', motif_cdd: 'surcroit_activite', poste: 'cafetier' } }),
    // AUTRE ENTITÉ : ne doit apparaître nulle part.
    d7: await demande({ nom: 'D7', entite: entiteB, demandeur: uB, colonnes: { statut: 'envoyee', date_creation: '2026-10-15T08:00:00Z', date_debut: '2026-10-15', type_contrat: 'cdd', poste: 'cafetier' } }),
    // Créée le 15/09 à 22 h 30 UTC = 16/09 à 0 h 30 à PARIS : dans la période (16/09 -> 15/10), alors
    // qu'en jour UTC elle en serait exclue. Validée en 1 h.
    d8: await demande({ nom: 'D8', sites: [s1], colonnes: { statut: 'validee', date_creation: '2026-09-15T22:30:00Z', date_traitement: '2026-09-15T23:30:00Z', type_contrat: 'cdi', poste: 'gouvernant', salarie_deja_employe: false } }),
  };
  return { entiteA, entiteB, u1, u2, s1, s2, s3, ids };
}

async function executer() {
  const bd = await obtenirKnex();
  console.log('Tableau de bord DPAE — test d’intégration sur la base DEV (transaction annulée)');
  try {
    await bd.transaction(async (trx) => {
      const { entiteA, entiteB, u1, u2, s1, s2, s3, ids } = await creerJeuDeTest(trx);
      const calculer = (filtres = {}, entite = entiteA) => tableauDeBordDpaeService.calculerTableauDeBord(entite, filtres, MAINTENANT, trx);
      const idsDe = (lignes) => lignes.map((ligne) => ligne.id).sort((a, b) => a - b);

      const t = await calculer();

      verifier('Période par défaut : 30 derniers jours en heure de Paris (16/09 -> 15/10), granularité semaine', () => {
        assert.equal(t.filtres.debut, '2026-09-16');
        assert.equal(t.filtres.fin, '2026-10-15');
        assert.equal(t.granularite, 'semaine');
      });
      verifier('Priorité : en attente avec premier jour aujourd’hui ou demain -> D1 seulement (D7 d’une autre entité exclue)', () =>
        assert.deepEqual(idsDe(t.priorite.premierJourProche), [ids.d1]));
      verifier('Priorité : en attente depuis plus de 24 h -> D2 seulement (D1 envoyée il y a 2 h)', () =>
        assert.deepEqual(idsDe(t.priorite.enAttentePlus24h), [ids.d2]));
      verifier('Priorité : validée APRÈS son premier jour (retard) -> D3 seulement', () =>
        assert.deepEqual(idsDe(t.priorite.valideesEnRetard), [ids.d3]));
      verifier('Priorité : les lignes portent leurs sites (D1 : SITE DEUX, SITE UN)', () =>
        assert.deepEqual(t.priorite.premierJourProche[0].sites_affectation.map((s) => s.initiales).sort(), ['SD', 'SU']));

      verifier('Activité : 6 demandes sur la période (D6 hors période, D7 autre entité, D8 incluse grâce à l’heure de Paris)', () => {
        assert.equal(t.activite.total, 6);
        assert.deepEqual(t.activite.parStatut, { envoyee: 2, validee: 3, rejetee: 1 });
      });
      verifier('Activité : taux de rejet = rejetées / décidées = 1 / 4', () => assert.equal(t.activite.tauxRejet, 0.25));
      verifier('Activité : délai moyen 32,25 h et médian 3 h sur 4 demandes traitées (122 h, 2 h, 4 h, 1 h)', () => {
        assert.equal(t.activite.nombreTraitees, 4);
        assert.equal(t.activite.delaiMoyenHeures, 32.25);
        assert.equal(t.activite.delaiMedianHeures, 3);
      });
      verifier('Activité : évolution par semaine (lundi), semaines vides incluses', () =>
        assert.deepEqual(t.activite.evolution, [
          { periode: '2026-09-14', envoyee: 0, validee: 2, rejetee: 0 },
          { periode: '2026-09-21', envoyee: 0, validee: 0, rejetee: 0 },
          { periode: '2026-09-28', envoyee: 0, validee: 1, rejetee: 1 },
          { periode: '2026-10-05', envoyee: 0, validee: 0, rejetee: 0 },
          { periode: '2026-10-12', envoyee: 2, validee: 0, rejetee: 0 },
        ]));

      verifier('Répartition : 4 CDD / 2 CDI ; CDD : 2 remplacements, 2 surcroîts', () => {
        assert.deepEqual(t.repartition.contrats, { cdd: 4, cdi: 2 });
        assert.deepEqual(t.repartition.motifsCdd, { remplacement_absent: 2, surcroit_activite: 2 });
      });
      verifier('Répartition : top sites (une demande à plusieurs sites compte pour chacun) + 1 « Non référencé » (D4)', () => {
        assert.deepEqual(
          t.repartition.sites.map((s) => [s.id, s.nombre]),
          [
            [s1.id, 3],
            [s2.id, 2],
            [s3.id, 1],
          ],
        );
        assert.equal(t.repartition.nonReferencees, 1);
      });
      verifier('Répartition : par poste, par demandeur, nouveaux / déjà travaillé chez nous', () => {
        const postes = Object.fromEntries(t.repartition.postes.map((p) => [p.poste, p.nombre]));
        assert.deepEqual(postes, { cafetier: 2, equipier: 2, femme_valet_chambre: 1, gouvernant: 1 });
        assert.deepEqual(
          t.repartition.demandeurs.map((d) => [d.id, d.nombre]),
          [
            [u1.id, 4],
            [u2.id, 2],
          ],
        );
        assert.equal(t.repartition.nouveauxSalaries, 4);
        assert.equal(t.repartition.dejaTravailleChezNous, 2);
      });

      verifier('Anticipation : CDD finissant sous 7 j -> D3 ; sous 15 j -> D3 et D5 (D4 rejetée et D6 hors période exclues)', () => {
        assert.equal(t.anticipation.sous7Jours, 1);
        assert.equal(t.anticipation.sous15Jours, 2);
        assert.deepEqual(t.anticipation.demandes.map((d) => [d.id, d.sous_7_jours]), [
          [ids.d3, true],
          [ids.d5, false],
        ]);
      });

      const parSite = await calculer({ siteId: s1.id });
      verifier('Filtre site (SITE UN) : D1, D2, D8', () => assert.deepEqual(parSite.activite.parStatut, { envoyee: 2, validee: 1, rejetee: 0 }));
      const nonRef = await calculer({ siteId: 'non_reference' });
      verifier('Filtre « Non référencé » : D4 seule', () => assert.equal(nonRef.activite.total, 1));
      const cdi = await calculer({ typeContrat: 'cdi' });
      verifier('Filtre type de contrat (CDI) : D2 et D8', () => assert.deepEqual(cdi.repartition.contrats, { cdd: 0, cdi: 2 }));
      const rejetees = await calculer({ statut: 'rejetee' });
      verifier('Filtre statut (rejetée) : D4 seule, aucune priorité', () => {
        assert.equal(rejetees.activite.total, 1);
        assert.equal(rejetees.priorite.premierJourProche.length + rejetees.priorite.enAttentePlus24h.length, 0);
      });
      const longue = await calculer({ debut: '2026-01-01', fin: '2026-10-15' });
      verifier('Période de plus de 3 mois : évolution par mois, D6 (août) désormais comptée', () => {
        assert.equal(longue.granularite, 'mois');
        assert.equal(longue.activite.total, 7);
        assert.equal(longue.activite.evolution.length, 10);
      });
      const autreEntite = await calculer({}, entiteB);
      verifier('Périmètre par entité : l’autre entité ne voit que D7, et aucun site de la première', () => {
        assert.equal(autreEntite.activite.total, 1);
        assert.deepEqual(idsDe(autreEntite.priorite.premierJourProche), [ids.d7]);
        assert.deepEqual(autreEntite.optionsSites, []);
      });

      throw ANNULATION;
    });
  } catch (erreur) {
    if (erreur !== ANNULATION) throw erreur;
  } finally {
    await bd.destroy();
  }
  console.log(`\n${resultats.length} vérifications réussies — transaction annulée, aucune donnée conservée.`);
}

executer().catch((erreur) => {
  console.error('\nÉCHEC :', erreur.message);
  if (erreur.actual !== undefined) console.error('  obtenu :', JSON.stringify(erreur.actual), '\n  attendu :', JSON.stringify(erreur.expected));
  process.exit(1);
});
