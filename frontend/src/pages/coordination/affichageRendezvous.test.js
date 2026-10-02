import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  COLONNES,
  estRendezvousAVenir,
  libelleAfficheRendezvous,
  libelleGroupeStatutDossier,
  positionnerInfobulleRdvClos,
  rechercheCorrespond,
  rendezvousDossierClos,
  varianteAfficheeRendezvous,
  varianteGroupeStatutDossier,
} from './affichageRendezvous';

afterEach(() => vi.useRealTimers());

describe('statut du rendez-vous', () => {
  test('libellés et couleurs', () => {
    expect(libelleAfficheRendezvous({ statut: 'absent' })).toBe('NSPP');
    expect(varianteAfficheeRendezvous({ statut: 'absent' })).toBe('echec');
    expect(varianteAfficheeRendezvous({ statut: 'confirme' })).toBe('succes');
    expect(libelleAfficheRendezvous({ statut: 'inconnu' })).toBe('inconnu');
  });

  test('une annulation due à un forçage de statut est distinguée d’une vraie annulation', () => {
    const rdv = { statut: 'annule', motif_code: 'neutralise_par_forcage' };
    expect(libelleAfficheRendezvous(rdv)).toBe('Annulé (forçage)');
    expect(varianteAfficheeRendezvous(rdv)).toBe('neutre-fort');
    expect(libelleAfficheRendezvous({ statut: 'annule', motif_code: 'autre' })).toBe('Annulé');
  });

  test('rendez-vous encore ouvert sur un dossier déjà sorti de « test planifié »', () => {
    expect(rendezvousDossierClos({ statut: 'prevu', dossier_statut_code: 'embauche' })).toBe(true);
    expect(rendezvousDossierClos({ statut: 'prevu', dossier_statut_code: 'test_planifie' })).toBe(false);
    expect(rendezvousDossierClos({ statut: 'honore', dossier_statut_code: 'embauche' })).toBe(false);
  });

  test('à venir : prévu ou confirmé, date future', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T10:00:00Z'));
    expect(estRendezvousAVenir({ statut: 'prevu', date_heure: '2026-10-03T08:00:00Z' })).toBe(true);
    expect(estRendezvousAVenir({ statut: 'prevu', date_heure: '2026-10-01T08:00:00Z' })).toBe(false);
    expect(estRendezvousAVenir({ statut: 'annule', date_heure: '2026-10-03T08:00:00Z' })).toBe(false);
  });
});

describe('statut du dossier regroupé', () => {
  test('les statuts du dossier sont regroupés en 4 étapes de test', () => {
    expect(libelleGroupeStatutDossier({ dossier_statut_code: 'en_attente_pieces' })).toBe('Test non planifié');
    expect(libelleGroupeStatutDossier({ dossier_statut_code: 'embauche' })).toBe('Test réalisé');
    expect(varianteGroupeStatutDossier({ dossier_statut_code: 'test_non_realise' })).toBe('alerte');
  });

  test('statut inconnu : libellé du serveur, couleur neutre', () => {
    const rdv = { dossier_statut_code: 'nouveau_statut', dossier_statut_libelle: 'Nouveau statut' };
    expect(libelleGroupeStatutDossier(rdv)).toBe('Nouveau statut');
    expect(varianteGroupeStatutDossier(rdv)).toBe('neutre');
  });
});

describe('rechercheCorrespond', () => {
  const rdv = {
    dossier_id: 42,
    candidat_prenom: 'Élodie',
    candidat_nom: 'Martin',
    formateur_prenom: 'Paul',
    formateur_nom: 'Durand',
    postesHotel: ['femme_valet_chambre'],
    statut: 'confirme',
  };
  const critere = (texte) => {
    const normalise = texte.trim().toLowerCase();
    const chiffres = normalise.replace(/\s/g, '');
    const numerique = /^\d+$/.test(chiffres);
    return {
      motsRechercheNom: normalise.split(/\s+/).map((mot) => mot.normalize('NFD').replace(/[̀-ͯ]/g, '')),
      rechercheNormaliseeTexte: normalise.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ''),
      rechercheChiffresSeuls: chiffres,
      rechercheEstNumerique: numerique,
      rechercheEstNumeroDossier: numerique && chiffres.length < 10,
    };
  };

  test.each([
    ['numéro de dossier', '42', true],
    ['autre numéro', '43', false],
    ['nom du candidat sans accent', 'elodie martin', true],
    ['nom du formateur', 'durand', true],
    ['libellé du poste', 'valet de chambre', true],
    ['libellé du statut du rendez-vous', 'présence confirmée', true],
    ['texte absent', 'gouvernante', false],
  ])('%s', (_cas, texte, attendu) => {
    expect(rechercheCorrespond(rdv, critere(texte))).toBe(attendu);
  });
});

test('colonnes triables : extraction des valeurs de tri', () => {
  const colonne = (cle) => COLONNES.find((c) => c.cle === cle);
  expect(colonne('candidat_nom').extraire({ candidat_nom: 'MARTIN' })).toBe('martin');
  expect(colonne('date_heure').extraire({ date_heure: '2026-10-02T10:00:00Z' })).toBe(Date.parse('2026-10-02T10:00:00Z'));
});

test('infobulle basculée sous la cellule quand la place manque au-dessus', () => {
  const conteneur = document.createElement('div');
  const bulle = document.createElement('div');
  bulle.className = 'planification__rdv-clos-infobulle';
  conteneur.appendChild(bulle);
  conteneur.getBoundingClientRect = () => ({ top: 10, bottom: 40 });
  bulle.getBoundingClientRect = () => ({ height: 80 });
  positionnerInfobulleRdvClos({ currentTarget: conteneur });
  expect(conteneur.classList.contains('planification__rdv-conteneur--infobulle-en-dessous')).toBe(true);
});
