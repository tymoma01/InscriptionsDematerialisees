import { describe, expect, it } from 'vitest';
import {
  ACTION_METTRE_EN_ATTENTE,
  ACTION_MODIFIER,
  ACTION_REJETER,
  ACTION_VALIDER,
  STATUTS_A_DECIDER,
  STATUTS_DPAE,
  STATUT_INITIAL,
  transitionPossible,
} from './statutsDpae';

describe('statutsDpae (miroir du serveur)', () => {
  it('statut initial « À traiter » (code envoyee), premier de la liste', () => {
    expect(STATUT_INITIAL).toBe('envoyee');
    expect(STATUTS_DPAE[0].code).toBe(STATUT_INITIAL);
  });

  it('statuts à décider déduits des transitions : À traiter et En attente', () => {
    expect(STATUTS_A_DECIDER).toEqual(['envoyee', 'en_attente']);
  });

  it('mise en attente possible uniquement depuis À traiter ; valider et rejeter depuis À traiter et En attente', () => {
    expect(transitionPossible(ACTION_METTRE_EN_ATTENTE, 'envoyee')).toBe(true);
    expect(transitionPossible(ACTION_METTRE_EN_ATTENTE, 'en_attente')).toBe(false);
    for (const action of [ACTION_VALIDER, ACTION_REJETER]) {
      expect(transitionPossible(action, 'envoyee')).toBe(true);
      expect(transitionPossible(action, 'en_attente')).toBe(true);
    }
  });

  it('modification possible depuis À traiter et En attente (statuts de la demande non traitée), pas depuis un statut final', () => {
    expect(transitionPossible(ACTION_MODIFIER, 'envoyee')).toBe(true);
    expect(transitionPossible(ACTION_MODIFIER, 'en_attente')).toBe(true);
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
