import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import DossierList from '../../core/dossier/DossierList';
import FiltresStatut from '../../core/dossier/FiltresStatut';
import FiltresRechercheDossiers from '../../core/dossier/FiltresRechercheDossiers';
import { filtrerDossiers } from '../../core/dossier/filtrerDossiers';
import { useParametreURL, useEnsembleURL } from '../../core/filtres/useParametreURL';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import { useSession } from '../../core/auth/useSession';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import { listerDossiers, listerStatuts } from '../../services/dossierService';
import { useRafraichissementAuto } from '../../core/dossier/useRafraichissementAuto';
import './TableauDeBordAccueil.css';

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
  // 'nouveau' réintroduit (workflow v5, audit 2026-08-21) : redevenu réellement observable
  // ("Inscrit" persistant tant qu'aucune pièce n'a été capturée, voir dossierService.
  // inscrireCandidat/pieceJustificativeService.js) — était retiré depuis le 2026-08-19 tant que ce
  // statut n'était qu'un artefact transitoire (voir scripts/basculerDossiersNouveauEnAttentePieces.js
  // pour l'historique de ce retrait). 'neutre' plutôt que 'attente' : rien n'est encore en cours,
  // contrairement à en_attente_pieces (une collecte a débuté).
  nouveau: 'neutre',
  en_attente_pieces: 'attente',
  en_attente_verification: 'attente', // workflow hérité, plus jamais atteint
  // 'test_non_planifie' (workflow v5) : même famille que en_attente_pieces (le dossier attend une
  // action de la coordination, ici planifier le test plutôt que compléter les pièces).
  test_non_planifie: 'attente',
  test_planifie: 'bleu',
  // 'test_realise' (workflow v5) : violet, inutilisé ailleurs dans ce mapping — le test a eu lieu
  // mais aucun verdict n'est encore rendu, état à surveiller pour relancer un formateur qui tarde
  // à évaluer (CLAUDE.md, besoin Accueil/Coordination : "historique des relances").
  test_realise: 'violet',
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

// Tous les statuts réellement atteignables aujourd'hui dans le workflow actif — propre à cette
// page, pas au moteur générique FiltresStatut.jsx qui reste piloté entièrement par la prop
// `statuts` qu'on lui passe. "En attente de vérification" (workflow hérité) n'y figure
// volontairement pas : plus aucun dossier ne peut l'atteindre.
const CODES_STATUTS_FILTRES_ACCUEIL = [
  // "Inscrit" (audit 2026-08-21, complète l'ajout initial de Test non planifié/Test réalisé
  // ci-dessous) : redevenu réellement observable depuis le retrait de la bascule automatique
  // nouveau -> en_attente_pieces (workflow v5, point 1) — jusqu'ici visible seulement via "Tous",
  // sans bouton de filtre dédié pour l'isoler des dossiers déjà entrés en collecte de pièces.
  'nouveau',
  'en_attente_pieces',
  // "Test non planifié" (workflow v5) : pièces obligatoires complètes, test pas encore planifié —
  // même ordre que le workflow (voir workflow.config.json, ordre 25 entre en_attente_pieces=20 et
  // test_planifie=30) ; l'ORDRE de ce tableau lui-même n'a aucune incidence sur l'affichage
  // (statutsFiltres filtre `statuts`, déjà trié par `ordre` côté back, voir plus bas), seul
  // l'ensemble des codes retenus compte ici.
  'test_non_planifie',
  'test_planifie',
  // "Test réalisé" (workflow v5) : test confirmé tenu, évaluation pas encore soumise — utile pour
  // repérer un formateur/inspecteur qui tarde à évaluer (demande explicite, "relancer un formateur
  // qui tarde").
  'test_realise',
  // Permet à l'accueil d'isoler d'un coup les dossiers en attente de replanification après un
  // test invalidé, sans devoir les repérer dans la liste complète (voir Validation.jsx,
  // STATUTS_REPLANIFIABLES, pour l'action "Replanifier" elle-même). "invalide" remplace
  // "verdict_negatif" (workflow v3, verdict_negatif retiré du parcours actif).
  'test_non_realise',
  'invalide',
  // Ajoutés pour couvrir les deux verdicts positifs (voir 9778d03) : sans ces deux entrées, les
  // dossiers validés (embauche directe ou envoi en formation) restaient visibles dans la liste
  // mais impossibles à isoler par filtre sur cette page, contrairement au back-office recruteur.
  'valide_envoi_formation',
  'valide_pret_embauche',
];

