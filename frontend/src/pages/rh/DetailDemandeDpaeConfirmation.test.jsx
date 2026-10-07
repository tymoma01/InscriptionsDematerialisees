import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import DetailDemandeDpae from './DetailDemandeDpae';
import { useSession } from '../../core/auth/useSession';
import * as dpaeService from '../../services/dpaeService';

vi.mock('../../core/auth/useSession', () => ({ useSession: vi.fn() }));
vi.mock('../../services/dpaeService', () => ({
  obtenirDemande: vi.fn(),
  validerDemande: vi.fn(),
  rejeterDemande: vi.fn(),
  mettreEnAttenteDemande: vi.fn(),
  transmettreDemandeALaRh: vi.fn(),
  renvoyerDemandeAInspecteur: vi.fn(),
  classerSansSuiteDemande: vi.fn(),
  envoyerAuPlanningDemande: vi.fn(),
  retransmettreDemandeALaRh: vi.fn(),
  reactiverDemande: vi.fn(),
  listerNotesDemande: vi.fn().mockResolvedValue([]),
  ajouterNoteDemande: vi.fn(),
}));
// L'habillage, les notes et le PDF ne sont pas l'objet de ces tests.
vi.mock('../../core/backOffice/PageBackOffice', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('../../core/auth/EnTeteBackOffice', () => ({ default: () => null }));
vi.mock('../../core/dossier/NotesDossier', () => ({ default: ({ lectureSeule }) => <p>notes de la demande{lectureSeule ? ' (lecture seule)' : ''}</p> }));
vi.mock('../../core/dpae/TelechargementPdfDpae', () => ({ BoutonTelechargerPdfDemande: () => null }));

function demande(statut) {
  return {
    id: 7,
    version: 3,
    statut,
    type_demande: 'nouvelle_embauche',
    date_creation: '2026-10-01T08:00:00Z',
    demandeur_id: 5,
    demandeur_prenom: 'Léa',
    demandeur_nom: 'Roux',
    salarie_nom: 'Martin',
    salarie_prenom: 'Sophie',
    type_contrat: 'cdi',
    poste: 'equipier',
    date_debut: '2026-10-12',
    sites_affectation: [],
    semaine_type: [],
    // Anciens motifs encore présents en base : jamais affichés.
    motif_rejet: 'Ancien motif de rejet',
    motif_renvoi: 'Ancien motif de renvoi',
    motif_mise_en_attente: 'Ancien motif d’attente',
  };
}

function afficher(statut, utilisateur, surcharges = {}) {
  useSession.mockReturnValue({ utilisateur, chargement: false });
  dpaeService.obtenirDemande.mockResolvedValue({ ...demande(statut), ...surcharges });
  render(
    <MemoryRouter initialEntries={['/rh/dpae/7']}>
      <Routes>
        <Route path="/rh/dpae/:demandeId" element={<DetailDemandeDpae />} />
      </Routes>
    </MemoryRouter>,
  );
}

const PLANNING = { roleCode: 'planning', permissions: ['dpaeConsultation', 'dpaeValidationPlanning'] };
const INSPECTEUR_AUTEUR = { id: 5, roleCode: 'inspecteur_hotellerie', permissions: ['dpaeConsultation', 'dpaeClassementSansSuite', 'dpaeEnvoiPlanning', 'dpaeRetransmissionRh', 'dpaeNotes'] };
const INSPECTEUR_AUTRE = { ...INSPECTEUR_AUTEUR, id: 77 };
const ADMIN = { id: 1, roleCode: 'admin', permissions: ['dpaeConsultation', 'dpaeClassementSansSuite', 'dpaeClassementSansSuiteToutes', 'dpaeTraitementRh', 'dpaeValidationPlanning', 'dpaeEnvoiPlanning', 'dpaeEnvoiPlanningToutes', 'dpaeRetransmissionRh', 'dpaeRetransmissionRhToutes', 'dpaeReactivation', 'dpaeNotes', 'dpaeNotesToutes'] };
const PLANNING_COMPLET = { id: 8, roleCode: 'planning', permissions: ['dpaeConsultation', 'dpaeValidationPlanning', 'dpaeRetransmissionRh', 'dpaeRetransmissionRhToutes'] };
const RH = { roleCode: 'rh', permissions: ['dpaeConsultation', 'dpaeTraitementRh'] };

beforeEach(() => {
  vi.mocked(dpaeService.listerNotesDemande).mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function ouvrir(statut, utilisateur, bouton) {
  afficher(statut, utilisateur);
  fireEvent.click(await screen.findByRole('button', { name: bouton }));
  return screen.findByRole('dialog');
}

describe('Fiche d’une demande DPAE : fenêtre de confirmation commune, sans motif', () => {
  const CAS = [
    ['a_valider_planning', PLANNING, 'Renvoyer à l’inspecteur', 'Renvoyer la demande à l’inspecteur ?', 'renvoyerDemandeAInspecteur'],
    ['a_valider_planning', PLANNING, 'Transmettre à la RH', 'Transmettre la demande à la RH ?', 'transmettreDemandeALaRh'],
    ['envoyee', RH, 'Rejeter', 'Rejeter la demande ?', 'rejeterDemande'],
    ['envoyee', RH, 'Mettre en attente', 'Mettre la demande en attente ?', 'mettreEnAttenteDemande'],
    ['envoyee', RH, 'Valider', 'Valider la demande ?', 'validerDemande'],
  ];

  it.each(CAS)('%s : « %s » ouvre la fenêtre « %s » sans champ de saisie ; Confirmer appelle le service avec la seule version', async (statut, utilisateur, bouton, titre, service) => {
    const fenetre = await ouvrir(statut, utilisateur, bouton);
    expect(within(fenetre).getByRole('heading', { name: titre })).toBeTruthy();
    // Aucune phrase de rappel : seulement le titre et les boutons.
    expect(within(fenetre).queryByText(/Pensez à indiquer/)).toBeNull();
    expect(within(fenetre).queryByRole('textbox')).toBeNull();
    expect(within(fenetre).getByRole('button', { name: 'Annuler' })).toBeTruthy();
    expect(within(fenetre).getByRole('button', { name: 'Confirmer' })).toBeTruthy();

    fireEvent.click(within(fenetre).getByRole('button', { name: 'Confirmer' }));
    await waitFor(() => expect(dpaeService[service]).toHaveBeenCalledTimes(1));
    expect(dpaeService[service]).toHaveBeenCalledWith('7', 3);
  });

  it('Annuler ferme la fenêtre sans rien envoyer', async () => {
    const fenetre = await ouvrir('envoyee', RH, 'Rejeter');
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(dpaeService.rejeterDemande).not.toHaveBeenCalled();
  });

  it('les anciens motifs ne sont plus affichés sur la fiche', async () => {
    for (const statut of ['rejetee', 'renvoyee_inspecteur', 'en_attente']) {
      afficher(statut, RH);
      await screen.findByText(/^notes de la demande/);
      expect(screen.queryByText(/Motif (de rejet|du renvoi|de mise en attente)/)).toBeNull();
      expect(screen.queryByText(/Ancien motif/)).toBeNull();
      cleanup();
    }
  });
});

describe('Fiche d’une demande DPAE : classement sans suite', () => {
  const bouton = () => screen.queryByRole('button', { name: 'Classer sans suite' });

  it('bouton visible pour l’auteur Inspecteur Hôtellerie, pas pour un autre inspecteur ni pour la RH', async () => {
    afficher('a_valider_planning', INSPECTEUR_AUTEUR);
    expect(await screen.findByRole('button', { name: 'Classer sans suite' })).toBeTruthy();
    cleanup();
    afficher('a_valider_planning', INSPECTEUR_AUTRE);
    await screen.findByText(/^notes de la demande/);
    expect(bouton()).toBeNull();
    cleanup();
    afficher('envoyee', RH);
    await screen.findByText(/^notes de la demande/);
    expect(bouton()).toBeNull();
  });

  it('visible pour Admin et Planning sur tout statut non traité, jamais sur un statut final', async () => {
    for (const statut of ['a_valider_planning', 'renvoyee_inspecteur', 'envoyee', 'en_attente']) {
      afficher(statut, ADMIN);
      expect(await screen.findByRole('button', { name: 'Classer sans suite' }), statut).toBeTruthy();
      cleanup();
    }
    for (const statut of ['validee', 'rejetee', 'classee_sans_suite']) {
      afficher(statut, ADMIN);
      await screen.findByText(/^notes de la demande/);
      expect(bouton(), statut).toBeNull();
      cleanup();
    }
  });

  it('fenêtre « Classer la demande sans suite ? » sans champ de saisie, avec le rappel des notes ; Confirmer appelle le service', async () => {
    const fenetre = await ouvrir('envoyee', ADMIN, 'Classer sans suite');
    expect(within(fenetre).getByRole('heading', { name: 'Classer la demande sans suite ?' })).toBeTruthy();
    expect(within(fenetre).queryByText(/Pensez à indiquer/)).toBeNull();
    expect(within(fenetre).queryByRole('textbox')).toBeNull();
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Confirmer' }));
    await waitFor(() => expect(dpaeService.classerSansSuiteDemande).toHaveBeenCalledWith('7', 3));
  });

  it('« Classer sans suite » est dans la même rangée que les autres actions, dans le groupe de gauche', async () => {
    afficher('a_valider_planning', ADMIN);
    const classer = await screen.findByRole('button', { name: 'Classer sans suite' });
    const transmettre = screen.getByRole('button', { name: 'Transmettre à la RH' });
    expect(classer.closest('section')).toBe(transmettre.closest('section'));
    expect(classer.parentElement.className).toContain('page-detail-dpae__actions-gauche');
    expect(transmettre.parentElement.className).not.toContain('actions-gauche');
  });

  it('bouton seul : « Classer sans suite » reste dans le groupe de gauche', async () => {
    afficher('a_valider_planning', INSPECTEUR_AUTEUR);
    const classer = await screen.findByRole('button', { name: 'Classer sans suite' });
    expect(classer.parentElement.className).toContain('page-detail-dpae__actions-gauche');
    expect(classer.closest('section').querySelectorAll('button')).toHaveLength(1);
  });

  it('la phrase de rappel des notes est absente de toutes les fenêtres d’action', async () => {
    for (const [statut, utilisateur, bouton] of [
      ['a_valider_planning', ADMIN, 'Renvoyer à l’inspecteur'],
      ['a_valider_planning', ADMIN, 'Transmettre à la RH'],
      ['a_valider_planning', ADMIN, 'Classer sans suite'],
      ['envoyee', ADMIN, 'Rejeter'],
      ['envoyee', ADMIN, 'Mettre en attente'],
      ['envoyee', ADMIN, 'Valider'],
    ]) {
      const fenetre = await ouvrir(statut, utilisateur, bouton);
      expect(within(fenetre).queryByText(/Pensez à indiquer/), bouton).toBeNull();
      expect(within(fenetre).getByRole('button', { name: 'Annuler' })).toBeTruthy();
      expect(within(fenetre).getByRole('button', { name: 'Confirmer' })).toBeTruthy();
      cleanup();
    }
  });
});

describe('Fiche d’une demande DPAE : « Envoyer au Planning » et notes', () => {
  const bouton = () => screen.queryByRole('button', { name: 'Envoyer au Planning' });

  it('« Renvoyée à l’inspecteur » : bouton vert à droite pour l’auteur et l’Admin, absent pour un autre inspecteur ; fenêtre sans motif', async () => {
    afficher('renvoyee_inspecteur', INSPECTEUR_AUTEUR);
    const envoyer = await screen.findByRole('button', { name: 'Envoyer au Planning' });
    expect(envoyer.className).toContain('page-detail-dpae__valider');
    expect(envoyer.parentElement.className).not.toContain('actions-gauche');
    cleanup();
    afficher('renvoyee_inspecteur', INSPECTEUR_AUTRE);
    await screen.findByText(/notes de la demande/);
    expect(bouton()).toBeNull();
    cleanup();

    const fenetre = await ouvrir('renvoyee_inspecteur', ADMIN, 'Envoyer au Planning');
    expect(within(fenetre).getByRole('heading', { name: 'Envoyer la demande au Planning ?' })).toBeTruthy();
    expect(within(fenetre).queryByRole('textbox')).toBeNull();
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Confirmer' }));
    await waitFor(() => expect(dpaeService.envoyerAuPlanningDemande).toHaveBeenCalledWith('7', 3));
  });

  it('bouton absent depuis tout autre statut ; « Renvoyer à l’inspecteur » et « Transmettre à la RH » inchangés en « À valider »', async () => {
    for (const statut of ['a_valider_planning', 'envoyee', 'en_attente', 'validee', 'rejetee', 'classee_sans_suite']) {
      afficher(statut, ADMIN);
      await screen.findByText(/notes de la demande/);
      expect(bouton(), statut).toBeNull();
      cleanup();
    }
    afficher('a_valider_planning', ADMIN);
    expect(await screen.findByRole('button', { name: 'Renvoyer à l’inspecteur' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Transmettre à la RH' })).toBeTruthy();
  });

  it('ajout de note : possible sur tout statut, statuts finaux compris, pour l’auteur et les rôles de consultation ; lecture seule pour un autre inspecteur', async () => {
    for (const statut of ['envoyee', 'validee', 'rejetee', 'classee_sans_suite']) {
      for (const utilisateur of [ADMIN, INSPECTEUR_AUTEUR]) {
        afficher(statut, utilisateur);
        expect(await screen.findByText(/^notes de la demande$/), `${statut} ${utilisateur.roleCode}`).toBeTruthy();
        cleanup();
      }
      afficher(statut, INSPECTEUR_AUTRE);
      expect(await screen.findByText('notes de la demande (lecture seule)'), statut).toBeTruthy();
      cleanup();
    }
  });
});

describe('Fiche d’une demande DPAE : « Transmettre à la RH » depuis « En attente »', () => {
  const bouton = () => screen.queryByRole('button', { name: 'Transmettre à la RH' });

  it('bouton vert à droite pour l’auteur, le Planning et l’Admin ; fenêtre sans motif ; Confirmer appelle le service', async () => {
    for (const utilisateur of [INSPECTEUR_AUTEUR, PLANNING_COMPLET, ADMIN]) {
      afficher('en_attente', utilisateur);
      const transmettre = await screen.findByRole('button', { name: 'Transmettre à la RH' });
      expect(transmettre.className, utilisateur.roleCode).toContain('page-detail-dpae__valider');
      expect(transmettre.parentElement.className, utilisateur.roleCode).not.toContain('actions-gauche');
      cleanup();
    }
    const fenetre = await ouvrir('en_attente', INSPECTEUR_AUTEUR, 'Transmettre à la RH');
    expect(within(fenetre).getByRole('heading', { name: 'Transmettre la demande à la RH ?' })).toBeTruthy();
    expect(within(fenetre).queryByRole('textbox')).toBeNull();
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Confirmer' }));
    await waitFor(() => expect(dpaeService.retransmettreDemandeALaRh).toHaveBeenCalledWith('7', 3));
  });

  it('absent pour un autre inspecteur et pour la RH (qui garde Valider et Rejeter) ; absent depuis un autre statut', async () => {
    afficher('en_attente', INSPECTEUR_AUTRE);
    await screen.findByText(/notes de la demande/);
    expect(bouton()).toBeNull();
    cleanup();
    afficher('en_attente', RH);
    expect(await screen.findByRole('button', { name: 'Valider' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rejeter' })).toBeTruthy();
    expect(bouton()).toBeNull();
    cleanup();
    for (const statut of ['envoyee', 'validee', 'classee_sans_suite']) {
      afficher(statut, INSPECTEUR_AUTEUR);
      await screen.findByText(/notes de la demande/);
      expect(bouton(), statut).toBeNull();
      cleanup();
    }
  });
});

describe('Fiche d’une demande DPAE : « Réactiver la demande »', () => {
  const bouton = () => screen.queryByRole('button', { name: 'Réactiver la demande' });
  const PLANNING_SEUL = { id: 8, roleCode: 'planning', permissions: ['dpaeConsultation', 'dpaeValidationPlanning'] };

  it('Admin seulement, depuis « Classée sans suite » : bouton secondaire (contour) à droite', async () => {
    afficher('classee_sans_suite', ADMIN, { statut_retour_reactivation: 'a_valider_planning' });
    const reactiver = await screen.findByRole('button', { name: 'Réactiver la demande' });
    expect(reactiver.className).toContain('page-detail-dpae__reactiver');
    expect(reactiver.parentElement.className).not.toContain('actions-gauche');
    cleanup();
    for (const utilisateur of [PLANNING_SEUL, RH, INSPECTEUR_AUTEUR]) {
      afficher('classee_sans_suite', utilisateur, { statut_retour_reactivation: 'a_valider_planning' });
      await screen.findByText(/notes de la demande/);
      expect(bouton(), utilisateur.roleCode).toBeNull();
      cleanup();
    }
    for (const statut of ['a_valider_planning', 'envoyee', 'en_attente', 'validee']) {
      afficher(statut, ADMIN);
      await screen.findByText(/notes de la demande/);
      expect(bouton(), statut).toBeNull();
      cleanup();
    }
  });

  it.each([
    ['renvoyee_inspecteur', 'Elle repartira chez l’inspecteur.'],
    ['a_valider_planning', 'Elle repartira au Planning.'],
    ['envoyee', 'Elle repartira à la RH.'],
    ['en_attente', 'Elle repartira à la RH.'],
  ])('fenêtre « Réactiver la demande ? » sans motif, destination %s : « %s »', async (statutRetour, phrase) => {
    afficher('classee_sans_suite', ADMIN, { statut_retour_reactivation: statutRetour });
    fireEvent.click(await screen.findByRole('button', { name: 'Réactiver la demande' }));
    const fenetre = await screen.findByRole('dialog');
    expect(within(fenetre).getByRole('heading', { name: 'Réactiver la demande ?' })).toBeTruthy();
    expect(within(fenetre).getByText(phrase)).toBeTruthy();
    expect(within(fenetre).queryByRole('textbox')).toBeNull();
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Confirmer' }));
    await waitFor(() => expect(dpaeService.reactiverDemande).toHaveBeenCalledWith('7', 3));
  });
});
