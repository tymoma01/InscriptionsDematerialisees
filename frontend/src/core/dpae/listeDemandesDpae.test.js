// Recherche, filtres par colonne et tri des listes de demandes DPAE (listeDemandesDpae.js).
import { describe, expect, test } from 'vitest';
import {
  VALEUR_NON_RENSEIGNEE,
  appliquerRechercheFiltresTri,
  filtreEstActif,
  filtrerParColonnes,
  rechercherDemandes,
  trierDemandes,
  valeursPresentes,
} from './listeDemandesDpae.js';
import { trierParEcheance } from './urgenceDpae.js';

// Premier jour tel que l'API le renvoie : minuit local sérialisé en ISO.
const jour = (annee, mois, numero) => new Date(annee, mois - 1, numero).toISOString();
const instant = (annee, mois, numero, heure = 10) => new Date(annee, mois - 1, numero, heure).toISOString();

const DEMANDES = [
  {
    id: 35,
    statut: 'envoyee',
    type_demande: 'prolongation',
    type_contrat: 'cdd',
    salarie_prenom: 'Élodie',
    salarie_nom: 'DANGWA',
    demandeur_prenom: 'Thomas',
    demandeur_nom: 'Yamini',
    date_creation: instant(2026, 9, 30),
    date_debut: jour(2026, 10, 10),
    sites_affectation: [
      { id: 1, nom: 'NOVOTEL PARIS GARE DE LYON', initiales: 'NGL' },
      { id: 2, nom: 'MERCURE PORTE DE VERSAILLES EXPO', initiales: 'MPV' },
    ],
  },
  {
    id: 36,
    statut: 'validee',
    type_demande: 'passage_cdi',
    type_contrat: 'cdi',
    salarie_prenom: 'Jules',
    salarie_nom: 'Lefèvre',
    demandeur_prenom: 'Anne-Sophie',
    demandeur_nom: 'Durand',
    date_creation: instant(2026, 10, 1),
    date_debut: jour(2026, 10, 5),
    sites_affectation: [{ id: 3, nom: 'HÔTEL DU CADRAN', initiales: 'CAD' }],
  },
  {
    id: 37,
    statut: 'en_attente',
    type_demande: 'nouvelle_embauche',
    type_contrat: null,
    salarie_prenom: 'Inès',
    salarie_nom: 'Martin',
    demandeur_prenom: 'Thomas',
    demandeur_nom: 'Yamini',
    date_creation: instant(2026, 10, 2),
    date_debut: null,
    sites_affectation: [],
    hotel: 'Hôtel du Parc',
  },
  {
    id: 135,
    statut: 'envoyee',
    type_demande: 'nouvelle_embauche',
    type_contrat: 'cdd',
    salarie_prenom: 'Hugo',
    salarie_nom: 'Bernard',
    demandeur_prenom: 'Anne-Sophie',
    demandeur_nom: 'Durand',
    date_creation: instant(2026, 9, 28),
    date_debut: jour(2026, 10, 3),
    heure_arrivee_j1: '08:00:00',
    sites_affectation: [{ id: 1, nom: 'NOVOTEL PARIS GARE DE LYON', initiales: 'NGL' }],
  },
];
const ids = (liste) => liste.map((demande) => demande.id);

describe('Recherche', () => {
  test('insensible aux accents et à la casse, dans les deux sens', () => {
    expect(ids(rechercherDemandes(DEMANDES, 'elodie'))).toStrictEqual([35]);
    expect(ids(rechercherDemandes(DEMANDES, 'ÉLODIE'))).toStrictEqual([35]);
    expect(ids(rechercherDemandes(DEMANDES, 'lefevre'))).toStrictEqual([36]);
    expect(ids(rechercherDemandes(DEMANDES, 'LEFÈVRE'))).toStrictEqual([36]);
    expect(ids(rechercherDemandes(DEMANDES, 'ines'))).toStrictEqual([37]);
  });

  test('sites : nom, code, ancien texte libre (accents compris)', () => {
    expect(ids(rechercherDemandes(DEMANDES, 'novotel'))).toStrictEqual([35, 135]);
    expect(ids(rechercherDemandes(DEMANDES, 'mpv'))).toStrictEqual([35]);
    expect(ids(rechercherDemandes(DEMANDES, 'hotel du cadran'))).toStrictEqual([36]);
    expect(ids(rechercherDemandes(DEMANDES, 'HOTEL DU PARC'))).toStrictEqual([37]);
  });

  test('demandeur, type de contrat, type de demande', () => {
    expect(ids(rechercherDemandes(DEMANDES, 'anne-sophie'))).toStrictEqual([36, 135]);
    expect(ids(rechercherDemandes(DEMANDES, 'CDI'))).toStrictEqual([36]);
    expect(ids(rechercherDemandes(DEMANDES, 'prolongation'))).toStrictEqual([35]);
    expect(ids(rechercherDemandes(DEMANDES, 'passage cdi'))).toStrictEqual([36]);
  });

  test('plusieurs mots : chacun doit se retrouver dans la demande, champs différents admis', () => {
    expect(ids(rechercherDemandes(DEMANDES, 'thomas cdd'))).toStrictEqual([35]);
    expect(ids(rechercherDemandes(DEMANDES, 'durand novotel'))).toStrictEqual([135]);
    expect(ids(rechercherDemandes(DEMANDES, 'thomas cdi'))).toStrictEqual([]);
  });

  test('n° de demande exact (« 35 », « n°35 », « n° 35 », « #35 ») ; jamais un n° qui le contient', () => {
    for (const saisie of ['35', 'n°35', 'N° 35', '#35']) {
      expect(ids(rechercherDemandes(DEMANDES, saisie)), saisie).toStrictEqual([35]);
    }
    expect(ids(rechercherDemandes(DEMANDES, '135'))).toStrictEqual([135]);
  });

  test('saisie vide ou faite d’espaces : liste inchangée', () => {
    expect(rechercherDemandes(DEMANDES, '   ')).toBe(DEMANDES);
  });
});

