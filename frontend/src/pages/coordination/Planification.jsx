import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../../core/auth/useSession';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import StatutBadge from '../../core/workflow/StatutBadge';
import { normaliserTexte } from '../../core/filtres/normaliserTexte';
import { listerRendezvousTest } from '../../services/rendezvousService';
import { listerFormateurs } from '../../services/formateurService';
import PanneauHistoriqueRendezvous from './PanneauHistoriqueRendezvous';
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

// Recherche candidat par nom/prénom, filtrage entièrement client (comme aVenirSeulement/
// formateurFiltre sont eux filtrés côté back — voir listerRendezvousTest — cette recherche
// s'applique en plus, sur la liste déjà renvoyée par l'API, sans aller-retour serveur
// supplémentaire). Même logique mots-par-mots que filtrerDossiers.js (core/dossier/
// filtrerDossiers.js, corrigée pour l'ordre des mots de saisie) : chaque mot de la recherche doit
// se retrouver dans "prénom nom" concaténé (normaliserTexte retire accents/espaces), peu importe
// l'ordre de saisie — "ETEST TEST" retrouve "TEST ETEST" comme "TEST ETEST" le fait déjà.
function candidatCorrespond(rdv, motsRecherche) {
  if (motsRecherche.length === 0) return true;
  const nomComplet = normaliserTexte(`${rdv.candidat_prenom} ${rdv.candidat_nom}`.toLowerCase());
  return motsRecherche.every((mot) => nomComplet.includes(mot));
}

