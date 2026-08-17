import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import DossierList from '../../core/dossier/DossierList';
import FiltresStatut from '../../core/dossier/FiltresStatut';
import FiltresRechercheDossiers from '../../core/dossier/FiltresRechercheDossiers';
import { filtrerDossiers } from '../../core/dossier/filtrerDossiers';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import { useSession } from '../../core/auth/useSession';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import { listerDossiers, listerStatuts } from '../../services/dossierService';
import './Backoffice.css';

// Mapping purement visuel, propre à cette page (pas au moteur générique DossierList/StatutBadge,
// voir Modularité CLAUDE.md) — même donnée de test locale que TableauDeBordAccueil.jsx, le temps
// que `statuts` porte une polarité succès/échec/attente en base.
// Une variante distincte par statut (voir styles/variables.css, --statut-*) plutôt que les 4
// polarités génériques seules — même mapping que TableauDeBordAccueil.jsx (dupliqué plutôt que
// partagé : quelques lignes de données, pas de quoi justifier un module commun, voir CLAUDE.md
// conventions du projet).
const VARIANTE_PAR_CODE_ACCECIT = {
  nouveau: 'neutre',
  en_attente_pieces: 'attente',
  en_attente_verification: 'attente', // workflow hérité, plus jamais atteint
  test_planifie: 'bleu',
  test_non_realise: 'alerte',
  invalide: 'echec',
  valide_envoi_formation: 'succes',
  valide_pret_embauche: 'vert-clair',
};
function varianteStatut(code) {
  return VARIANTE_PAR_CODE_ACCECIT[code] ?? 'neutre';
}

// Libellés des postes (colonne "Poste" de DossierList.jsx) — même mapping que
// TableauDeBordAccueil.jsx, dupliqué plutôt que partagé (voir CLAUDE.md conventions du projet).
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

// Tous les statuts réellement atteignables aujourd'hui dans le workflow actif (vérifié en base :
// `est_initial` ou cible d'une transition existante dans `transitions_statut`, entité ACCECIT,
// 2026-08-04) — même liste complète que CODES_STATUTS_FILTRES_ACCUEIL sur ce point, propre à
// cette page, pas au moteur générique FiltresStatut.jsx qui reste piloté entièrement par la prop
// `statuts` qu'on lui passe. "En attente de vérification" (workflow hérité) et
// en_attente_validation_recruteur/valide/rejete (workflow v3, voir migrerWorkflowAccecitV3.js/
// migrerWorkflowAccecitV4.js) n'y figurent volontairement pas : plus aucun dossier ne peut les
// atteindre, les 2 derniers de l'ancien circuit ayant été supprimés le 2026-08-04.
const CODES_STATUTS_FILTRES_RECRUTEUR = [
  'nouveau',
  'en_attente_pieces',
  'test_planifie',
  'test_non_realise',
  'invalide',
  'valide_envoi_formation',
  'valide_pret_embauche',
];

