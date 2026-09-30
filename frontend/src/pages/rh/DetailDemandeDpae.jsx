import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import StatutBadge from '../../core/workflow/StatutBadge';
import ModaleRejeterDpae from './ModaleRejeterDpae';
import { obtenirDemande, validerDemande, rejeterDemande } from '../../services/dpaeService';
import { useSession } from '../../core/auth/useSession';
import { ROLES_DPAE_RH } from '../../core/auth/rolesGroupes';
import './DetailDemandeDpae.css';

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const FORMAT_DATE_HEURE = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const VARIANTE_PAR_STATUT = { envoyee: 'attente', validee: 'succes', rejetee: 'echec' };
const LIBELLE_PAR_STATUT = { envoyee: 'À traiter', validee: 'Validée', rejetee: 'Rejetée' };
const LIBELLE_PAR_TYPE = {
  nouvelle_embauche: 'Nouvelle embauche',
  prolongation: 'Prolongation',
  ajout_retrait_jours: 'Ajout/retrait de jours',
  passage_cdi: 'Passage CDI',
  changement_horaires_affectation: 'Changement horaires/affectation',
};
const LIBELLE_PAR_POSTE = {
  femme_valet_chambre: 'Femme/Valet de chambre',
  cafetier: 'Cafetier',
  equipier: 'Équipier',
  gouvernant: 'Gouvernant(e)',
  autre: 'Autre',
};
const JOURS_SEMAINE_LIBELLE = {
  lundi: 'Lundi',
  mardi: 'Mardi',
  mercredi: 'Mercredi',
  jeudi: 'Jeudi',
  vendredi: 'Vendredi',
  samedi: 'Samedi',
  dimanche: 'Dimanche',
};

function ligne(libelle, valeur) {
  if (valeur === null || valeur === undefined || valeur === '') return null;
  return (
    <p className="page-detail-dpae__ligne">
      <span className="page-detail-dpae__libelle">{libelle}</span>
      <span>{valeur}</span>
    </p>
  );
}

