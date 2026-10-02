import { expect, test, vi } from 'vitest';
import { grouperChiffres, propsChampNumeriqueMasque } from './masqueNumerique';

test('groupe les chiffres selon les tailles données', () => {
  expect(grouperChiffres('123456789012345', [1, 2, 2, 2, 3, 3, 2])).toBe('1 23 45 67 890 123 45');
  expect(grouperChiffres('0612', [2, 2, 2, 2, 2])).toBe('06 12');
  expect(grouperChiffres('', [2, 2])).toBe('');
});

test('la saisie ne garde que les chiffres, dans la limite de longueur', () => {
  const onChangerValeur = vi.fn();
  const props = propsChampNumeriqueMasque({ valeurCourante: '06', tailles: [2, 2, 2, 2, 2], longueurChiffresMax: 10, onChangerValeur });
  expect(props.value).toBe('06');
  props.onChange({ target: { value: '06 12-ab 34 56 78 99' } });
  expect(onChangerValeur).toHaveBeenCalledWith('0612345678');
});
