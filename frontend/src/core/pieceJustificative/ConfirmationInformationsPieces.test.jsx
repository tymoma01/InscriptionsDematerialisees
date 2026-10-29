import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ConfirmationPieceIdentite from './ConfirmationPieceIdentite';
import ConfirmationRib from './ConfirmationRib';
import { lireMrz, lireRib, lireVerso } from './ocr/ocr';
import { confirmerPieceIdentite, confirmerRib } from '../../services/informationsPiecesService';

// L'OCR lui-même (tesseract.js) est testé sur ses analyses (ocr/*.test.js) : ici, seulement ce que
// l'écran fait d'une lecture.
vi.mock('./ocr/ocr', () => ({ lireMrz: vi.fn(), lireVerso: vi.fn(), lireRib: vi.fn() }));
vi.mock('../../services/informationsPiecesService', () => ({ confirmerPieceIdentite: vi.fn(), confirmerRib: vi.fn() }));

beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

// Comme CaptureTablette : la valeur confirmée renvoyée par le serveur devient la valeur enregistrée.
function PieceAvecParent({ onConfirmee, ...props }) {
  const [enregistree, setEnregistree] = useState(null);
  return (
    <ConfirmationPieceIdentite
      {...props}
      enregistree={enregistree}
      onConfirmee={(piece) => {
        setEnregistree(piece);
        onConfirmee(piece);
      }}
    />
  );
}

function RibAvecParent(props) {
  const [enregistre, setEnregistre] = useState(null);
  return <ConfirmationRib {...props} enregistre={enregistre} onConfirme={setEnregistre} />;
}

const photo = (verso = false) => ({ fichier: new Blob(['x'], { type: 'image/jpeg' }), verso, n: 1 });
const CANDIDAT = { nom: 'MARTIN', nomNaissance: null, dateNaissance: '1990-05-12' };
const MRZ = { type: 'carte_identite', numero: 'X4RTBPFW4', naissance: '1990-05-12', expire_le: '2031-06-30', nom: 'MARTIN', prenoms: 'PAUL' };

test('pièce d’identité : la bande lue pré-remplit les champs, enregistrés seulement à la confirmation', async () => {
  lireMrz.mockResolvedValue(MRZ);
  confirmerPieceIdentite.mockImplementation(async (_id, piece) => piece);
  const onConfirmee = vi.fn();
  render(<PieceAvecParent dossierId={7} candidat={CANDIDAT} photo={photo()} modifiable onConfirmee={onConfirmee} />);

  expect(await screen.findByDisplayValue('X4RTBPFW4')).toBeTruthy();
  expect(screen.getByDisplayValue('2031-06-30')).toBeTruthy();
  expect(screen.queryByText(/ne correspond pas/)).toBeNull();
  expect(confirmerPieceIdentite).not.toHaveBeenCalled();

  fireEvent.click(screen.getByText('Confirmer ces informations'));
  expect(await screen.findByText(/Informations confirmées/)).toBeTruthy();
  expect(confirmerPieceIdentite).toHaveBeenCalledWith(7, { type: 'carte_identite', numero: 'X4RTBPFW4', delivreeLe: null, expireLe: '2031-06-30' });
  expect(onConfirmee).toHaveBeenCalled();
});

test('pièce d’identité : nom et date de naissance différents du formulaire -> avertissement, sans bloquer', async () => {
  lireMrz.mockResolvedValue({ ...MRZ, nom: 'DURAND', naissance: '1991-01-01' });
  render(<ConfirmationPieceIdentite dossierId={7} candidat={CANDIDAT} enregistree={null} photo={photo()} modifiable onConfirmee={() => {}} />);

  expect(await screen.findByText(/le nom et la date de naissance de la pièce ne correspond pas/)).toBeTruthy();
  expect(screen.getByText('Confirmer ces informations').disabled).toBe(false);
});

test('pièce d’identité : verso de l’ancienne carte lu par ses dates, sans chercher de bande', async () => {
  lireVerso.mockResolvedValue({ expire_le: '2033-03-14', delivree_le: '2018-03-15' });
  render(<ConfirmationPieceIdentite dossierId={7} candidat={CANDIDAT} enregistree={null} photo={photo(true)} modifiable onConfirmee={() => {}} />);

  expect(await screen.findByDisplayValue('2018-03-15')).toBeTruthy();
  expect(lireMrz).not.toHaveBeenCalled();
});