// Codes agrégés sous le bouton "Test réalisé" (demande explicite, audit 2026-08-21) : à la
// différence de tous les autres boutons ci-dessus (correspondance stricte à un seul statut), ce
// filtre doit couvrir tout dossier dont le test a RÉELLEMENT EU LIEU, quel que soit le verdict
// déjà rendu ou non — test_realise (verdict pas encore soumis) ET les trois issues qui ne sont
// atteignables QU'après confirmer_test_realise (voir workflow.config.json, workflow v5 :
// valider_envoi_formation/valider_pret_embauche/invalider_test partent tous les trois de
// test_realise, plus jamais de test_planifie). Exclut sciemment test_non_realise (le test n'a
// précisément PAS eu lieu) et tout statut antérieur. Les boutons Invalidé/Validé - envoyé en
// formation/Validé - prêt à l'embauche restent, eux, des filtres stricts à un seul statut chacun
// (un agent qui clique "Invalidé" veut voir UNIQUEMENT les dossiers invalidés, pas les mélanger
// avec les deux autres issues) — seul "Test réalisé" a besoin de cette agrégation, propre à ce
// bouton. Codes des dossiers eux-mêmes jamais réécrits ni uniformisés par cette agrégation :
// chaque ligne du tableau garde son statut/badge réel (DossierList.jsx reste piloté par
// dossier.statut_code, pas par ce filtre), seule la logique de filtrage/comptage est concernée.
const CODES_STATUTS_TEST_REALISE_ACCECIT = ['test_realise', 'invalide', 'valide_envoi_formation', 'valide_pret_embauche'];
function codesPourFiltreStatut(code) {
  return code === 'test_realise' ? CODES_STATUTS_TEST_REALISE_ACCECIT : [code];
}

