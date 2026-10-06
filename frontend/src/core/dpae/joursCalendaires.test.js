import { describe, expect, it } from 'vitest';
import { libelleNombreJours, nombreJoursCalendaires } from './joursCalendaires';

describe('nombreJoursCalendaires (jours inclus)', () => {
  it('du 08/10 au 15/10 = 8 jours ; même jour = 1', () => {
    expect(nombreJoursCalendaires('2026-10-08', '2026-10-15')).toBe(8);
    expect(nombreJoursCalendaires('2026-10-08', '2026-10-08')).toBe(1);
    expect(nombreJoursCalendaires('2026-10-08', '2026-10-09')).toBe(2);
  });

  it('mois et années différents', () => {
    expect(nombreJoursCalendaires('2026-01-31', '2026-02-01')).toBe(2);
    expect(nombreJoursCalendaires('2026-01-01', '2026-12-31')).toBe(365);
    expect(nombreJoursCalendaires('2026-12-30', '2027-01-02')).toBe(4);
  });

  it('années bissextiles : 2028 compte le 29 février, 2026 non', () => {
    expect(nombreJoursCalendaires('2028-02-28', '2028-03-01')).toBe(3);
    expect(nombreJoursCalendaires('2026-02-28', '2026-03-01')).toBe(2);
    expect(nombreJoursCalendaires('2028-01-01', '2028-12-31')).toBe(366);
  });

  it('passage à l’heure d’hiver (25/10/2026) et d’été (29/03/2026) : jamais un jour de trop ou de moins', () => {
    expect(nombreJoursCalendaires('2026-10-24', '2026-10-26')).toBe(3);
    expect(nombreJoursCalendaires('2026-10-25', '2026-10-25')).toBe(1);
    expect(nombreJoursCalendaires('2026-03-28', '2026-03-30')).toBe(3);
    // Colonnes `date` de l'API : minuit local sérialisé, relu dans le fuseau du poste.
    expect(nombreJoursCalendaires(new Date(2026, 9, 24).toISOString(), new Date(2026, 9, 26).toISOString())).toBe(3);
    expect(nombreJoursCalendaires(new Date(2026, 9, 25).toISOString(), new Date(2026, 9, 26).toISOString())).toBe(2);
    expect(nombreJoursCalendaires(new Date(2026, 2, 28).toISOString(), new Date(2026, 2, 30).toISOString())).toBe(3);
  });

  it('dates absentes, invalides ou dernier jour antérieur : null', () => {
    expect(nombreJoursCalendaires('2026-10-08', null)).toBeNull();
    expect(nombreJoursCalendaires('', '2026-10-08')).toBeNull();
    expect(nombreJoursCalendaires('n’importe quoi', '2026-10-08')).toBeNull();
    expect(nombreJoursCalendaires('2026-10-15', '2026-10-08')).toBeNull();
  });

  it('libellé : « 1 jour », « 8 jours »', () => {
    expect(libelleNombreJours(1)).toBe('1 jour');
    expect(libelleNombreJours(8)).toBe('8 jours');
  });
});
