import { describe, expect, it } from 'vitest';
import { formatCadre, fractionCadre, zoneSurImage } from './cadre';

const rect = (left, top, width, height) => ({ left, top, width, height });

describe('formatCadre', () => {
  it('cartes en paysage, papiers en portrait, pas de cadre pour la photo d’identité', () => {
    expect(formatCadre('carte_identite')).toBe('paysage');
    expect(formatCadre('carte_identite_verso')).toBe('paysage');
    expect(formatCadre('carte_vitale')).toBe('paysage');
    expect(formatCadre('rib')).toBe('portrait');
    expect(formatCadre('justificatif_domicile')).toBe('portrait');
    expect(formatCadre('photo_identite')).toBeNull();
  });
});

describe('fractionCadre', () => {
  it('situe le cadre sur la vidéo affichée en « contain », bandes noires comprises', () => {
    // Viseur 1000 × 500, vidéo 16:9 : affichée sur 888,9 × 500, centrée (bandes de 55,6 px).
    const video = rect(0, 0, 1000, 500);
    const cadre = rect(100, 50, 800, 400);
    const fraction = fractionCadre(cadre, video, 16 / 9);
    expect(fraction.x).toBeCloseTo((100 - 55.56) / 888.89, 3);
    expect(fraction.y).toBeCloseTo(0.1, 3);
    expect(fraction.largeur).toBeCloseTo(800 / 888.89, 3);
    expect(fraction.hauteur).toBeCloseTo(0.8, 3);
  });

  it('borne le cadre à l’image quand il déborde sur les bandes noires', () => {
    const fraction = fractionCadre(rect(0, 0, 1000, 500), rect(0, 0, 1000, 500), 16 / 9);
    expect(fraction).toEqual({ x: 0, y: 0, largeur: 1, hauteur: 1 });
  });
});

describe('zoneSurImage', () => {
  const fraction = { x: 0.1, y: 0.2, largeur: 0.8, hauteur: 0.6 };

  it('reporte le cadre sur une image au format de la vidéo', () => {
    expect(zoneSurImage(fraction, 16 / 9, 1920, 1080)).toEqual({ x: 192, y: 216, largeur: 1536, hauteur: 648 });
  });

  it('photo 4:3 d’une vidéo 16:9 : la vidéo en est la bande centrale', () => {
    // 4000 × 3000 : partie visible 4000 × 2250, à partir de y = 375.
    expect(zoneSurImage(fraction, 16 / 9, 4000, 3000)).toEqual({ x: 400, y: 825, largeur: 3200, hauteur: 1350 });
  });
});
