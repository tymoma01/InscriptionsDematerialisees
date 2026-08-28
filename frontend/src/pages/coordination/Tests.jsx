import { useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import ModalePlanificationTest from '../../core/dossier/ModalePlanificationTest';
import NotesDossier from '../../core/dossier/NotesDossier';
import InformationsInscription from '../../core/dossier/InformationsInscription';
import NavigationFicheDossier from '../../core/dossier/NavigationFicheDossier';
import GestionRendezvous, { ROLES_GESTION_RENDEZVOUS } from '../../core/dossier/GestionRendezvous';
import StatutBadge from '../../core/workflow/StatutBadge';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import ErrorBoundary from '../../core/backOffice/ErrorBoundary';
import { useSession } from '../../core/auth/useSession';
import { obtenirDossier } from '../../services/dossierService';
import { useRafraichissementAuto } from '../../core/dossier/useRafraichissementAuto';
import { typesPiecesConfigAccecitTest } from '../../core/pieceJustificative/donneesTest/typesPiecesConfig.accecit';
import { STATUTS_TEST_NON_PLANIFIE } from '../../core/pieceJustificative/premierePlanificationTest';
import { usePiecesObligatoiresCompletes } from '../../core/pieceJustificative/usePiecesObligatoiresCompletes';
import './Tests.css';

// Mapping purement visuel, propre à cette page (pas au moteur générique StatutBadge, voir
// Modularité CLAUDE.md) — même mapping que Validation.jsx (VARIANTE_PAR_CODE_ACCECIT), dupliqué
// plutôt que partagé (voir CLAUDE.md conventions du projet) : un code absent de ce mapping (autre
// entité, nouveau statut) retombe simplement sur un badge neutre plutôt que d'échouer. Badge
// ajouté sur cette fiche (audit 2026-08-21) : le statut du dossier n'y était jusque-là visible
// nulle part, alors que dossier.statut_code/statut_libelle est déjà chargé ci-dessous
// (obtenirDossier, aussi utilisé par STATUTS_REPLANIFIABLES) pour le nom du candidat dans le
// titre.
const VARIANTE_PAR_CODE_ACCECIT = {
  // nouveau/test_non_planifie/test_realise ajoutés (workflow v5, audit 2026-08-21) — même mapping
  // que TableauDeBordAccueil.jsx, voir son commentaire d'en-tête pour le détail des choix de
  // couleur.
  nouveau: 'neutre',
  en_attente_pieces: 'attente',
  en_attente_verification: 'attente', // workflow hérité, plus jamais atteint
  // 'rose' (pas 'attente' ni 'neutre-fort', second correctif audit 2026-08-25) : voir
  // TableauDeBordAccueil.jsx, VARIANTE_PAR_CODE_ACCECIT, pour le détail des deux correctifs.
  test_non_planifie: 'rose',
  test_planifie: 'bleu',
  test_realise: 'violet',
  test_non_realise: 'alerte',
  invalide: 'echec',
  valide_envoi_formation: 'succes',
  valide_pret_embauche: 'vert-clair',
};
function varianteStatut(code) {
  return VARIANTE_PAR_CODE_ACCECIT[code] ?? 'neutre';
}

// Code de la transition qui replanifie un test après un désistement (test_non_realise) ou un
// test invalidé (workflow v3 : les deux origines partagent ce même codeAction, vers
// test_planifie, voir workflow.config.json ACCECIT) — voir ModalePlanificationTest.jsx, qui ne
// connaît lui-même aucun statut ni codeAction en dur, c'est cette page qui décide depuis quelle
// action elle l'ouvre. Le moteur de transitions (workflowEngine.appliquerTransition) résout la
// bonne ligne transitions_statut à partir du statut réel du dossier, jamais choisie ici. Même
// constante que Validation.jsx (dupliquée, pas partagée, avant sa suppression de là-bas — voir
// commentaire d'en-tête de Validation.jsx, section "Rendez-vous").
const CODE_ACTION_REPLANIFIER_TEST = 'replanifier_test';

// Code de la transition qui planifie le TOUT PREMIER test d'un dossier (voir workflow.config.json
// ACCECIT) — même constante que CaptureTablette.jsx (CODE_ACTION_PLANIFIER_TEST), onglet "Pièces
// justificatives", seul endroit où ce bouton vivait jusque-là (audit 2026-08-25) : proposé
// désormais aussi ici, sur l'onglet "Tests", dès que STATUTS_TEST_NON_PLANIFIE +
// piecesObligatoiresCompletes le permettent (voir plus bas), pour éviter à l'agent de repasser
// par l'onglet Pièces justificatives une fois les pièces obligatoires déjà toutes chargées.
const CODE_ACTION_PLANIFIER_TEST = 'planifier_test';

// Statuts depuis lesquels l'action "Replanifier" est proposée (voir Modularité, CLAUDE.md : reste
// propre à cette page/entité, pas au moteur générique GestionTransitions/ModalePlanificationTest).
// Même liste que Validation.jsx avant elle (section "Rendez-vous", déplacée ici en entier —
// décision utilisateur, 2026-08-21 : la replanification d'un test mérite son propre écran plutôt
// que de vivre en modale sur la fiche de décision du recruteur, cohérent avec CLAUDE.md qui range
// déjà "planifie les tests et reprogrammations" du côté Coordination).
// valide_envoi_formation/valide_pret_embauche ajoutés (audit 2026-08-21) — voir le commentaire de
// cette même constante dans Validation.jsx pour le détail.
const STATUTS_REPLANIFIABLES = [
  'test_planifie',
  'test_non_realise',
  'invalide',
  'valide_envoi_formation',
  'valide_pret_embauche',
];

// Libellés des postes (sélection de poste(s) testé(s) de ModalePlanificationTest.jsx) — même
// mapping que Validation.jsx/TableauDeBordAccueil.jsx/VerificationPieces.jsx/Planification.jsx,
// dupliqué plutôt que partagé (voir CLAUDE.md conventions du projet) : un code absent (poste
// ajouté au formulaire mais pas encore ici) retombe simplement sur le code brut plutôt que
// d'échouer.
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

// Page coordination : rendez-vous de test d'un dossier (replanification), extraite de
// Validation.jsx (audit 2026-08-21, décision utilisateur) — jusque-là la section "Rendez-vous" y
// restait volontairement en place (modale, pas de navigation), un choix qui datait d'avant
// l'introduction du bandeau NavigationFicheDossier.jsx : une fois ce bandeau en place, garder cette
// section uniquement sur /validation revenait à la rendre invisible/inaccessible depuis /pieces et
// /relances, comme c'était déjà le cas pour "Pièces"/"Relances" avant leur propre extraction. Même
// patron que Relances.jsx pour le chargement du dossier (obtenirDossier, purement informatif,
// échec silencieux) et le montage d'InformationsInscription/NotesDossier.
export default function Tests() {
  const { dossierId } = useParams();
  const location = useLocation();
  const { utilisateur } = useSession();

  const [dossier, setDossier] = useState(null);

  // RBAC identique à celui déjà en place pour ce même bouton dans l'onglet "Pièces
  // justificatives" (CaptureTablette.jsx) : là-bas, seuls Accueil/Coordination/Recruteur/Admin
  // atteignent même l'écran (pas de lien "Pièces justificatives" pour Formateur/Inspecteur, voir
  // BarreNavigation.jsx). Ici, l'onglet "Tests" est en revanche accessible à Formateur/Inspecteur
  // aussi (Suivi des tests, même barre) : ROLES_GESTION_RENDEZVOUS (réutilisée depuis
  // GestionRendezvous.jsx, même liste que le back — rendezvous.routes.js) rend ce masquage
  // explicite ici, pour ne pas leur proposer un bouton dont la création de rendez-vous serait de
  // toute façon refusée côté serveur.
  const peutPlanifierTest = ROLES_GESTION_RENDEZVOUS.includes(utilisateur?.roleCode);

  // Complétude des pièces obligatoires (voir premierePlanificationTest.js — même calcul
  // qu'utilise CaptureTablette.jsx pour ce même bouton, jamais dupliqué) : fetch indépendant de
  // celui de CaptureTablette.jsx (même patron que le reste de cet écran, ex. obtenirDossier
  // ci-dessous, déjà rechargé séparément par VerificationPieces.jsx).
  const { chargement: chargementPieces, piecesObligatoiresCompletes } = usePiecesObligatoiresCompletes(
    dossierId,
    typesPiecesConfigAccecitTest,
  );

  // Panneau de planification du TOUT PREMIER test (distinct de panneauReplanificationOuvert plus
  // bas, qui rouvre le même composant ModalePlanificationTest mais avec CODE_ACTION_REPLANIFIER_TEST).
  const [panneauPlanificationOuvert, setPanneauPlanificationOuvert] = useState(false);

  // Panneau de replanification (ModalePlanificationTest, voir plus bas) — ouvert/fermé, pas besoin
  // de retenir "quel dossier" (même raison que sur Validation.jsx avant elle) puisque cette page
  // est déjà scopée à un seul dossier via dossierId. Ouvert directement à l'arrivée si on vient du
  // lien "Replanifier un test" de Validation.jsx (state.ouvrirReplanification, voir ce fichier) —
  // décision utilisateur 2026-08-21 : l'agent a déjà exprimé son intention en cliquant là-bas, pas
  // besoin de recliquer une fois sur cet écran. Initialisé une seule fois (useState paresseux) :
  // un state de navigation ne doit rouvrir le panneau qu'à l'arrivée, pas le rouvrir tout seul si
  // l'agent le referme ensuite sans que dossierId ne change. Absent (arrivée directe par URL, ou
  // rechargement de page) : reste fermé, comme avant.
  const [panneauReplanificationOuvert, setPanneauReplanificationOuvert] = useState(
    () => Boolean(location.state?.ouvrirReplanification),
  );

  // Rechargement manuel après une replanification réussie (voir plus bas, ModalePlanificationTest
  // onReussite) : le statut du dossier a pu changer, or c'est lui qui pilote la visibilité de
  // l'action "Replanifier" ci-dessous (STATUTS_REPLANIFIABLES) — sans ce rechargement, l'action
  // resterait affichée/masquée selon le statut d'avant l'action tant que l'agent ne recharge pas
  // la page. Même patron que Validation.jsx avant elle.
  const rechargerDossier = () => {
    obtenirDossier(dossierId)
      .then(setDossier)
      .catch(() => {});
  };

  // Transmis à GestionRendezvous en prop `rafraichir` (voir son commentaire d'en-tête) : cette
  // page reste montée d'une planification à l'autre (dossierId inchangé), donc le rechargement du
  // dossier ci-dessus ne suffit pas à lui seul à forcer GestionRendezvous à recharger SA propre
  // liste de rendez-vous — sans ce compteur, l'ancien rendez-vous restait affiché jusqu'au
  // prochain passage de useRafraichissementAuto après une replanification.
  const [compteurRendezvous, setCompteurRendezvous] = useState(0);

  useEffect(() => {
    rechargerDossier();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dossierId]);

  // Rafraîchissement automatique (audit 2026-08-24) : réutilise rechargerDossier tel quel, même
  // fonction que le rechargement manuel post-replanification ci-dessus.
  useRafraichissementAuto(rechargerDossier);

  // Dossier sans premier test encore planifié — même liste de statuts que CaptureTablette.jsx
  // (STATUTS_TEST_NON_PLANIFIE, voir son import plus haut), jamais recalculée séparément.
  const dossierTestNonPlanifie = Boolean(dossier) && STATUTS_TEST_NON_PLANIFIE.includes(dossier.statut_code);
  // Condition complète d'affichage du bouton "Valider et planifier un test" — dérivée une seule
  // fois, réutilisée à la fois pour le bouton lui-même et pour décider si le message
  // "Replanification indisponible..." doit encore s'afficher en dessous.
  const dossierPeutPlanifierTest =
    dossierTestNonPlanifie && peutPlanifierTest && !chargementPieces && piecesObligatoiresCompletes;

  return (
    <PageBackOffice>
      <div className="page-tests">
        <header className="page-tests__entete">
          <div className="page-tests__titre-bloc">
            <h1>
              Dossier #{dossierId}
              {dossier && (
                <>
                  {' - '}
                  <span className="page-tests__candidat-nom">{dossier.candidat_nom}</span> {dossier.candidat_prenom}
                </>
              )}
            </h1>
            {/* Même badge/mapping que Validation.jsx/Relances.jsx/VerificationPieces.jsx, pour
                que le statut reste visible depuis n'importe quel onglet de la fiche dossier. */}
            {dossier && (
              <div className="page-tests__statut">
                <span className="page-tests__statut-libelle">Statut :</span>
                <StatutBadge libelle={dossier.statut_libelle} variante={varianteStatut(dossier.statut_code)} />
              </div>
            )}
          </div>
          <EnTeteBackOffice />
        </header>

        <NavigationFicheDossier dossierId={dossierId} pageActuelle="tests" />

        {/* Mode dégradé du back-office (audit 2026-08-24) — chaque section garde son propre
            chargement de données indépendant, ErrorBoundary ajoute le filet manquant côté RENDU :
            un plantage n'empêche plus la consultation des autres sections de cette fiche.
            key={dossierId} sur chacune pour repartir d'un état propre si l'agent change de
            dossier. */}
        <ErrorBoundary key={`inscription-${dossierId}`} titre="Informations d'inscription complètes">
          <InformationsInscription dossierId={dossierId} />
        </ErrorBoundary>

        <section className="page-tests__rendezvous">
          <div className="page-tests__rendezvous-entete">
            <h2>Rendez-vous</h2>
            {dossier && STATUTS_REPLANIFIABLES.includes(dossier.statut_code) && (
              <button className="page-tests__action" type="button" onClick={() => setPanneauReplanificationOuvert(true)}>
                Replanifier un test
              </button>
            )}
            {/* Même bouton que CaptureTablette.jsx (onglet "Pièces justificatives"), même
                condition (STATUTS_TEST_NON_PLANIFIE + piecesObligatoiresCompletes, voir
                premierePlanificationTest.js) et même RBAC (ROLES_GESTION_RENDEZVOUS) — proposé
                ici pour que l'agent n'ait plus à repasser par l'onglet Pièces justificatives une
                fois les pièces obligatoires déjà toutes chargées (demande utilisateur,
                2026-08-25). */}
            {dossierPeutPlanifierTest && (
              <button className="page-tests__action" type="button" onClick={() => setPanneauPlanificationOuvert(true)}>
                Valider et planifier un test
              </button>
            )}
          </div>
          {dossier && !STATUTS_REPLANIFIABLES.includes(dossier.statut_code) && !dossierPeutPlanifierTest && (
            <p className="page-tests__rendezvous-indisponible">
              {/* Explicite la raison réelle (demande utilisateur, 2026-08-25) plutôt qu'un message
                  générique qui ne dit pas pourquoi — seul le cas "pièces obligatoires manquantes"
                  a une raison à expliciter ici : le statut lui-même (dossierTestNonPlanifie) et le
                  RBAC (peutPlanifierTest) ne concernent jamais l'agent qui les lit (un agent sans
                  droit de planification ne voit de toute façon aucun des deux boutons sur aucun
                  onglet). */}
              {dossierTestNonPlanifie && peutPlanifierTest && !chargementPieces
                ? 'Le test ne peut être planifié tant que les pièces obligatoires ne sont pas toutes chargées.'
                : 'Replanification indisponible pour le statut actuel de ce dossier.'}
            </p>
          )}

          {/* Dernier rendez-vous seulement (voir GestionRendezvous.jsx, prop dernierSeulement) —
              pas l'historique complet des replanifications, déjà consultable sur l'onglet
              "Relances" (Relances.jsx, seul autre point de montage de ce composant). Même style
              que là-bas (timeline/titre "Test"/badge/motif/actions Confirmer-Marquer absent-
              Marquer annulé), sans dupliquer cette logique d'affichage ici. ErrorBoundary posée
              seulement sur GestionRendezvous, pas toute la <section> : le bouton "Replanifier un
              test" ci-dessus doit rester cliquable même si l'affichage du dernier rendez-vous
              plante. */}
          <ErrorBoundary key={`rendezvous-${dossierId}`} titre="Rendez-vous">
            <GestionRendezvous
              dossierId={dossierId}
              codeStatutDossier={dossier?.statut_code}
              libelleStatutDossier={dossier?.statut_libelle}
              dernierSeulement
              rafraichir={compteurRendezvous}
            />
          </ErrorBoundary>
        </section>

        {panneauReplanificationOuvert && dossier && (
          <ErrorBoundary key={`replanification-${dossierId}`} titre="Replanifier un test">
            <ModalePlanificationTest
              dossierId={dossierId}
              codeAction={CODE_ACTION_REPLANIFIER_TEST}
              titre={`Replanifier un test - ${dossier.candidat_prenom} ${dossier.candidat_nom}`}
              postesBureau={dossier.postesBureau}
              postesHotel={dossier.postesHotel}
              libellePoste={libellePoste}
              onAnnuler={() => setPanneauReplanificationOuvert(false)}
              onReussite={() => {
                setPanneauReplanificationOuvert(false);
                rechargerDossier();
                setCompteurRendezvous((compteur) => compteur + 1);
              }}
            />
          </ErrorBoundary>
        )}

        {/* Premier test (jamais encore planifié) — même composant/mêmes props que
            CaptureTablette.jsx (dossierId/codeAction/postesBureau/postesHotel/libellePoste),
            juste ouvert depuis ce bouton-ci plutôt que depuis l'onglet Pièces justificatives. */}
        {panneauPlanificationOuvert && dossier && (
          <ErrorBoundary key={`planification-${dossierId}`} titre="Planifier un test">
            <ModalePlanificationTest
              dossierId={dossierId}
              codeAction={CODE_ACTION_PLANIFIER_TEST}
              titre={`Planifier un test - ${dossier.candidat_prenom} ${dossier.candidat_nom}`}
              postesBureau={dossier.postesBureau}
              postesHotel={dossier.postesHotel}
              libellePoste={libellePoste}
              onAnnuler={() => setPanneauPlanificationOuvert(false)}
              onReussite={() => {
                setPanneauPlanificationOuvert(false);
                rechargerDossier();
                setCompteurRendezvous((compteur) => compteur + 1);
              }}
            />
          </ErrorBoundary>
        )}

        <ErrorBoundary key={`notes-${dossierId}`} titre="Notes">
          <NotesDossier dossierId={dossierId} />
        </ErrorBoundary>
      </div>
    </PageBackOffice>
  );
}