describe('Filtres par colonne', () => {
  test('période : bornes incluses, sans premier jour exclu dès qu’un filtre est posé', () => {
    expect(ids(filtrerParColonnes(DEMANDES, { premier_jour: { du: '2026-10-05', au: '2026-10-10' } }))).toStrictEqual([35, 36]);
    expect(ids(filtrerParColonnes(DEMANDES, { premier_jour: { au: '2026-10-04' } }))).toStrictEqual([135]);
    expect(ids(filtrerParColonnes(DEMANDES, { date_demande: { du: '2026-10-01' } }))).toStrictEqual([36, 37]);
  });

  test('cases à cocher : valeurs retenues ; une demande à plusieurs sites est retenue si l’un l’est', () => {
    expect(ids(filtrerParColonnes(DEMANDES, { sites: { valeurs: ['MERCURE PORTE DE VERSAILLES EXPO (MPV)'] } }))).toStrictEqual([35]);
    expect(ids(filtrerParColonnes(DEMANDES, { type_contrat: { valeurs: [VALEUR_NON_RENSEIGNEE] } }))).toStrictEqual([37]);
    expect(ids(filtrerParColonnes(DEMANDES, { statut: { valeurs: ['À traiter', 'En attente'] } }))).toStrictEqual([35, 37, 135]);
    expect(ids(filtrerParColonnes(DEMANDES, { demandeur: { valeurs: [] } }))).toStrictEqual([]);
  });

  test('texte (salarié) : accents, casse, prénom et nom dans n’importe quel ordre', () => {
    expect(ids(filtrerParColonnes(DEMANDES, { salarie: { texte: 'LEFEVRE jul' } }))).toStrictEqual([36]);
  });

  test('filtre inactif (période vide, texte vide, pas de sélection) : sans effet', () => {
    expect(filtreEstActif('premier_jour', { du: '', au: '' })).toBe(false);
    expect(filtreEstActif('salarie', { texte: '  ' })).toBe(false);
    expect(filtreEstActif('sites', {})).toBe(false);
    expect(filtrerParColonnes(DEMANDES, { salarie: { texte: '' } })).toBe(DEMANDES);
  });

  test('valeurs présentes : triées, « Non renseigné » en dernier, statuts dans l’ordre du cycle de vie', () => {
    expect(valeursPresentes(DEMANDES, 'type_contrat')).toStrictEqual(['CDD', 'CDI', VALEUR_NON_RENSEIGNEE]);
    expect(valeursPresentes(DEMANDES, 'statut')).toStrictEqual(['À traiter', 'En attente', 'Validée']);
    expect(valeursPresentes(DEMANDES, 'sites')).toStrictEqual([
      'HÔTEL DU CADRAN (CAD)',
      'Hôtel du Parc',
      'MERCURE PORTE DE VERSAILLES EXPO (MPV)',
      'NOVOTEL PARIS GARE DE LYON (NGL)',
    ]);
  });
});

describe('Combinaison recherche + filtres + tri', () => {
  test('recherche ET filtres de plusieurs colonnes se combinent', () => {
    const resultat = appliquerRechercheFiltresTri(DEMANDES, {
      recherche: 'novotel',
      filtres: { statut: { valeurs: ['À traiter'] }, premier_jour: { du: '2026-10-04' } },
    });
    expect(ids(resultat)).toStrictEqual([35]);
  });

  test('sans tri de colonne : le tri par défaut de la page (liste RH : échéance croissante) s’applique au résultat filtré', () => {
    const resultat = appliquerRechercheFiltresTri(DEMANDES, {
      filtres: { type_contrat: { valeurs: ['CDD', VALEUR_NON_RENSEIGNEE] } },
      triParDefaut: trierParEcheance,
    });
    // 135 (03/10) puis 35 (10/10), sans premier jour (37) en fin.
    expect(ids(resultat)).toStrictEqual([135, 35, 37]);
  });

  test('tri de colonne choisi : remplace le tri par défaut ; sans valeur toujours en fin, dans les deux sens', () => {
    const options = { filtres: { statut: { valeurs: ['À traiter', 'En attente', 'Validée'] } }, triParDefaut: trierParEcheance };
    expect(ids(appliquerRechercheFiltresTri(DEMANDES, { ...options, tri: { cle: 'premier_jour', sens: 'desc' } }))).toStrictEqual([35, 36, 135, 37]);
    expect(ids(appliquerRechercheFiltresTri(DEMANDES, { ...options, tri: { cle: 'salarie', sens: 'asc' } }))).toStrictEqual([135, 35, 36, 37]);
    expect(ids(appliquerRechercheFiltresTri(DEMANDES, { ...options, tri: { cle: 'statut', sens: 'asc' } }))).toStrictEqual([35, 135, 37, 36]);
  });

  test('tri stable et sans effet de bord sur la liste reçue', () => {
    const copie = [...DEMANDES];
    trierDemandes(DEMANDES, { cle: 'demandeur', sens: 'asc' });
    expect(DEMANDES).toStrictEqual(copie);
    expect(ids(trierDemandes(DEMANDES, { cle: 'demandeur', sens: 'asc' }))).toStrictEqual([36, 135, 35, 37]);
  });
});