// Back-office recruteur (CLAUDE.md, section Rôles : "back-office complet") — liste des dossiers
// de l'entité courante, filtrables par statut, même moteur générique que le tableau de bord
// Accueil (DossierList/dossierService).
// "Étudier le dossier" renvoie vers Validation.jsx : depuis le workflow v3, la décision finale
// (validé/refusé, orientation formation/embauche) est prise directement par le formateur à
// l'issue du test - cette page reste une vue de consultation (pièces, historique, notes) pour le
// recruteur, plus un écran de décision (l'ancien circuit valider_dossier/rejeter_dossier a été
// retiré le 2026-08-04, voir migrerWorkflowAccecitV3.js/migrerWorkflowAccecitV4.js).
export default function Backoffice() {
  const { utilisateur, chargement: chargementSession } = useSession();
  const navigate = useNavigate();

  const [statuts, setStatuts] = useState([]);
  const [statutFiltre, setStatutFiltre] = useState(null); // null = tous les statuts
  const [dossiers, setDossiers] = useState([]);
  const [chargementDossiers, setChargementDossiers] = useState(true);
  const [erreur, setErreur] = useState(null);

  // Recherche nom/prénom + plage de date, combinées au statutFiltre déjà géré côté serveur
  // ci-dessus — filtrage entièrement client (voir filtrerDossiers.js), la liste `dossiers` étant
  // déjà intégralement en mémoire.
  const [recherche, setRecherche] = useState('');
  const [dateDebutFiltre, setDateDebutFiltre] = useState('');
  const [dateFinFiltre, setDateFinFiltre] = useState('');

  // Filtre "Entité" (Hôtellerie/Tertiaire) — même principe que le filtre Entité du tableau de bord
  // Indicateurs (typePoste), mais à choix MULTIPLE plutôt qu'un <select> à une seule valeur : deux
  // boutons indépendamment activables, jamais d'option "Toutes" dédiée (ferait doublon avec le
  // bouton "Tous" déjà porté par FiltresStatut ci-dessous) — Set vide = aucune restriction, les
  // deux à la fois équivaut au même résultat (voir filtrerDossiers.js). Filtrage entièrement
  // client comme recherche/dateDebutFiltre/dateFinFiltre ci-dessus : dossier.postesHotel/
  // postesBureau sont déjà présents sur chaque dossier renvoyé par GET /api/dossiers (voir
  // DossierList.jsx, colonne "Poste"), pas besoin d'un aller-retour serveur supplémentaire.
  const [entitesFiltre, setEntitesFiltre] = useState(() => new Set());

  function basculerEntiteFiltre(code) {
    setEntitesFiltre((precedent) => {
      const suivant = new Set(precedent);
      if (suivant.has(code)) suivant.delete(code);
      else suivant.add(code);
      return suivant;
    });
  }

  useEffect(() => {
    listerStatuts()
      .then(setStatuts)
      .catch(() => {
        // Filtres non critiques : la liste des dossiers ci-dessous reste consultable même si
        // ce second appel échoue, donc pas de message d'erreur bloquant pour si peu.
      });
  }, []);

  // Un seul chargement, tous statuts confondus (statutFiltre n'est plus un paramètre de requête,
  // voir son commentaire de déclaration) : le filtrage par statut se fait désormais entièrement
  // client, comme recherche/dateDebutFiltre/dateFinFiltre/entitesFiltre ci-dessous — nécessaire
  // pour calculer le compteur de CHAQUE bouton de statut (dossiersFiltresSansStatut ci-dessous) à
  // partir de la même liste en mémoire, plutôt que de ne connaître que le statut actuellement
  // sélectionné.
  useEffect(() => {
    let annule = false;
    setChargementDossiers(true);
    setErreur(null);
    listerDossiers()
      .then((valeur) => {
        if (!annule) setDossiers(valeur);
      })
      .catch((erreur) => {
        if (!annule) setErreur(erreur.response?.data?.erreur ?? 'Impossible de récupérer les dossiers.');
      })
      .finally(() => {
        if (!annule) setChargementDossiers(false);
      });
    return () => {
      annule = true;
    };
  }, []);

  // Recherche/dates uniquement (pas encore l'entité ni le statut) : base commune aux compteurs
  // "Hôtellerie"/"Tertiaire" ci-dessous, qui doivent chacun ignorer l'état courant du filtre
  // entité (Set) pour répondre à la question "combien de dossiers dans CETTE entité si je clique
  // ce bouton", indépendamment de l'autre bouton entité déjà actif ou non.
  const dossiersRechercheDate = useMemo(
    () => filtrerDossiers(dossiers, { recherche, dateDebutFiltre, dateFinFiltre, libellePoste, entitesFiltre: new Set() }),
    [dossiers, recherche, dateDebutFiltre, dateFinFiltre],
  );

  // Recherche/dates/entité (pas encore le statut) : c'est cette liste, group par statut_code, qui
  // donne le compteur de CHAQUE bouton de statut (y compris "Tous") — le nombre de résultats qu'on
  // obtiendrait en cliquant ce bouton compte tenu des autres filtres actifs.
  const dossiersFiltresSansStatut = useMemo(
    () => filtrerDossiers(dossiers, { recherche, dateDebutFiltre, dateFinFiltre, libellePoste, entitesFiltre }),
    [dossiers, recherche, dateDebutFiltre, dateFinFiltre, entitesFiltre],
  );

  const dossiersFiltres = useMemo(
    () =>
      statutFiltre
        ? dossiersFiltresSansStatut.filter((dossier) => dossier.statut_code === statutFiltre)
        : dossiersFiltresSansStatut,
    [dossiersFiltresSansStatut, statutFiltre],
  );

  const compteursParStatut = useMemo(() => {
    const compte = {};
    dossiersFiltresSansStatut.forEach((dossier) => {
      compte[dossier.statut_code] = (compte[dossier.statut_code] ?? 0) + 1;
    });
    return compte;
  }, [dossiersFiltresSansStatut]);

  // Compteur des boutons "Hôtellerie"/"Tertiaire" : recherche/dates/statut appliqués, entité
  // ignorée (voir dossiersRechercheDate ci-dessus) — chaque bouton compte comme si LUI SEUL était
  // sélectionné, pour rester cohérent avec le comportement de clic (Set, indépendamment activable).
  const compteurHotel = useMemo(
    () =>
      dossiersRechercheDate.filter(
        (dossier) => (!statutFiltre || dossier.statut_code === statutFiltre) && (dossier.postesHotel ?? []).length > 0,
      ).length,
    [dossiersRechercheDate, statutFiltre],
  );
  const compteurBureau = useMemo(
    () =>
      dossiersRechercheDate.filter(
        (dossier) => (!statutFiltre || dossier.statut_code === statutFiltre) && (dossier.postesBureau ?? []).length > 0,
      ).length,
    [dossiersRechercheDate, statutFiltre],
  );

  const statutsFiltres = useMemo(
    () => statuts.filter((statut) => CODES_STATUTS_FILTRES_RECRUTEUR.includes(statut.code)),
    [statuts],
  );

  if (chargementSession) {
    return (
      <PageBackOffice>
        <p>Chargement de la session…</p>
      </PageBackOffice>
    );
  }

  // Le back refuserait de toute façon (401/403) sans session valide ou rôle autorisé : mieux
  // vaut le dire tout de suite (même principe que TableauDeBordAccueil.jsx).
  if (!utilisateur) {
    return (
      <PageBackOffice>
        <p role="alert">
          Vous devez être connecté pour accéder au back-office. <Link to="/connexion">Se connecter</Link>
        </p>
      </PageBackOffice>
    );
  }

  return (
    <PageBackOffice>
      <div className="backoffice-recruteur">
        <header className="backoffice-recruteur__entete">
          <h1>Back-office recruteur</h1>
          {/* Bouton "Indicateurs" retiré (refonte navigation, 2026-08-17) : couvert par le lien
              "Tableau de bord" de la barre de navigation commune, voir BarreNavigation.jsx (montée
              dans PageBackOffice.jsx). */}
          <EnTeteBackOffice />
        </header>

        <FiltresRechercheDossiers
          recherche={recherche}
          onChangerRecherche={setRecherche}
          dateDebutFiltre={dateDebutFiltre}
          onChangerDateDebutFiltre={setDateDebutFiltre}
          dateFinFiltre={dateFinFiltre}
          onChangerDateFinFiltre={setDateFinFiltre}
        />
        <FiltresStatut
          statuts={statutsFiltres}
          statutFiltre={statutFiltre}
          onChangerStatutFiltre={setStatutFiltre}
          compteurTous={dossiersFiltresSansStatut.length}
          compteurs={compteursParStatut}
          filtresSupplementaires={
            <div className="backoffice-recruteur__filtre-entite" role="group" aria-label="Filtrer par entité">
              <button
                type="button"
                className={entitesFiltre.has('hotel') ? 'actif' : ''}
                aria-pressed={entitesFiltre.has('hotel')}
                onClick={() => basculerEntiteFiltre('hotel')}
              >
                Hôtellerie ({compteurHotel})
              </button>
              <button
                type="button"
                className={entitesFiltre.has('bureau') ? 'actif' : ''}
                aria-pressed={entitesFiltre.has('bureau')}
                onClick={() => basculerEntiteFiltre('bureau')}
              >
                Tertiaire ({compteurBureau})
              </button>
            </div>
          }
        />

        {chargementDossiers && <p>Chargement des dossiers…</p>}
        {erreur && <p role="alert">{erreur}</p>}

        {!chargementDossiers && !erreur && (
          <DossierList
            dossiers={dossiersFiltres}
            varianteStatut={varianteStatut}
            libellePoste={libellePoste}
            actions={[
              {
                libelle: 'Étudier le dossier',
                onSelectionner: (dossier) => navigate(`/recruteur/dossiers/${dossier.id}/validation`),
              },
            ]}
          />
        )}
      </div>
    </PageBackOffice>
  );
}
