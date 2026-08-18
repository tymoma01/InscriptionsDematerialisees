import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import DossierList from '../../core/dossier/DossierList';
import FiltresStatut from '../../core/dossier/FiltresStatut';
import FiltresRechercheDossiers from '../../core/dossier/FiltresRechercheDossiers';
import { filtrerDossiers } from '../../core/dossier/filtrerDossiers';
import ModalePlanificationTest from '../../core/dossier/ModalePlanificationTest';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import { useSession } from '../../core/auth/useSession';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import { listerDossiers, listerStatuts } from '../../services/dossierService';
import './TableauDeBordAccueil.css';

// Code de la transition qui replanifie un test après un désistement (test_non_realise) ou un
// test invalidé (workflow v3 : les deux origines partagent ce même codeAction, vers
// test_planifie, voir workflow.config.json ACCECIT) — voir ModalePlanificationTest.jsx, qui ne
// connaît lui-même aucun statut ni codeAction en dur, c'est cette page qui décide depuis quelle
// action elle l'ouvre. Le moteur de transitions (workflowEngine.appliquerTransition) résout la
// bonne ligne transitions_statut à partir du statut réel du dossier, jamais choisie ici.
const CODE_ACTION_REPLANIFIER_TEST = 'replanifier_test';

// Statuts depuis lesquels le bouton "Replanifier" est proposé (voir Modularité, CLAUDE.md : reste
// propre à cette page/entité, pas au moteur générique DossierList). "invalide" remplace
// "verdict_negatif" (workflow v3, verdict_negatif retiré du parcours actif). "test_planifie"
// ajouté (workflow v4, retrait de en_attente_verdict, responsable de projet, 2026-07-31) : la
// replanification doit rester possible à tout moment tant que le dossier est encore test_planifie
// (pas de restriction de délai) — le codeAction replanifier_test porte alors une transition vers
// ce même statut (voir workflow.config.json), pas un changement d'état à proprement parler.
const STATUTS_REPLANIFIABLES = ['test_planifie', 'test_non_realise', 'invalide'];

// Statuts pour lesquels le bouton "Relances" a un sens concret pour l'agent Accueil — au-delà
// (dossier transmis au recruteur, verdict rendu, décision finale prise), la relance sort de son
// périmètre d'action, même logique de restriction que STATUTS_REPLANIFIABLES ci-dessus. Liste
// explicite plutôt que des conditions if/else dispersées dans le JSX : un seul endroit à modifier
// si le périmètre change, cohérent avec les autres listes de cette page (CODES_STATUTS_FILTRES_
// ACCUEIL, STATUTS_REPLANIFIABLES). "Pièces", lui, reste affiché pour tous les statuts sans
// exception (consultation des pièces déjà capturées toujours possible, même hors périmètre) —
// pas de `visible` sur cette action.
// "nouveau" absent : plus aucun dossier ne peut atteindre ce statut aujourd'hui (voir
// CODES_STATUTS_FILTRES_ACCUEIL, audit 2026-08-19) — n'apparaît de toute façon plus dans la liste
// filtrée par statut, cette entrée ne sert donc plus qu'à documenter l'historique du choix.
// "invalide" ajouté (workflow v3) : même logique que test_non_realise, une relance a un sens tant
// qu'une replanification est possible sur ce dossier.
const STATUTS_RELANCES_AUTORISEES = ['en_attente_pieces', 'test_planifie', 'test_non_realise', 'invalide'];