test('pièce d’identité : photo illisible -> saisie manuelle, champs obligatoires vérifiés avant envoi', async () => {
  lireMrz.mockResolvedValue(null);
  render(<ConfirmationPieceIdentite dossierId={7} candidat={CANDIDAT} enregistree={null} photo={photo()} modifiable onConfirmee={() => {}} />);

  expect(await screen.findByText(/introuvable sur cette photo/)).toBeTruthy();
  fireEvent.click(screen.getByText('Confirmer ces informations'));
  expect(screen.getByText('Choisissez le type de pièce.')).toBeTruthy();
  expect(confirmerPieceIdentite).not.toHaveBeenCalled();
});

test('RIB : IBAN lu affiché par blocs de 4, banque déduite, enregistré compacté à la confirmation', async () => {
  lireRib.mockResolvedValue({ iban: 'FR7630006000011234567890189', bic: 'AGRIFRPP882' });
  confirmerRib.mockImplementation(async (_id, rib) => rib);
  render(<RibAvecParent dossierId={7} photo={photo()} modifiable />);

  expect(await screen.findByDisplayValue('FR76 3000 6000 0112 3456 7890 189')).toBeTruthy();
  expect(screen.getByText('Crédit Agricole S.A.')).toBeTruthy();
  fireEvent.click(screen.getByText('Confirmer ces informations'));
  expect(await screen.findByText(/Coordonnées bancaires confirmées/)).toBeTruthy();
  expect(confirmerRib).toHaveBeenCalledWith(7, { iban: 'FR7630006000011234567890189', bic: 'AGRIFRPP882' });
});

test('RIB : IBAN corrigé à la main avec une clé fausse -> refusé avant envoi', async () => {
  lireRib.mockResolvedValue({ iban: null, bic: null });
  render(<ConfirmationRib dossierId={7} enregistre={null} photo={photo()} modifiable onConfirme={() => {}} />);

  expect(await screen.findByText(/IBAN non lu automatiquement/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('IBAN'), { target: { value: 'FR76 3000 6000 0112 3456 7890 188' } });
  fireEvent.change(screen.getByLabelText('BIC'), { target: { value: 'AGRIFRPP882' } });
  fireEvent.click(screen.getByText('Confirmer ces informations'));
  expect(screen.getByText(/IBAN invalide/)).toBeTruthy();
  expect(confirmerRib).not.toHaveBeenCalled();
});

test('RIB déjà confirmé, sans droit de modification : lecture seule', () => {
  render(<ConfirmationRib dossierId={7} enregistre={{ iban: 'FR7630006000011234567890189', bic: 'AGRIFRPP882' }} photo={null} modifiable={false} onConfirme={() => {}} />);

  expect(screen.getByText(/Coordonnées bancaires confirmées/)).toBeTruthy();
  expect(screen.getByLabelText('IBAN').matches(':disabled')).toBe(true);
  expect(lireRib).not.toHaveBeenCalled();
});

// État remonté à CaptureTablette, qui en fait une condition de « Valider et planifier un test ».
test('RIB confirmé puis corrigé à la main : l’état repasse « à confirmer »', async () => {
  const onEtatConfirmation = vi.fn();
  render(
    <ConfirmationRib
      dossierId={7}
      enregistre={{ iban: 'FR7630006000011234567890189', bic: 'AGRIFRPP882' }}
      photo={null}
      modifiable
      onConfirme={() => {}}
      onEtatConfirmation={onEtatConfirmation}
    />,
  );
  expect(onEtatConfirmation).toHaveBeenLastCalledWith(true);

  fireEvent.change(screen.getByLabelText('BIC'), { target: { value: 'AGRIFRPP' } });
  expect(onEtatConfirmation).toHaveBeenLastCalledWith(false);
  expect(screen.getByText('Confirmer ces informations')).toBeTruthy();
});

test('pièce d’identité jamais confirmée : état « à confirmer », même une fois lue', async () => {
  lireMrz.mockResolvedValue(MRZ);
  const onEtatConfirmation = vi.fn();
  render(
    <ConfirmationPieceIdentite
      dossierId={7}
      candidat={CANDIDAT}
      enregistree={null}
      photo={photo()}
      modifiable
      onConfirmee={() => {}}
      onEtatConfirmation={onEtatConfirmation}
    />,
  );
  expect(await screen.findByDisplayValue('X4RTBPFW4')).toBeTruthy();
  expect(onEtatConfirmation).not.toHaveBeenCalledWith(true);
});
