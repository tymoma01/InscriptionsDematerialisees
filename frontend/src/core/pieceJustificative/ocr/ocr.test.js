import { describe, expect, it } from 'vitest';
import { grisContraste } from './ocr';

describe('grisContraste', () => {
  it('passe en niveaux de gris et étire le contraste autour du gris moyen, sans dépasser 0–255', () => {
    const pixels = new Uint8ClampedArray([255, 0, 0, 255, 128, 128, 128, 255, 20, 20, 20, 255, 250, 250, 250, 255]);
    grisContraste(pixels);
    // Rouge pur : gris 76,2, contrasté à 55,5, arrondi à 56.
    expect([...pixels.slice(0, 4)]).toEqual([56, 56, 56, 255]);
    expect([...pixels.slice(4, 7)]).toEqual([128, 128, 128]);
    expect(pixels[8]).toBe(0);
    expect(pixels[12]).toBe(255);
  });
});