// Détail d'une demande DPAE (module Demandes DPAE, 2026-09-28). Depuis le 2026-09-30, fiche commune
// à tous les rôles de consultation (Admin, RH, Planning — voir App.jsx, ROLES_DPAE_CONSULTATION),
// ouverte d'un clic depuis « Suivi des demandes DPAE » ; le serveur décide quelles fiches chacun
// peut ouvrir (dpae.routes.js, GET /:id). Les actions Valider/Rejeter ne sont affichées qu'aux
// rôles de traitement RH (RH, Admin), comme côté serveur.
export default function DetailDemandeDpae() {
  const { demandeId } = useParams();
  const { utilisateur } = useSession();
  const peutTraiter = ROLES_DPAE_RH.includes(utilisateur?.roleCode);
  // Retour vers la liste d'où l'on vient selon le rôle : file RH pour la RH, suivi pour les autres.
  const cheminListe = utilisateur?.roleCode === 'rh' ? '/rh/dpae' : '/coordination/dpae/suivi';
  const navigate = useNavigate();

  const [demande, setDemande] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);
  const [actionEnCours, setActionEnCours] = useState(false);
  const [erreurAction, setErreurAction] = useState(null);
  const [modaleRejetOuverte, setModaleRejetOuverte] = useState(false);

  const charger = () => {
    setChargement(true);
    return obtenirDemande(demandeId)
      .then(setDemande)
      .catch(() => setErreur('Impossible de récupérer cette demande.'))
      .finally(() => setChargement(false));
  };

  useEffect(() => {
    charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demandeId]);

  const valider = async () => {
    setActionEnCours(true);
    setErreurAction(null);
    try {
      await validerDemande(demandeId);
      await charger();
    } catch (erreurRequete) {
      setErreurAction(erreurRequete.response?.data?.erreur ?? 'Impossible de valider cette demande.');
    } finally {
      setActionEnCours(false);
    }
  };

  const rejeter = async (motifRejet) => {
    setActionEnCours(true);
    setErreurAction(null);
    try {
      await rejeterDemande(demandeId, motifRejet);
      setModaleRejetOuverte(false);
      await charger();
    } catch (erreurRequete) {
      setErreurAction(erreurRequete.response?.data?.erreur ?? 'Impossible de rejeter cette demande.');
    } finally {
      setActionEnCours(false);
    }
  };

  if (chargement) {
    return (
      <PageBackOffice>
        <p>Chargement…</p>
      </PageBackOffice>
    );
  }

  if (erreur || !demande) {
    return (
      <PageBackOffice>
        <p role="alert">{erreur ?? 'Demande introuvable.'}</p>
      </PageBackOffice>
    );
  }

  const semaineTravaillee = (demande.semaine_type ?? []).filter((jour) => jour.statut === 'travail');
  const joursConcernes = demande.jours_concernes ?? [];

  return (
    <PageBackOffice>
      <div className="page-detail-dpae">
        <header className="page-detail-dpae__entete">
          <div>
            <button type="button" className="page-detail-dpae__retour" onClick={() => navigate(cheminListe)}>
              ← Retour à la liste
            </button>
            <h1>
              {demande.salarie_prenom} {demande.salarie_nom}
            </h1>
            <div className="page-detail-dpae__badges">
              <StatutBadge
                libelle={LIBELLE_PAR_STATUT[demande.statut] ?? demande.statut}
                variante={VARIANTE_PAR_STATUT[demande.statut] ?? 'neutre'}
              />
              {/* "En un clic accéder à la fiche du candidat" (demande utilisateur, module Demandes
                  DPAE) — dossier_id résolu côté back via candidat_id (voir demandeDpaeRepository.js,
                  requeteDemandesAvecJointures) : absent si le salarié n'est pas un candidat connu
                  du système (saisie libre, voir RechercheCandidatSalarie.jsx), auquel cas ce lien
                  n'a simplement rien à cibler. Même destination que "Étudier le dossier"
                  (TableauDeBordAccueil.jsx) — Validation.jsx reste en lecture seule pour RH (masque
                  déjà "Forcer le statut"/"Embauche" hors ROLES_FORCAGE/ROLES_ACCUEIL+admin, voir son
                  commentaire d'en-tête), donc pas de risque d'action involontaire depuis ce lien. */}
              {demande.dossier_id && (
                <Link to={`/recruteur/dossiers/${demande.dossier_id}/validation`} className="page-detail-dpae__lien-candidat">
                  Voir la fiche candidat
                </Link>
              )}
            </div>
          </div>
          <EnTeteBackOffice />
        </header>

        <section className="page-detail-dpae__bloc">
          <h2>Demande</h2>
          {ligne('Type', LIBELLE_PAR_TYPE[demande.type_demande] ?? demande.type_demande)}
          {ligne('Reçue le', FORMAT_DATE_HEURE.format(new Date(demande.date_creation)))}
          {ligne('Demandée par', `${demande.demandeur_prenom} ${demande.demandeur_nom}`)}
          {demande.date_traitement &&
            ligne(
              'Traitée le',
              `${FORMAT_DATE_HEURE.format(new Date(demande.date_traitement))} par ${demande.traitant_prenom} ${demande.traitant_nom}`,
            )}
          {demande.statut === 'rejetee' && ligne('Motif de rejet', demande.motif_rejet)}
        </section>

        <section className="page-detail-dpae__bloc">
          <h2>Salarié</h2>
          {ligne('Téléphone', demande.salarie_telephone)}
          {ligne('A déjà travaillé chez nous', demande.salarie_deja_employe ? 'Oui' : 'Non')}
          {/* Sites d'affectation (référentiel, 2026-09-29) : liste complète NOM (INITIALES) des sites
              liés à la demande ; une demande antérieure au référentiel n'a aucun site lié et
              retombe sur son ancien texte libre (colonne `hotel`, conservée). */}
          {(demande.sites_affectation ?? []).length > 0
            ? ligne(
                "Sites d'affectation",
                demande.sites_affectation.map((site) => `${site.nom} (${site.initiales})`).join(', '),
              )
            : ligne("Site d'affectation", demande.hotel)}
        </section>

        <section className="page-detail-dpae__bloc">
          <h2>Contrat</h2>
          {ligne('Type de contrat', demande.type_contrat?.toUpperCase())}
          {ligne('Motif CDD', demande.motif_cdd === 'remplacement_absent' ? 'Remplacer salarié absent' : demande.motif_cdd === 'surcroit_activite' ? "Surcroît d'activité" : null)}
          {ligne('Salarié remplacé', demande.salarie_remplace_nom)}
          {ligne('Date de fin d’absence', demande.date_fin_absence && FORMAT_DATE.format(new Date(demande.date_fin_absence)))}
          {ligne('Raison du surcroît', demande.raison_surcroit)}
          {ligne('Entité', demande.division === 'autre' ? demande.division_autre : demande.division?.toUpperCase())}
          {ligne('Poste', demande.poste === 'autre' ? demande.poste_autre : LIBELLE_PAR_POSTE[demande.poste])}
          {ligne('Premier jour', demande.date_debut && FORMAT_DATE.format(new Date(demande.date_debut)))}
          {ligne('Dernier jour', demande.date_fin && FORMAT_DATE.format(new Date(demande.date_fin)))}
          {ligne('Heure d’arrivée jour 1', demande.heure_arrivee_j1)}
          {ligne('Heures/mois', demande.heures_par_mois)}
        </section>

        {demande.modifications_demandees && (
          <section className="page-detail-dpae__bloc">
            <h2>Modifications demandées</h2>
            {ligne('Horaires', demande.modification_horaires ? 'Oui' : null)}
            {ligne('Jours de repos', demande.modification_jours_repos ? 'Oui' : null)}
            {ligne('Hôtel ou poste', demande.modification_affectation ? 'Oui' : null)}
            {ligne('Nouvelle affectation', demande.nouvelle_affectation)}
          </section>
        )}

        {demande.type_demande === 'ajout_retrait_jours' && (
          <section className="page-detail-dpae__bloc">
            <h2>Gestion des jours</h2>
            {ligne('Type', demande.type_changement_jours === 'ajouter' ? 'Ajouter des jours' : 'Retirer des jours')}
            {joursConcernes.length > 0 &&
              ligne(
                'Jours concernés',
                joursConcernes
                  .map((jour) => (jour.date ? FORMAT_DATE.format(new Date(jour.date)) : null))
                  .filter(Boolean)
                  .join(', '),
              )}
            {ligne('Raison', demande.raison_changement_jours)}
          </section>
        )}

        <section className="page-detail-dpae__bloc">
          <h2>Semaine type</h2>
          {semaineTravaillee.length === 0 && <p>Aucun jour de travail renseigné.</p>}
          {semaineTravaillee.length > 0 && (
            <ul className="page-detail-dpae__semaine-type">
              {semaineTravaillee.map((jour) => (
                <li key={jour.jour}>
                  {JOURS_SEMAINE_LIBELLE[jour.jour] ?? jour.jour}
                  {jour.heureDebut && jour.heureFin ? ` : ${jour.heureDebut} – ${jour.heureFin}` : ''}
                </li>
              ))}
            </ul>
          )}
        </section>

        {demande.autre_chose_signaler && (
          <section className="page-detail-dpae__bloc">
            <h2>Autre chose à signaler</h2>
            <p>{demande.autre_chose_signaler}</p>
          </section>
        )}

        {demande.statut === 'envoyee' && peutTraiter && (
          <section className="page-detail-dpae__actions">
            {erreurAction && <p role="alert">{erreurAction}</p>}
            <button type="button" className="page-detail-dpae__rejeter" onClick={() => setModaleRejetOuverte(true)} disabled={actionEnCours}>
              Rejeter
            </button>
            <button type="button" className="page-detail-dpae__valider" onClick={valider} disabled={actionEnCours}>
              {actionEnCours ? 'Traitement…' : 'Valider'}
            </button>
          </section>
        )}

        {modaleRejetOuverte && (
          <ModaleRejeterDpae
            onConfirmer={rejeter}
            onAnnuler={() => setModaleRejetOuverte(false)}
            enCours={actionEnCours}
            erreur={erreurAction}
          />
        )}
      </div>
    </PageBackOffice>
  );
}
