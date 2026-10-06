import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import * as front from './statutsDpae';

// Le front garde un MIROIR des statuts et des transitions du serveur (il ne s'en sert que pour
// afficher les bons boutons) : ce test lit les DEUX modules et échoue dès qu'ils divergent. Le
// module serveur est du CommonJS sans dépendance, lu directement depuis le dépôt.
const require = createRequire(import.meta.url);
const back = require('../../../../backend/src/core/dpae/statutsDpae.js');

const cleTransition = ({ action, de, vers }) => `${action}:${de}->${vers}`;

describe('statuts et transitions DPAE : frontend = backend', () => {
  it('mêmes statuts, dans le même ordre, avec les mêmes libellés', () => {
    expect(front.STATUTS_DPAE.map(({ code, libelle }) => ({ code, libelle }))).toEqual(back.STATUTS_DPAE.map(({ code, libelle }) => ({ code, libelle })));
  });

  it('même statut initial', () => {
    expect(front.STATUT_INITIAL).toBe(back.STATUT_INITIAL);
  });

  it('mêmes statuts à décider', () => {
    expect(front.STATUTS_A_DECIDER).toEqual([...back.STATUTS_A_DECIDER]);
  });

  it('mêmes statuts d’avant la RH', () => {
    expect(front.STATUTS_AVANT_RH).toEqual([...back.STATUTS_AVANT_RH]);
  });

  it('mêmes transitions (action, statut de départ, statut d’arrivée), ni plus ni moins', () => {
    expect(front.TRANSITIONS_DPAE.map(cleTransition).sort()).toEqual(back.TRANSITIONS.map(cleTransition).sort());
  });

  it('mêmes identifiants d’action', () => {
    expect({
      mettreEnAttente: front.ACTION_METTRE_EN_ATTENTE,
      valider: front.ACTION_VALIDER,
      rejeter: front.ACTION_REJETER,
      modifier: front.ACTION_MODIFIER,
      transmettreRh: front.ACTION_TRANSMETTRE_RH,
      renvoyerInspecteur: front.ACTION_RENVOYER_INSPECTEUR,
    }).toEqual({
      mettreEnAttente: back.ACTION_METTRE_EN_ATTENTE,
      valider: back.ACTION_VALIDER,
      rejeter: back.ACTION_REJETER,
      modifier: back.ACTION_MODIFIER,
      transmettreRh: back.ACTION_TRANSMETTRE_RH,
      renvoyerInspecteur: back.ACTION_RENVOYER_INSPECTEUR,
    });
  });
});
