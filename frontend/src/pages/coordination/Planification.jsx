import { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useSession } from '../../core/auth/useSession';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import StatutBadge from '../../core/workflow/StatutBadge';
import { listerRendezvousTest } from '../../services/rendezvousService';
import { listerFormateurs } from '../../services/formateurService';
import './Planification.css';

const FORMAT_DATE_HEURE = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

// Même mapping que GestionRendezvous.jsx (libellé + polarité visuelle d'un statut de
// rendez-vous) — dupliqué plutôt que partagé : une poignée de lignes, pas de quoi justifier un
// utilitaire commun (voir CLAUDE.md, conventions du projet).
const LIBELLES_STATUT = { prevu: 'Prévu', confirme: 'Confirmé', absent: 'Absent', annule: 'Annulé' };
const STATUTS_DESISTEMENT = ['absent', 'annule'];
function varianteStatutRendezvous(statut) {
  if (statut === 'confirme') return 'succes';
  if (STATUTS_DESISTEMENT.includes(statut)) return 'echec';
  return 'attente';
}

// Libellés des postes (colonne "Poste") — même mapping que TableauDeBordAccueil.jsx/Backoffice.jsx,
// dupliqué plutôt que partagé (voir CLAUDE.md conventions du projet).
const LIBELLES_POSTE_PAR_CODE_ACCECIT = {
  nettoyage: 'Nettoyage',
  vitrerie: 'Vitrerie',
  machiniste: 'Machiniste',
  chef_equipe: "Chef d'équipe",
  autres: 'Autres',
  femme_valet_chambre: 'Femme/Valet de chambre',
  cafetier: 'Cafétier(ère)',
  equipier: 'Équipier(ère)',
  gouvernant: 'Gouvernant(e)',
};
function libellePoste(code) {
  return LIBELLES_POSTE_PAR_CODE_ACCECIT[code] ?? code;
}

// Une entrée par colonne triable, même patron que DossierList.jsx (core/dossier/DossierList.jsx)
// — "Candidat" trie sur candidats.nom (nom de famille), pas la chaîne "prénom nom" affichée.
// "Statut" trie sur le libellé affiché (LIBELLES_STATUT), plus lisible pour l'utilisateur qu'un
// tri sur le code brut ('absent' avant 'confirme' avant 'prevu'...).
const COLONNES = [
  { cle: 'date_heure', libelle: 'Date et heure', extraire: (rdv) => new Date(rdv.date_heure).getTime() },
  { cle: 'candidat_nom', libelle: 'Candidat', extraire: (rdv) => (rdv.candidat_nom ?? '').toLowerCase() },
  {
    cle: 'postes',
    libelle: 'Poste',
    extraire: (rdv) => [...(rdv.postesBureau ?? []), ...(rdv.postesHotel ?? [])].join(', '),
  },
  { cle: 'formateur_nom', libelle: 'Formateur', extraire: (rdv) => (rdv.formateur_nom ?? '').toLowerCase() },
  {
    cle: 'statut',
    libelle: 'Statut',
    extraire: (rdv) => (LIBELLES_STATUT[rdv.statut] ?? rdv.statut ?? '').toLowerCase(),
  },
];

