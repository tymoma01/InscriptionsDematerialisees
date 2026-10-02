// Indicateurs cliquables du Tableau de bord DPAE : pour CHAQUE type d'indicateur, le nombre de
// demandes listées au clic est exactement le nombre affiché par l'indicateur.
import { describe, expect, test } from 'vitest';
import { demandesDeLIndicateur, indicateursCliquables, listeComplete } from './indicateursTableauDeBordDpae.js';

// Liste complète des demandes de l'entité (GET /dpae/suivi), plus large que la période filtrée.
const DEMANDES = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, statut: 'envoyee', salarie_nom: `NOM${i + 1}` }));

// Réponse de GET /dpae/tableau-de-bord (forme de tableauDeBordDpaeService.construireTableauDeBord) :
// période filtrée = demandes 1 à 8 ; 9 à 12 hors période, jamais listées.
const TABLEAU = {
  granularite: 'semaine',
  activite: {
    total: 8,
    ids: [1, 2, 3, 4, 5, 6, 7, 8],
    parStatut: { envoyee: 3, en_attente: 1, validee: 3, rejetee: 1 },
    idsParStatut: { envoyee: [1, 2, 8], en_attente: [7], validee: [3, 4, 5], rejetee: [6] },
    evolution: [
      { periode: '2026-09-21', envoyee: 0, en_attente: 0, validee: 2, rejetee: 1, ids_envoyee: [], ids_en_attente: [], ids_validee: [3, 4], ids_rejetee: [6] },
      { periode: '2026-09-28', envoyee: 3, en_attente: 1, validee: 1, rejetee: 0, ids_envoyee: [1, 2, 8], ids_en_attente: [7], ids_validee: [5], ids_rejetee: [] },
    ],
  },
  declarationsTardives: { nombre: 1, demandes: [{ id: 4, retard_jours: 2 }] },
  repartition: {
    contrats: { cdd: 5, cdi: 2, non_renseigne: 1 },
    idsContrats: { cdd: [1, 2, 3, 4, 6], cdi: [5, 7], non_renseigne: [8] },
    motifsCdd: { remplacement_absent: 3, surcroit_activite: 2 },
    idsMotifsCdd: { remplacement_absent: [1, 3, 6], surcroit_activite: [2, 4] },
    sites: [
      { id: 51, nom: 'CADRAN', initiales: 'CAD', nombre: 6, ids: [1, 2, 3, 4, 5, 6] },
      { id: 52, nom: 'AIGLON', initiales: 'AIG', nombre: 2, ids: [1, 7] },
    ],
    nonReferencees: 1,
    idsNonReferencees: [8],
    postes: [
      { poste: 'cafetier', nombre: 5, ids: [1, 2, 3, 4, 5] },
      { poste: null, nombre: 3, ids: [6, 7, 8] },
    ],
    demandeurs: [
      { id: 9, prenom: 'Thomas', nom: 'Yamini', nombre: 6, ids: [1, 2, 3, 4, 5, 6] },
      { id: 4, prenom: 'Admin', nom: 'Test', nombre: 2, ids: [7, 8] },
    ],
    nouveauxSalaries: 5,
    idsNouveauxSalaries: [1, 2, 3, 5, 8],
    dejaTravailleChezNous: 3,
    idsDejaTravailleChezNous: [4, 6, 7],
  },
};

const indicateurs = indicateursCliquables(TABLEAU);
const parType = (prefixe) => [...indicateurs.values()].filter((indicateur) => indicateur.cle === prefixe || indicateur.cle.startsWith(`${prefixe}:`));

describe('Nombre de demandes listées = nombre affiché, pour chaque type d’indicateur', () => {
  for (const [type, attendus] of [
    ['total', 1],
    ['statut', 4],
    ['evolution', 8],
    ['tardives', 1],
    ['contrat', 3],
    ['motif', 3],
    ['emploi', 2],
    ['site', 3],
    ['poste', 2],
    ['demandeur', 2],
  ]) {
    test(type, () => {
      const liste = parType(type);
      expect(liste).toHaveLength(attendus);
      for (const indicateur of liste) {
        const demandes = demandesDeLIndicateur(indicateur, DEMANDES);
        expect(demandes.length, indicateur.cle).toBe(indicateur.nombre);
        expect(demandes.map((d) => d.id).sort((a, b) => a - b), indicateur.cle).toStrictEqual([...indicateur.ids].sort((a, b) => a - b));
        expect(listeComplete(indicateur, DEMANDES)).toBe(true);
      }
    });
  }
});

describe('Indicateurs cliquables', () => {
  test('libellés du titre « Demandes concernées : … »', () => {
    expect(indicateurs.get('site:51').libelle).toBe('site CADRAN (CAD)');
    expect(indicateurs.get('site:non_reference').libelle).toBe('site non référencé');
    expect(indicateurs.get('statut:en_attente').libelle).toBe('statut En attente');
    expect(indicateurs.get('evolution:2026-09-28:envoyee').libelle).toBe('À traiter, sem. du 28/09');
    expect(indicateurs.get('contrat:non_renseigne').libelle).toBe('contrat non renseigné');
    expect(indicateurs.get('motif:surcroit_activite').libelle).toBe('raison Surcroît d’activité');
    expect(indicateurs.get('poste:cafetier').libelle).toBe('poste Cafetier');
    expect(indicateurs.get('poste:non_renseigne').libelle).toBe('poste Non renseigné');
    expect(indicateurs.get('demandeur:9').libelle).toBe('demandeur Thomas Yamini');
    expect(indicateurs.get('emploi:deja').libelle).toBe('déjà travaillé chez nous');
  });

  test('taux de rejet, délais et part : jamais cliquables (aucune liste de demandes)', () => {
    for (const cle of indicateurs.keys()) expect(cle).not.toMatch(/taux|delai|part/);
  });

  test('demandes hors période (9 à 12) jamais listées ; indicateur à zéro : liste vide', () => {
    const toutes = demandesDeLIndicateur(indicateurs.get('total'), DEMANDES);
    expect(toutes.map((d) => d.id)).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(demandesDeLIndicateur(indicateurs.get('motif:non_renseigne'), DEMANDES)).toStrictEqual([]);
    expect(indicateurs.get('motif:non_renseigne').nombre).toBe(0);
  });

  test('liste incomplète (demande créée entre les deux chargements) : détectée, pour recharger', () => {
    expect(listeComplete(indicateurs.get('total'), DEMANDES.slice(0, 5))).toBe(false);
  });

  test('sans données : aucun indicateur', () => {
    expect(indicateursCliquables(null).size).toBe(0);
  });
});