// Mapping purement visuel, propre à cette page (pas au moteur générique DossierList/StatutBadge,
// voir Modularité CLAUDE.md) — donnée de test locale au même titre que
// formulaireConfig.accecit.js le temps que `statuts` porte une polarité succès/échec/attente en
// base : un code absent de ce mapping (autre entité, nouveau statut) retombe simplement sur un
// badge neutre plutôt que d'échouer.
// Une variante distincte par statut (voir styles/variables.css, --statut-*) plutôt que les 4
// polarités génériques seules — même mapping que Backoffice.jsx (dupliqué plutôt que partagé :
// quelques lignes de données, pas de quoi justifier un module commun, voir CLAUDE.md conventions
// du projet).
const VARIANTE_PAR_CODE_ACCECIT = {
  // 'nouveau' retiré (audit 2026-08-19) : plus aucun dossier ne peut atteindre ce statut depuis
  // que dossierService.inscrireCandidat fait passer automatiquement en_attente_pieces à la fin
  // d'une inscription (transaction atomique) — les 20 derniers dossiers encore à "nouveau" (tous
  // antérieurs au moteur de workflow lui-même, 21/07/2026) ont été basculés rétroactivement, voir
  // scripts/basculerDossiersNouveauEnAttentePieces.js. Un code absent de ce mapping retombe de
  // toute façon sur le badge neutre (voir varianteStatut ci-dessous) : rien à afficher au cas où
  // la valeur "nouveau" réapparaîtrait un jour (elle reste dans l'enum en base, volontairement).
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

// Libellés des postes (colonne "Poste" de DossierList.jsx) — mêmes codes/libellés que
// BlocDisponibilites.jsx (POSTES_BUREAU/POSTES_HOTEL), dupliqué plutôt que partagé (même
// convention que VARIANTE_PAR_CODE_ACCECIT ci-dessus, voir CLAUDE.md conventions du projet) : un
// code absent (poste ajouté au formulaire mais pas encore ici) retombe simplement sur le code
// brut plutôt que d'échouer.
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
// 2026-08-04) — propre à cette page, pas au moteur générique FiltresStatut.jsx qui reste piloté
// entièrement par la prop `statuts` qu'on lui passe. "En attente de vérification" (workflow
// hérité) n'y figure volontairement pas : plus aucun dossier ne peut l'atteindre. "nouveau" retiré
// le 2026-08-19 pour la même raison (voir VARIANTE_PAR_CODE_ACCECIT ci-dessus) : plus aucune
// inscription ne peut aujourd'hui s'y arrêter, et les derniers dossiers résiduels ont été
// basculés vers en_attente_pieces.
const CODES_STATUTS_FILTRES_ACCUEIL = [
  'en_attente_pieces',
  'test_planifie',
  // Ajouté avec le bouton "Replanifier" (voir STATUTS_REPLANIFIABLES ci-dessous) : permet à
  // l'accueil d'isoler d'un coup les dossiers en attente de replanification après un test
  // invalidé, sans devoir les repérer dans la liste complète. "invalide" remplace
  // "verdict_negatif" (workflow v3, verdict_negatif retiré du parcours actif).
  'test_non_realise',
  'invalide',
  // Ajoutés pour couvrir les deux verdicts positifs (voir 9778d03) : sans ces deux entrées, les
  // dossiers validés (embauche directe ou envoi en formation) restaient visibles dans la liste
  // mais impossibles à isoler par filtre sur cette page, contrairement au back-office recruteur.
  'valide_envoi_formation',
  'valide_pret_embauche',
];

// Tableau de bord Accueil (CLAUDE.md, besoins Accueil/Coordination : "vue centralisée des
// dossiers en attente") — liste les dossiers de l'entité courante, filtrables par statut. Jusqu'à
// quatre actions par ligne : reprendre la prise de pièces (VerificationPieces, tous statuts),
// consulter/enregistrer une relance (Relances, historique des relances — voir
// HistoriqueRelances.jsx — restreint aux statuts où une relance a un sens, voir
// STATUTS_RELANCES_AUTORISEES), replanifier un test (voir STATUTS_REPLANIFIABLES), et étudier le
// dossier (Validation.jsx : pièces + export ZIP + transitions + notes + informations
// d'inscription complètes, tous statuts) — fusion de l'ancien Back-office recruteur
// (/recruteur/dossiers, supprimé) dans cette page, seule différence relevée à l'audit entre les
// deux tableaux (mêmes colonnes, mêmes filtres, même route API GET /api/dossiers, mêmes rôles
// ROLES_CONSULTATION_DOSSIERS côté back).
export default function TableauDeBordAccueil() {
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

  // Filtre "Entité" (Hôtellerie/Tertiaire) — même patron que Backoffice.jsx (recruteur) : deux
  // boutons indépendamment activables, jamais d'option "Toutes" dédiée (ferait doublon avec le
  // bouton "Tous" déjà porté par FiltresStatut ci-dessous), Set vide = aucune restriction.
  // Filtrage entièrement client (dossier.postesHotel/postesBureau déjà présents sur chaque
  // dossier renvoyé par GET /api/dossiers, voir filtrerDossiers.js), même mécanisme que
  // recherche/dateDebutFiltre/dateFinFiltre ci-dessus.
  const [entitesFiltre, setEntitesFiltre] = useState(() => new Set());

  function basculerEntiteFiltre(code) {
    setEntitesFiltre((precedent) => {
      const suivant = new Set(precedent);
      if (suivant.has(code)) suivant.delete(code);
      else suivant.add(code);
      return suivant;
    });
  }

  // Dossier sélectionné pour une replanification, ou null si le panneau est fermé — voir bouton
  // "Replanifier" plus bas et ModalePlanificationTest.jsx.
  const [dossierAReplanifier, setDossierAReplanifier] = useState(null);

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

  // Rechargement manuel après une replanification réussie (voir plus bas) : le dossier a changé
  // de statut (→ test_planifie), la vue filtrée par statut ainsi que les compteurs doivent
  // refléter ce changement.
  const rechargerDossiers = () => {
    listerDossiers()
      .then(setDossiers)
      .catch((erreur) => setErreur(erreur.response?.data?.erreur ?? 'Impossible de récupérer les dossiers.'));
  };

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
  // Volontairement PAS mutuellement exclusifs (audit 2026-08-18, point de vigilance "double
  // comptage") : un dossier avec à la fois un poste Hôtellerie et un poste Tertiaire (candidat
  // intéressé par les deux familles, cas permis par BlocDisponibilites.jsx) compte dans les deux
  // boutons plutôt que d'être arbitrairement rattaché à une seule "entité principale" — le
  // masquer d'un des deux filtres cacherait un candidat réellement pertinent au recruteur qui
  // consulte CE filtre. Ce choix implique Tous < Hôtellerie + Tertiaire si un tel dossier existe
  // un jour (aucun actuellement) : ce n'est pas un bug, "Tous" (filtrerDossiers.js) reste exact
  // car calculé comme le nombre de dossiers DISTINCTS ayant au moins un poste, pas comme la somme
  // de ces deux compteurs.
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
    () => statuts.filter((statut) => CODES_STATUTS_FILTRES_ACCUEIL.includes(statut.code)),
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
  // vaut le dire tout de suite (même principe que CaptureTablette.jsx).
  if (!utilisateur) {
    return (
      <PageBackOffice>
        <p role="alert">
          Vous devez être connecté pour accéder au tableau de bord. <Link to="/connexion">Se connecter</Link>
        </p>
      </PageBackOffice>
    );
  }

  return (
    <PageBackOffice>
      <div className="tableau-bord-accueil">
        <header className="tableau-bord-accueil__entete">
          <h1>Dossiers candidats</h1>
          {/* Bouton "Planification des tests" retiré (refonte navigation, 2026-08-17) : couvert
              par le lien "Suivi des tests" de la barre de navigation commune, voir
              BarreNavigation.jsx (montée dans PageBackOffice.jsx). */}
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
            <div className="tableau-bord-accueil__filtre-entite" role="group" aria-label="Filtrer par entité">
              <button
                type="button"
                className={entitesFiltre.has('hotel') ? 'actif' : ''}
                aria-pressed={entitesFiltre.has('hotel')}
                onClick={() => basculerEntiteFiltre('hotel')}
              >
                Hôtellerie <strong>({compteurHotel})</strong>
              </button>
              <button
                type="button"
                className={entitesFiltre.has('bureau') ? 'actif' : ''}
                aria-pressed={entitesFiltre.has('bureau')}
                onClick={() => basculerEntiteFiltre('bureau')}
              >
                Tertiaire <strong>({compteurBureau})</strong>
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
              { libelle: 'Pièces', onSelectionner: (dossier) => navigate(`/accueil/dossiers/${dossier.id}/pieces`) },
              {
                libelle: 'Relances',
                onSelectionner: (dossier) => navigate(`/coordination/dossiers/${dossier.id}/relances`),
                visible: (dossier) => STATUTS_RELANCES_AUTORISEES.includes(dossier.statut_code),
              },
              {
                libelle: 'Replanifier',
                onSelectionner: (dossier) => setDossierAReplanifier(dossier),
                visible: (dossier) => STATUTS_REPLANIFIABLES.includes(dossier.statut_code),
              },
              {
                libelle: 'Étudier le dossier',
                onSelectionner: (dossier) => navigate(`/recruteur/dossiers/${dossier.id}/validation`),
                // Toujours à l'extrême droite de la colonne Actions (voir DossierList.css) et
                // dans l'accent visuel back-office, pour rester repérable au premier coup d'œil
                // parmi Pièces/Relances/Replanifier — mêmes leviers génériques que DossierList.jsx
                // expose pour n'importe quelle action, pas propres à celle-ci.
                alignerADroite: true,
                accent: true,
              },
            ]}
          />
        )}

        {dossierAReplanifier && (
          <ModalePlanificationTest
            dossierId={dossierAReplanifier.id}
            codeAction={CODE_ACTION_REPLANIFIER_TEST}
            titre={`Replanifier un test - ${dossierAReplanifier.candidat_prenom} ${dossierAReplanifier.candidat_nom}`}
            postesBureau={dossierAReplanifier.postesBureau}
            postesHotel={dossierAReplanifier.postesHotel}
            libellePoste={libellePoste}
            onAnnuler={() => setDossierAReplanifier(null)}
            onReussite={() => {
              setDossierAReplanifier(null);
              rechargerDossiers();
            }}
          />
        )}
      </div>
    </PageBackOffice>
  );
}