// Vue d'ensemble des rendez-vous de test côté Coordination (CLAUDE.md, besoin Accueil/
// Coordination : "planifie les tests") — tous dossiers confondus, contrairement à
// GestionRendezvous.jsx qui reste scopé à un seul dossier. Ne crée ni ne modifie aucun
// rendez-vous ici : chaque ligne renvoie vers la page du dossier concerné
// (/coordination/dossiers/:id/relances, où vit déjà GestionRendezvous) pour agir dessus.
export default function Planification() {
  const { utilisateur, chargement: chargementSession } = useSession();
  const navigate = useNavigate();

  const [rendezvous, setRendezvous] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);

  const [aVenirSeulement, setAVenirSeulement] = useState(true);
  const [formateurFiltre, setFormateurFiltre] = useState(''); // '' = tous les formateurs
  const [formateurs, setFormateurs] = useState([]);

  // Tri entièrement client sur la liste déjà reçue (GET /api/dossiers/rendezvous ne pagine pas,
  // voir rendezvousRepository.listerRendezvousTest) — même choix que DossierList.jsx. Défaut =
  // date et heure croissantes (comportement historique de cette page, prochain rendez-vous en
  // premier), préservé tant qu'aucun en-tête n'a été cliqué.
  const [tri, setTri] = useState({ colonne: 'date_heure', ordre: 'asc' });

  useEffect(() => {
    listerFormateurs()
      .then(setFormateurs)
      .catch(() => {
        // Filtre non critique : la liste de rendez-vous reste consultable sans lui, seul le
        // sélecteur "Formateur" resterait vide.
      });
  }, []);

  useEffect(() => {
    let annule = false;
    setChargement(true);
    setErreur(null);
    listerRendezvousTest({ aVenir: aVenirSeulement, formateurId: formateurFiltre || undefined })
      .then((valeur) => {
        if (!annule) setRendezvous(valeur);
      })
      .catch((erreur) => {
        if (!annule) setErreur(erreur.response?.data?.erreur ?? 'Impossible de récupérer les rendez-vous de test.');
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, [aVenirSeulement, formateurFiltre]);

  const rendezvousTries = useMemo(() => {
    const colonneTri = COLONNES.find((colonne) => colonne.cle === tri.colonne);
    const copie = [...rendezvous];
    copie.sort((a, b) => {
      const valeurA = colonneTri.extraire(a);
      const valeurB = colonneTri.extraire(b);
      if (valeurA < valeurB) return tri.ordre === 'asc' ? -1 : 1;
      if (valeurA > valeurB) return tri.ordre === 'asc' ? 1 : -1;
      return 0;
    });
    return copie;
  }, [rendezvous, tri]);

  // Reclique sur la colonne déjà active : inverse l'ordre. Nouvelle colonne : "Date et heure"
  // repart croissant (le prochain rendez-vous en premier reste le repère le plus utile), les
  // colonnes textuelles repartent croissant (ordre alphabétique naturel) — même patron que
  // DossierList.jsx.
  const trierPar = (colonne) => {
    setTri((precedent) => {
      if (precedent.colonne === colonne) {
        return { colonne, ordre: precedent.ordre === 'asc' ? 'desc' : 'asc' };
      }
      return { colonne, ordre: 'asc' };
    });
  };

  if (chargementSession) {
    return (
      <PageBackOffice>
        <p>Chargement de la session…</p>
      </PageBackOffice>
    );
  }

  if (!utilisateur) {
    return (
      <PageBackOffice>
        <p role="alert">Vous devez être connecté pour accéder à la planification.</p>
      </PageBackOffice>
    );
  }

  return (
    <PageBackOffice>
      <div className="planification">
        <header className="planification__entete">
          <h1>Planification des tests</h1>
          <EnTeteBackOffice />
        </header>
        {/* Aligné à droite, juste sous Déconnexion — même patron que
            .capture-tablette__retour-ligne (CaptureTablette.css). */}
        <div className="planification__retour-ligne">
          <Link to="/accueil/tableau-de-bord" className="planification__bouton-retour">
            Retour au tableau de bord
          </Link>
        </div>

        <div className="planification__filtres">
          <label className="planification__filtre-case">
            <input
              type="checkbox"
              checked={aVenirSeulement}
              onChange={(evenement) => setAVenirSeulement(evenement.target.checked)}
            />
            À venir uniquement
          </label>

          <label className="planification__filtre-formateur">
            <span>Formateur</span>
            <select value={formateurFiltre} onChange={(evenement) => setFormateurFiltre(evenement.target.value)}>
              <option value="">Tous</option>
              {formateurs.map((formateur) => (
                <option key={formateur.id} value={formateur.id}>
                  {formateur.prenom} {formateur.nom}
                </option>
              ))}
            </select>
          </label>
        </div>

        {chargement && <p>Chargement des rendez-vous…</p>}
        {erreur && <p role="alert">{erreur}</p>}

        {!chargement && !erreur && rendezvous.length === 0 && (
          <p className="planification__vide">Aucun rendez-vous de test à afficher.</p>
        )}

        {!chargement && !erreur && rendezvous.length > 0 && (
          <div className="planification__scroll">
            <table className="planification__table">
              <thead>
                <tr>
                  {COLONNES.map((colonne) => {
                    const actif = tri.colonne === colonne.cle;
                    // "Candidat" (2e colonne) figée au défilement horizontal, comme le repère de
                    // ligne des tableaux Comptes utilisateurs/Dossiers candidats — mais "Candidat"
                    // n'est pas en 1re position ici, donc "Date et heure" doit être figée aussi
                    // (même left: 0 que d'habitude) pour que "Candidat" reste juste derrière elle
                    // sans laisser un vide à gauche une fois "Date et heure" scrollée hors champ
                    // (voir Planification.css, --planification-largeur-colonne-date).
                    let classeFigee;
                    if (colonne.cle === 'date_heure') classeFigee = 'planification__colonne-date';
                    else if (colonne.cle === 'candidat_nom') classeFigee = 'planification__colonne-figee';
                    return (
                      <th
                        key={colonne.cle}
                        scope="col"
                        className={classeFigee}
                        aria-sort={actif ? (tri.ordre === 'asc' ? 'ascending' : 'descending') : 'none'}
                      >
                        <button type="button" className="planification__entete-tri" onClick={() => trierPar(colonne.cle)}>
                          {colonne.libelle}
                          <span className="planification__indicateur-tri" aria-hidden="true">
                            {actif ? (tri.ordre === 'asc' ? '▲' : '▼') : ''}
                          </span>
                        </button>
                      </th>
                    );
                  })}
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rendezvousTries.map((rdv) => (
                  <tr key={rdv.id}>
                    <td className="planification__colonne-date">{FORMAT_DATE_HEURE.format(new Date(rdv.date_heure))}</td>
                    <td className="planification__colonne-figee">
                      {rdv.candidat_prenom} {rdv.candidat_nom}
                    </td>
                    <td>
                      <div className="planification__postes">
                        {[...(rdv.postesBureau ?? []), ...(rdv.postesHotel ?? [])].map((code) => (
                          <span key={code} className="planification__badge-poste">
                            {libellePoste(code)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>{rdv.formateur_nom ? `${rdv.formateur_prenom} ${rdv.formateur_nom}` : '—'}</td>
                    <td>
                      <StatutBadge
                        libelle={LIBELLES_STATUT[rdv.statut] ?? rdv.statut}
                        variante={varianteStatutRendezvous(rdv.statut)}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => navigate(`/coordination/dossiers/${rdv.dossier_id}/relances`)}
                      >
                        Voir le dossier
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageBackOffice>
  );
}