// "À venir" au sens de cette page : même définition que le filtre serveur aVenirSeulement
// (rendezvousRepository.listerRendezvousTest — date_heure future ET statut encore actif) —
// reprise ici pour choisir, parmi les rendez-vous d'un même candidat, celui à afficher sur sa
// ligne unique du tableau (voir rendezvousParCandidat plus bas) : le prochain rendez-vous à venir
// s'il y en a un, sinon le plus récent déjà passé (décision utilisateur).
function estRendezvousAVenir(rdv) {
  return ['prevu', 'confirme'].includes(rdv.statut) && new Date(rdv.date_heure).getTime() >= Date.now();
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
// Une ligne par candidat, pas par rendez-vous (voir rendezvousParCandidat) : le détail complet
// des tentatives d'un candidat reste consultable via "Voir l'historique des rendez-vous
// sélectionnés" (PanneauHistoriqueRendezvous.jsx), inchangé par ce regroupement.
export default function Planification() {
  const { utilisateur, chargement: chargementSession } = useSession();
  const navigate = useNavigate();

  const [rendezvous, setRendezvous] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);

  const [aVenirSeulement, setAVenirSeulement] = useState(true);
  const [formateurFiltre, setFormateurFiltre] = useState(''); // '' = tous les formateurs
  const [formateurs, setFormateurs] = useState([]);
  const [rechercheCandidat, setRechercheCandidat] = useState('');

  // Tri entièrement client sur la liste déjà reçue (GET /api/dossiers/rendezvous ne pagine pas,
  // voir rendezvousRepository.listerRendezvousTest) — même choix que DossierList.jsx. Défaut =
  // date et heure croissantes (comportement historique de cette page, prochain rendez-vous en
  // premier), préservé tant qu'aucun en-tête n'a été cliqué.
  const [tri, setTri] = useState({ colonne: 'date_heure', ordre: 'asc' });

  // Sélection de candidats (case à cocher, une par ligne) — indexée sur dossier_id, pas
  // rendezvous.id : un candidat n'a qu'un seul dossier, "sélectionner ce candidat" a donc un sens
  // stable indépendamment du rendez-vous affiché sur sa ligne (voir rendezvousParCandidat plus
  // bas — une seule ligne par dossier_id désormais, ce Set était déjà dossier_id-keyed avant ce
  // changement, donc déjà "un candidat = une sélection" même quand plusieurs lignes de
  // rendez-vous du même dossier apparaissaient). Volontairement PAS réinitialisée quand le filtre
  // ou le tri changent (voir dossierIdsVisibles ci-dessous, recalculé à chaque rendu) : un agent
  // qui change de filtre pour regarder autre chose ne doit pas perdre une sélection déjà faite.
  const [dossiersSelectionnes, setDossiersSelectionnes] = useState(new Set());
  const [panneauHistoriqueOuvert, setPanneauHistoriqueOuvert] = useState(false);
  // Figé au moment du clic sur "Voir l'historique..." (voir PanneauHistoriqueRendezvous.jsx,
  // dossierIds ne se recalcule pas après ouverture) — décocher un candidat pendant que le panneau
  // est déjà ouvert n'en fait donc pas disparaître l'historique tant que l'agent ne rouvre pas.
  const [dossierIdsHistorique, setDossierIdsHistorique] = useState([]);
  // Incrémenté à chaque clic sur "Voir l'historique..." (voir ouvrirHistorique), posé comme `key`
  // sur <PanneauHistoriqueRendezvous> plus bas — force React à démonter/remonter ce composant à
  // chaque clic, même si le panneau était déjà ouvert sur une sélection différente : dossierIds
  // étant figé à l'ouverture (voir son commentaire d'en-tête), un simple changement de prop sans
  // remontage ne relançait ni le chargement des données ni le scrollIntoView interne du panneau
  // (tous deux dans des useEffect à dépendances vides, déclenchés une seule fois au montage).
  // Remonter le composant réutilise ces deux effets existants tels quels, sans y toucher.
  const [compteurHistorique, setCompteurHistorique] = useState(0);

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

  // Filtrage client par nom/prénom candidat, appliqué en plus des filtres serveur (aVenirSeulement/
  // formateurFiltre, voir l'effet ci-dessus) sur la liste déjà reçue — se combine donc naturellement
  // avec eux sans logique de composition supplémentaire : moins de résultats servis par le back à
  // filtrer davantage ici, jamais l'inverse.
  const rendezvousFiltres = useMemo(() => {
    const motsRecherche = rechercheCandidat.trim().toLowerCase().split(/\s+/).filter(Boolean).map(normaliserTexte);
    if (motsRecherche.length === 0) return rendezvous;
    return rendezvous.filter((rdv) => candidatCorrespond(rdv, motsRecherche));
  }, [rendezvous, rechercheCandidat]);

  // Une ligne par candidat (dossier_id), pas par rendez-vous (décision utilisateur) : un candidat
  // avec plusieurs tentatives de test (replanifications, absences...) n'apparaissait jusqu'ici
  // qu'en autant de lignes que de rendez-vous, ce tableau devenant illisible pour un candidat
  // souvent replanifié — le détail complet de ses tentatives reste consultable via "Voir
  // l'historique des rendez-vous sélectionnés" ci-dessous (PanneauHistoriqueRendezvous.jsx,
  // inchangé, déjà groupé par candidat). Rendez-vous représentatif choisi par candidat : le
  // prochain à venir s'il y en a un (estRendezvousAVenir), sinon le plus récent par date_heure —
  // c'est cette seule ligne qui alimente Poste/Formateur/Statut affichés, comme n'importe quelle
  // ligne de rendez-vous unique avant ce changement.
  const rendezvousParCandidat = useMemo(() => {
    const parDossier = new Map();
    for (const rdv of rendezvousFiltres) {
      if (!parDossier.has(rdv.dossier_id)) parDossier.set(rdv.dossier_id, []);
      parDossier.get(rdv.dossier_id).push(rdv);
    }
    return [...parDossier.values()].map((rdvsDuCandidat) => {
      const aVenir = rdvsDuCandidat.filter(estRendezvousAVenir);
      if (aVenir.length > 0) {
        // Le PROCHAIN à venir (date la plus proche), pas le plus lointain.
        return aVenir.reduce((lePlusProche, rdv) => (new Date(rdv.date_heure) < new Date(lePlusProche.date_heure) ? rdv : lePlusProche));
      }
      // Aucun rendez-vous à venir : le plus récent par date_heure, quel que soit son statut.
      return rdvsDuCandidat.reduce((lePlusRecent, rdv) => (new Date(rdv.date_heure) > new Date(lePlusRecent.date_heure) ? rdv : lePlusRecent));
    });
  }, [rendezvousFiltres]);

  const rendezvousTries = useMemo(() => {
    const colonneTri = COLONNES.find((colonne) => colonne.cle === tri.colonne);
    const copie = [...rendezvousParCandidat];
    copie.sort((a, b) => {
      const valeurA = colonneTri.extraire(a);
      const valeurB = colonneTri.extraire(b);
      if (valeurA < valeurB) return tri.ordre === 'asc' ? -1 : 1;
      if (valeurA > valeurB) return tri.ordre === 'asc' ? 1 : -1;
      return 0;
    });
    return copie;
  }, [rendezvousParCandidat, tri]);

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

  // dossier_id distincts de la liste actuellement affichée (filtrée + triée) — sert à la case
  // "tout sélectionner" de l'en-tête : coche/décoche uniquement ce qui est visible maintenant,
  // sans toucher à une éventuelle sélection faite sous un autre filtre (voir dossiersSelectionnes
  // ci-dessus).
  const dossierIdsVisibles = useMemo(
    () => [...new Set(rendezvousTries.map((rdv) => rdv.dossier_id))],
    [rendezvousTries],
  );
  const tousVisiblesSelectionnes =
    dossierIdsVisibles.length > 0 && dossierIdsVisibles.every((id) => dossiersSelectionnes.has(id));

  const togglerSelectionDossier = (dossierId) => {
    setDossiersSelectionnes((precedent) => {
      const suivant = new Set(precedent);
      if (suivant.has(dossierId)) suivant.delete(dossierId);
      else suivant.add(dossierId);
      return suivant;
    });
  };

  const togglerSelectionnerTout = () => {
    setDossiersSelectionnes((precedent) => {
      const suivant = new Set(precedent);
      if (tousVisiblesSelectionnes) {
        dossierIdsVisibles.forEach((id) => suivant.delete(id));
      } else {
        dossierIdsVisibles.forEach((id) => suivant.add(id));
      }
      return suivant;
    });
  };

  const ouvrirHistorique = () => {
    if (dossiersSelectionnes.size === 0) return;
    setDossierIdsHistorique([...dossiersSelectionnes]);
    setPanneauHistoriqueOuvert(true);
    // Voir compteurHistorique ci-dessus : incrémenté à CHAQUE clic (pas seulement à la première
    // ouverture), pour que le panneau se remonte — et donc rescrolle + recharge ses données — même
    // reclic sur une sélection différente pendant qu'il est déjà affiché.
    setCompteurHistorique((precedent) => precedent + 1);
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
          {/* Devant le titre, sur la même ligne (décision utilisateur, 2026-08-13 — revient sur le
              patron "aligné à droite sous le header" de .capture-tablette__retour-ligne, toujours
              utilisé tel quel ailleurs). */}
          <div className="planification__titre-bloc">
            {/* Bouton "Retour Dossier Candidat" retiré (refonte navigation, 2026-08-17) : couvert
                par le lien "Dossiers candidats" de la barre de navigation commune, voir
                BarreNavigation.jsx (montée dans PageBackOffice.jsx). Titre harmonisé avec le
                libellé "Suivi des tests" de cette même barre (ex-"Planification des tests"). */}
            <h1>Suivi des tests</h1>
          </div>
          <EnTeteBackOffice />
        </header>

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

          {/* Filtrage client (voir candidatCorrespond/rendezvousFiltres ci-dessus) : se combine
              avec aVenirSeulement/formateurFiltre sans logique dédiée, ceux-ci étant déjà
              appliqués côté back avant que cette recherche ne s'exécute sur le résultat. */}
          <label className="planification__filtre-recherche">
            <span>Candidat</span>
            <input
              type="search"
              value={rechercheCandidat}
              onChange={(evenement) => setRechercheCandidat(evenement.target.value)}
              placeholder="Nom ou prénom"
            />
          </label>
        </div>

        <div className="planification__actions-selection">
          <button type="button" disabled={dossiersSelectionnes.size === 0} onClick={ouvrirHistorique}>
            Voir l&rsquo;historique des rendez-vous sélectionnés
            {dossiersSelectionnes.size > 0 ? ` (${dossiersSelectionnes.size})` : ''}
          </button>
        </div>

        {chargement && <p>Chargement des rendez-vous…</p>}
        {erreur && <p role="alert">{erreur}</p>}

        {!chargement && !erreur && rendezvousTries.length === 0 && (
          <p className="planification__vide">Aucun rendez-vous de test à afficher.</p>
        )}

        {!chargement && !erreur && rendezvousTries.length > 0 && (
          <div className="planification__scroll">
            <table className="planification__table">
              <thead>
                <tr>
                  {/* Sélection de candidats (voir dossiersSelectionnes) — première colonne, figée
                      au défilement horizontal comme "N°"/"Date et heure"/"Candidat" juste après
                      elle (voir Planification.css, --planification-largeur-colonne-case décale
                      maintenant les trois autres). Case "tout sélectionner" : coche/décoche les
                      seuls candidats actuellement visibles (voir togglerSelectionnerTout). */}
                  <th scope="col" className="planification__colonne-case">
                    <input
                      type="checkbox"
                      checked={tousVisiblesSelectionnes}
                      onChange={togglerSelectionnerTout}
                      aria-label="Tout sélectionner"
                    />
                  </th>
                  {/* Numéro d'ordre = rang d'affichage (1, 2, 3...), pas rdv.id ni dossier_id —
                      recalculé à chaque tri, purement visuel. Figée en tête du bloc figé "Date et
                      heure"/"Candidat" ci-dessous (voir Planification.css,
                      --planification-largeur-colonne-numero). */}
                  <th scope="col" className="planification__colonne-numero">
                    N°
                  </th>
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
                {rendezvousTries.map((rdv, index) => (
                  <tr key={rdv.id}>
                    <td className="planification__colonne-case">
                      <input
                        type="checkbox"
                        checked={dossiersSelectionnes.has(rdv.dossier_id)}
                        onChange={() => togglerSelectionDossier(rdv.dossier_id)}
                        aria-label={`Sélectionner ${rdv.candidat_prenom} ${rdv.candidat_nom}`}
                      />
                    </td>
                    <td className="planification__colonne-numero">{index + 1}</td>
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
                    <td>{rdv.formateur_nom ? `${rdv.formateur_prenom} ${rdv.formateur_nom}` : '-'}</td>
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

        {panneauHistoriqueOuvert && (
          // key={compteurHistorique} : voir son commentaire de déclaration — force un remontage à
          // chaque clic sur "Voir l'historique...", même si le panneau était déjà affiché, pour que
          // son scrollIntoView interne et son chargement de données se redéclenchent sur la
          // nouvelle sélection plutôt que de rester figés sur la précédente.
          <PanneauHistoriqueRendezvous
            key={compteurHistorique}
            dossierIds={dossierIdsHistorique}
            onFermer={() => setPanneauHistoriqueOuvert(false)}
          />
        )}
      </div>
    </PageBackOffice>
  );
}
