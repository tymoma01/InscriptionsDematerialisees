import { describe, expect, it } from 'vitest';
import {
  ACTION_METTRE_EN_ATTENTE,
  ACTION_MODIFIER,
  ACTION_REJETER,
  ACTION_RENVOYER_INSPECTEUR,
  ACTION_TRANSMETTRE_RH,
  ACTION_VALIDER,
  STATUTS_A_DECIDER,
  STATUTS_AVANT_RH,
  STATUTS_DPAE,
  STATUT_INITIAL,
  statutsVisibles,
  transitionPossible,
} from './statutsDpae';

describe('statutsDpae (miroir du serveur)', () => {
  it('statut initial « À traiter » (code envoyee), précédé des deux statuts du Planning', () => {
    expect(STATUT_INITIAL).toBe('envoyee');
    expect(STATUTS_DPAE.map((statut) => statut.code)).toEqual([
      'a_valider_planning',
      'renvoyee_inspecteur',
      'envoyee',
      'en_attente',
      'validee',
      'rejetee',
    ]);
  });

  it('statuts à décider déduits des transitions : les deux statuts du Planning, À traiter et En attente', () => {
    expect(STATUTS_A_DECIDER).toEqual(['a_valider_planning', 'renvoyee_inspecteur', 'envoyee', 'en_attente']);
  });

  it('le Planning transmet ou renvoie depuis « À valider par le Planning » seulement, et ne rejette pas', () => {
    expect(transitionPossible(ACTION_TRANSMETTRE_RH, 'a_valider_planning')).toBe(true);
    expect(transitionPossible(ACTION_RENVOYER_INSPECTEUR, 'a_valider_planning')).toBe(true);
    for (const statut of ['renvoyee_inspecteur', 'envoyee', 'en_attente', 'validee', 'rejetee']) {
      expect(transitionPossible(ACTION_TRANSMETTRE_RH, statut)).toBe(false);
      expect(transitionPossible(ACTION_RENVOYER_INSPECTEUR, statut)).toBe(false);
    }
    for (const statut of STATUTS_AVANT_RH) {
      for (const action of [ACTION_VALIDER, ACTION_REJETER, ACTION_METTRE_EN_ATTENTE]) {
        expect(transitionPossible(action, statut)).toBe(false);
      }
    }
  });

  it('la RH ne se voit proposer aucun statut d’avant l’envoi à la RH', () => {
    expect(statutsVisibles(false).map((statut) => statut.code)).toEqual(['envoyee', 'en_attente', 'validee', 'rejetee']);
    expect(statutsVisibles(true)).toBe(STATUTS_DPAE);
  });

  it('mise en attente possible uniquement depuis À traiter ; valider et rejeter depuis À traiter et En attente', () => {
    expect(transitionPossible(ACTION_METTRE_EN_ATTENTE, 'envoyee')).toBe(true);
    expect(transitionPossible(ACTION_METTRE_EN_ATTENTE, 'en_attente')).toBe(false);
    for (const action of [ACTION_VALIDER, ACTION_REJETER]) {
      expect(transitionPossible(action, 'envoyee')).toBe(true);
      expect(transitionPossible(action, 'en_attente')).toBe(true);
    }
  });

  it('modification possible depuis tout statut non décidé, pas depuis un statut final', () => {
    for (const statut of STATUTS_A_DECIDER) expect(transitionPossible(ACTION_MODIFIER, statut)).toBe(true);
    expect(transitionPossible(ACTION_MODIFIER, 'validee')).toBe(false);
    expect(transitionPossible(ACTION_MODIFIER, 'rejetee')).toBe(false);
  });

  it('aucune transition de validation, rejet ou mise en attente depuis un statut final', () => {
    for (const statut of ['validee', 'rejetee']) {
      for (const action of [ACTION_VALIDER, ACTION_REJETER, ACTION_METTRE_EN_ATTENTE]) {
        expect(transitionPossible(action, statut)).toBe(false);
      }
    }
  });
});