// Tableau de bord Accueil (CLAUDE.md, besoins Accueil/Coordination : "vue centralisée des
// dossiers en attente") — liste les dossiers de l'entité courante, filtrables par statut. Une
// seule action par ligne, "Étudier le dossier" (Validation.jsx : pièces + export ZIP +
// transitions + notes + informations d'inscription complètes, tous statuts) — fusion de l'ancien
// Back-office recruteur (/recruteur/dossiers, supprimé) dans cette page, seule différence relevée
// à l'audit entre les deux tableaux (mêmes colonnes, mêmes filtres, même route API
// GET /api/dossiers, mêmes rôles ROLES_CONSULTATION_DOSSIERS côté back).
// Les actions "Pièces"/"Relances"/"Replanifier", auparavant directement sur cette ligne,
// vivent désormais sur la fiche dossier elle-même (audit 2026-08-19, colonne Actions surchargée
// sur tablette — jusqu'à 4 boutons par ligne) : voir Validation.jsx, qui reste le seul et même
// écran de destination, pour ne pas éclater la fiche dossier en plusieurs pages divergentes selon
// l'entrée utilisée.
export default function TableauDeBordAccueil() {
  const { utilisateur, chargement: chargementSession } = useSession();
  const navigate = useNavigate();

  const [statuts, setStatuts] = useState([]);
  // Filtres persistés dans l'URL (query params) plutôt qu'en state React local (CLAUDE.md, retour
  // arrière navigateur depuis une fiche dossier : le filtre actif ne doit pas se perdre) — voir
  // useParametreURL.js. null = tous les statuts (comportement par défaut inchangé).
  const [statutFiltre, setStatutFiltre] = useParametreURL('statut', null);
  const [dossiers, setDossiers] = useState([]);
  const [chargementDossiers, setChargementDossiers] = useState(true);
  const [erreur, setErreur] = useState(null);

  // Recherche nom/prénom + plage de date, combinées au statutFiltre ci-dessus — filtrage
  // entièrement client (voir filtrerDossiers.js), la liste `dossiers` étant déjà intégralement en
  // mémoire.
  const [recherche, setRecherche] = useParametreURL('q', '');
  const [dateDebutFiltre, setDateDebutFiltre] = useParametreURL('date_debut', '');
  const [dateFinFiltre, setDateFinFiltre] = useParametreURL('date_fin', '');

  // Filtre "Entité" (Hôtellerie/Tertiaire) — même patron que Backoffice.jsx (recruteur) : deux
  // boutons indépendamment activables, jamais d'option "Toutes" dédiée (ferait doublon avec le
  // bouton "Tous" déjà porté par FiltresStatut ci-dessous), Set vide = aucune restriction.
  // Filtrage entièrement client (dossier.postesHotel/postesBureau déjà présents sur chaque
  // dossier renvoyé par GET /api/dossiers, voir filtrerDossiers.js), même mécanisme que
  // recherche/dateDebutFiltre/dateFinFiltre ci-dessus.
  const [entitesFiltre, basculerEntiteFiltre] = useEnsembleURL('entites');

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

  // Rafraîchissement automatique (audit 2026-08-24) : silencieux (ne touche jamais
  // chargementDossiers/erreur ci-dessus, réservés au chargement initial) — un échec ponctuel de
  // ce re-fetch en arrière-plan n'a pas à afficher d'erreur, le prochain tick réessaiera.
  useRafraichissementAuto(() => {
    listerDossiers()
      .then(setDossiers)
      .catch(() => {});
  });

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

  const dossiersFiltres = useMemo(() => {
    if (!statutFiltre) return dossiersFiltresSansStatut;
    const codes = codesPourFiltreStatut(statutFiltre);
    return dossiersFiltresSansStatut.filter((dossier) => codes.includes(dossier.statut_code));
  }, [dossiersFiltresSansStatut, statutFiltre]);

  const compteursParStatut = useMemo(() => {
    const compte = {};
    dossiersFiltresSansStatut.forEach((dossier) => {
      compte[dossier.statut_code] = (compte[dossier.statut_code] ?? 0) + 1;
    });
    // "Test réalisé" : compteur agrégé (voir CODES_STATUTS_TEST_REALISE_ACCECIT ci-dessus), pas
    // le simple compte de dossiers au statut test_realise seul — recalculé à partir des comptes
    // individuels déjà posés ci-dessus. Chacun des 4 codes garde par ailleurs SA propre valeur
    // pour son propre bouton (ex. compte.invalide reste le nombre réel de dossiers invalidés pour
    // le bouton "Invalidé" ci-dessous) : seule la clé 'test_realise' de cet objet est réécrite ici.
    compte.test_realise = CODES_STATUTS_TEST_REALISE_ACCECIT.reduce((somme, code) => somme + (compte[code] ?? 0), 0);
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
  // codesPourFiltreStatut (pas une simple égalité de code) : "Test réalisé" étant un filtre
  // agrégé (voir plus haut), ces deux compteurs doivent eux aussi compter les 4 statuts agrégés
  // quand ce bouton est actif, sous peine de rester bloqués sur le seul sous-ensemble test_realise
  // pendant que le tableau/compteur "Test réalisé" affichent déjà l'ensemble élargi.
  const compteurHotel = useMemo(
    () =>
      dossiersRechercheDate.filter(
        (dossier) =>
          (!statutFiltre || codesPourFiltreStatut(statutFiltre).includes(dossier.statut_code)) &&
          (dossier.postesHotel ?? []).length > 0,
      ).length,
    [dossiersRechercheDate, statutFiltre],
  );
  const compteurBureau = useMemo(
    () =>
      dossiersRechercheDate.filter(
        (dossier) =>
          (!statutFiltre || codesPourFiltreStatut(statutFiltre).includes(dossier.statut_code)) &&
          (dossier.postesBureau ?? []).length > 0,
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
              {
                libelle: 'Étudier le dossier',
                onSelectionner: (dossier) => navigate(`/recruteur/dossiers/${dossier.id}/validation`),
                // Style back-office accent (cadre séparé, dégradé brun/doré, largeur fixe forçant
                // le retour à la ligne "Étudier / le / dossier") conservé tel quel malgré le
                // retrait de Pièces/Relances/Replanifier (voir DossierList.css,
                // .dossier-list__action--accent) : mise en forme déjà validée avant la
                // simplification de la colonne Actions, pas de raison d'en changer maintenant que
                // ce bouton y est seul. `alignerADroite` retiré (audit 2026-08-19) : poussait le
                // bouton à l'extrême droite de la cellule, utile pour le distinguer des autres
                // actions quand elles existaient encore — seul restant, il est maintenant centré
                // via .dossier-list__actions (voir DossierList.css).
                accent: true,
              },
            ]}
          />
        )}
      </div>
    </PageBackOffice>
  );
}
