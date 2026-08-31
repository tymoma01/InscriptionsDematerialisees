import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import NotesDossier from '../../core/dossier/NotesDossier';
import InformationsInscription from '../../core/dossier/InformationsInscription';
import NavigationFicheDossier from '../../core/dossier/NavigationFicheDossier';
import StatutBadge from '../../core/workflow/StatutBadge';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import ErrorBoundary from '../../core/backOffice/ErrorBoundary';
import ModaleForcerStatut from '../../core/dossier/ModaleForcerStatut';
import ModaleMarquerEmbauche from '../../core/dossier/ModaleMarquerEmbauche';
import { useSession } from '../../core/auth/useSession';
import { listerPiecesJustificatives } from '../../services/pieceJustificativeService';
import { obtenirDossier, listerStatuts } from '../../services/dossierService';
import { forcerStatut, marquerEmbauche } from '../../services/transitionService';
import { useRafraichissementAuto } from '../../core/dossier/useRafraichissementAuto';
import api from '../../services/api';
import './Validation.css';

// Rôle autorisé pour le changement de statut manuel/forcé (audit RBAC 2026-08-31, décision
// utilisateur) — Admin SEUL, contrairement à ROLES_GESTION_TRANSITIONS (backend,
// transitions.routes.js) : littéral en dur plutôt qu'une constante partagée, même choix déjà fait
// par BoutonNouvelleInscription.jsx/Connexion.jsx (voir leur commentaire respectif) faute
// d'équivalent front de backend/src/core/auth/rbac.js. La vraie garde reste côté serveur
// (ROLES_FORCER_STATUT, transitions.routes.js) — ce test ne fait que masquer le bouton pour les
// autres rôles.
const ROLE_ADMIN = 'admin';
// Rôle autorisé pour "Marquer comme embauché" (audit 2026-08-31, nouveau statut terminal
// "Embauché") — même littéral en dur qu'ailleurs sur cette page (voir ROLE_ADMIN ci-dessus), même
// raison : pas d'équivalent front de backend/src/core/auth/rbac.js. La vraie garde reste côté
// serveur (ROLES_MARQUER_EMBAUCHE, transitions.routes.js).
const ROLE_ACCUEIL_COORDINATION = 'accueil_coordination';

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

// Statuts depuis lesquels l'action "Replanifier" a un sens concret — affichage du lien "Rendez-vous"
// uniquement, la vraie garde reste côté Tests.jsx (voir Modularité, CLAUDE.md : reste propre à
// cette page/entité, pas au moteur générique GestionTransitions/ModalePlanificationTest). Même
// liste que Tests.jsx (dupliquée, pas partagée, voir CLAUDE.md conventions du projet) — section
// "Rendez-vous" extraite sur son propre écran (décision utilisateur, 2026-08-21), cette page-ci
// n'ouvre plus ModalePlanificationTest elle-même, juste un lien vers /tests.
// valide_envoi_formation/valide_pret_embauche ajoutés (audit 2026-08-21) : workflow.config.json
// porte désormais une transition replanifier_test depuis ces deux statuts (un candidat déjà
// validé peut avoir besoin d'un nouveau test, ex. changement de poste) — même liste que
// workflowEngine.appliquerTransition, qui neutralise déjà (jamais ne supprime) l'ancien rendez-vous
// actif du dossier via neutralise_rendezvous_actifs.
const STATUTS_REPLANIFIABLES = [
  'test_planifie',
  'test_non_realise',
  'invalide',
  'valide_envoi_formation',
  'valide_pret_embauche',
];

// Statuts pour lesquels l'accès aux relances a un sens concret — au-delà (dossier transmis au
// recruteur, verdict rendu, décision finale prise), la relance sort du périmètre d'action, même
// logique de restriction que STATUTS_REPLANIFIABLES ci-dessus. "Pièces", lui, reste accessible
// pour tous les statuts sans exception (consultation/reprise de la capture toujours possible,
// même hors périmètre) — pas de garde équivalente sur son lien. Même liste que l'ancien
// TableauDeBordAccueil.jsx (déplacée, pas dupliquée).
const STATUTS_RELANCES_AUTORISEES = ['en_attente_pieces', 'test_planifie', 'test_non_realise', 'invalide'];

// Mapping purement visuel, propre à cette page (pas au moteur générique StatutBadge, voir
// Modularité CLAUDE.md) — même mapping que TableauDeBordAccueil.jsx (VARIANTE_PAR_CODE_ACCECIT),
// dupliqué plutôt que partagé (voir CLAUDE.md conventions du projet) : un code absent de ce
// mapping (autre entité, nouveau statut) retombe simplement sur un badge neutre plutôt que
// d'échouer. Badge ajouté sur cette fiche (audit 2026-08-19) pour que le statut du dossier reste
// visible sans revenir au tableau "Dossiers candidats".
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
  // Suivi de formation (audit 2026-08-28) : 'echec-fort', distinct de 'echec' ("Invalidé") — voir
  // VerificationPieces.jsx pour le détail du choix de couleur.
  formation_non_validee: 'echec-fort',
  // Statut terminal "Embauché" (audit 2026-08-31) : 'vert-fonce', troisième teinte verte de ce
  // funnel après 'succes' (valide_envoi_formation) et 'vert-clair' (valide_pret_embauche) — voir
  // variables.css pour le détail du choix.
  embauche: 'vert-fonce',
};
function varianteStatut(code) {
  return VARIANTE_PAR_CODE_ACCECIT[code] ?? 'neutre';
}

// Badge "En attente"/"Validée"/"Rejetée" retiré (audit 2026-08-19) : ces trois valeurs de
// pieces_justificatives.statut_verification ne sont modifiables que par PATCH
// /api/dossiers/:dossierId/pieces/:pieceId (pieceJustificativeService.mettreAJourStatutVerificationPieceJustificative),
// jamais appelée par aucun écran — aucun bouton "Valider"/"Rejeter" n'existe nulle part dans
// l'app. Résultat : ce badge restait figé sur "En attente" pour toute pièce de tout dossier,
// quel que soit son contenu réel — une donnée trompeuse plutôt qu'un simple indicateur incomplet.
// Route et colonne conservées telles quelles (aucune décision de les retirer, juste de ne plus
// les afficher ici) pour une éventuelle implémentation complète du circuit de vérification.
//
// 'orpheline' (migration 046) reste affichée : fichier disparu du stockage documentaire
// (OneDrive/SharePoint), constaté par le SYSTÈME (export ZIP, scripts/marquerPiecesOrphelines.js),
// pas par une relecture humaine jamais faite — signal fiable, contrairement aux trois autres.
// Toute pièce qui n'est pas 'orpheline' est donc simplement "Reçue" : chaque ligne de cette liste
// vient de listerPiecesJustificatives (pièces déjà chargées), même donnée que dejaCapturee sur
// VerificationPieces.jsx/CaptureTablette.jsx (coche verte "présente") — juste affichée ici sous
// forme de badge plutôt que de coche, pour rester cohérente avec la mise en page existante de
// cette liste (libellé/badge/date).
const LIBELLE_PIECE_ORPHELINE = 'À recapturer (fichier perdu)';

// Écran détail dossier pour le recruteur (CLAUDE.md : "indicateur de complétude") — dossierId
// vient du paramètre de route (à la différence des composants génériques de core/, cette page
// connaît le routage, même patron que VerificationPieces.jsx / Relances.jsx).
//
// Depuis le workflow v3 (simplification du parcours, responsable de projet), la décision finale
// est prise directement par le formateur à l'issue du test (voir evaluationEngine.js) : cette
// page n'est donc plus un écran de décision, mais une vue de consultation + actions dédiées
// (pièces, rendez-vous, relances, notes). Le bloc générique GestionTransitions ("Décision",
// boutons "Passer à « … »") a été retiré du rendu (audit 2026-08-19) : il appliquait des
// transitions sans les effets de bord que les flux dédiés écrivent en plus (rendez-vous créé par
// ModalePlanificationTest, évaluation enregistrée par evaluationEngine) — même risque que le
// bouton planifier_test déjà exclu plus tôt. Le composant lui-même reste inchangé et réutilisable
// (voir son commentaire d'en-tête, GestionTransitions.jsx) : rien n'a été retiré côté
// workflowEngine/transitions_statut/transition_roles.
//
// L'indicateur de complétude reste partiel : la liste des pièces déjà reçues avec leur statut de
// vérification (réutilise le service déjà utilisé par CaptureTablette.jsx), pas un ratio "X/Y
// pièces obligatoires" — cela demanderait d'exposer le catalogue `types_pieces` de l'entité, pas
// encore fait côté API.
export default function Validation() {
  const { dossierId } = useParams();
  const { utilisateur } = useSession();
  const estAdmin = utilisateur?.roleCode === ROLE_ADMIN;
  // "Marquer comme embauché" (audit 2026-08-31) : Accueil/Coordination OU Admin — contrairement à
  // estAdmin ci-dessus (réservé au changement de statut forcé), les deux rôles y ont accès.
  const peutMarquerEmbauche = [ROLE_ACCUEIL_COORDINATION, ROLE_ADMIN].includes(utilisateur?.roleCode);

  const [pieces, setPieces] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);

  // Nom du candidat affiché à côté du numéro de dossier dans le titre, même patron que
  // CaptureTablette.jsx (obtenirDossier, statut + nom/prénom déjà joints côté back) : purement
  // informatif, un échec de chargement ne bloque donc pas le reste de l'écran de décision
  // (catch silencieux, comme là-bas).
  const [dossier, setDossier] = useState(null);

  // Changement de statut manuel/forcé (audit RBAC 2026-08-31) — statuts de l'entité et état de la
  // modale, seulement utiles pour Admin (voir estAdmin plus bas) : jamais chargés pour les autres
  // rôles, GET /dossiers/statuts leur étant de toute façon fermé côté serveur
  // (ROLES_CONSULTATION_DOSSIERS, dossiers.routes.js) — un fetch inutile échouerait en 403 pour
  // rien.
  const [statuts, setStatuts] = useState([]);
  const [modaleForcerStatutOuverte, setModaleForcerStatutOuverte] = useState(false);
  const [forcageEnCours, setForcageEnCours] = useState(false);
  const [erreurForcage, setErreurForcage] = useState(null);

  // "Marquer comme embauché" (audit 2026-08-31) — même patron que le changement de statut forcé
  // ci-dessus (modale de confirmation + état en cours/erreur dédiés).
  const [modaleEmbaucheOuverte, setModaleEmbaucheOuverte] = useState(false);
  const [embaucheEnCours, setEmbaucheEnCours] = useState(false);
  const [erreurEmbauche, setErreurEmbauche] = useState(null);

  useEffect(() => {
    let annule = false;
    obtenirDossier(dossierId)
      .then((valeur) => {
        if (!annule) setDossier(valeur);
      })
      .catch(() => {});
    return () => {
      annule = true;
    };
  }, [dossierId]);

  useEffect(() => {
    if (!estAdmin) return undefined;
    let annule = false;
    listerStatuts()
      .then((valeur) => {
        if (!annule) setStatuts(valeur);
      })
      .catch(() => {});
    return () => {
      annule = true;
    };
  }, [estAdmin]);

  const rechargerDossierApresTransition = () => {
    obtenirDossier(dossierId)
      .then(setDossier)
      .catch(() => {});
  };

  const gererForcageStatut = async (statutCode, commentaire) => {
    setForcageEnCours(true);
    setErreurForcage(null);
    try {
      await forcerStatut(dossierId, { statutCode, commentaire });
      setModaleForcerStatutOuverte(false);
      rechargerDossierApresTransition();
    } catch (erreur) {
      // Modale gardée ouverte (même patron que SuiviFormation.jsx/ModaleResultatFormation.jsx) :
      // l'agent peut corriger/retenter sans retaper son commentaire depuis zéro.
      setErreurForcage(
        erreur.response
          ? (erreur.response.data?.erreur ?? "Impossible de forcer ce changement de statut. Merci de réessayer.")
          : 'Connexion au serveur impossible. Vérifiez le réseau et réessayez.',
      );
    } finally {
      setForcageEnCours(false);
    }
  };

  const gererMarquerEmbauche = async (dateEmbauche, commentaire) => {
    setEmbaucheEnCours(true);
    setErreurEmbauche(null);
    try {
      await marquerEmbauche(dossierId, { commentaire, dateEmbauche });
      setModaleEmbaucheOuverte(false);
      rechargerDossierApresTransition();
    } catch (erreur) {
      // Modale gardée ouverte, même patron que gererForcageStatut ci-dessus.
      setErreurEmbauche(
        erreur.response
          ? (erreur.response.data?.erreur ?? "Impossible d'enregistrer cette embauche. Merci de réessayer.")
          : 'Connexion au serveur impossible. Vérifiez le réseau et réessayez.',
      );
    } finally {
      setEmbaucheEnCours(false);
    }
  };

  useEffect(() => {
    let annule = false;
    setChargement(true);
    setErreur(null);
    listerPiecesJustificatives(dossierId)
      .then((valeur) => {
        if (!annule) setPieces(valeur);
      })
      .catch((erreur) => {
        if (!annule) setErreur(erreur.response?.data?.erreur ?? 'Impossible de récupérer les pièces justificatives.');
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, [dossierId]);

  // Rafraîchissement automatique (audit 2026-08-24) : les deux fetches de cette page (titre +
  // liste de pièces) sont indépendants de tout formulaire en cours de saisie — sans risque à
  // recharger silencieusement les deux.
  useRafraichissementAuto(() => {
    obtenirDossier(dossierId)
      .then(setDossier)
      .catch(() => {});
    listerPiecesJustificatives(dossierId)
      .then(setPieces)
      .catch(() => {});
  });

  return (
    <PageBackOffice>
      <div className="page-validation">
        {/* Titre + EnTeteBackOffice regroupés dans un même <header> (audit 2026-08-28, correctif
            alignement) — même patron que VerificationPieces.jsx/Tests.jsx/Relances.jsx (les 3
            autres onglets de cette même fiche dossier) : EnTeteBackOffice y vivait jusqu'ici seul,
            en dehors de toute ligne de titre, ce qui laissait sa propre justify-content:
            space-between interne s'étirer sur toute la largeur de la page ("Mon profil" collé à
            gauche, le nom de l'agent centré, "Déconnexion" collé à droite) au lieu de rester
            groupé à droite comme partout ailleurs dans l'app. Bouton "Retour au tableau de bord"
            retiré (refonte navigation, 2026-08-17) : couvert par le lien "Back-office recruteur"
            de la barre de navigation commune, voir BarreNavigation.jsx (montée dans
            PageBackOffice.jsx). */}
        <header className="page-validation__entete">
          <div className="page-validation__titre-ligne">
            <h1>
              Dossier #{dossierId}
              {dossier && (
                <>
                  {' - '}
                  <span className="page-validation__candidat-nom">{dossier.candidat_nom}</span> {dossier.candidat_prenom}
                </>
              )}
            </h1>
            {/* Aligné à l'extrême droite de la ligne de titre (voir .page-validation__titre-ligne,
                justify-content: space-between — un seul enfant supplémentaire ici, "Statut :" +
                badge regroupés dans ce <div> pour rester collés l'un à l'autre plutôt que
                potentiellement séparés par le space-between à deux enfants) — même badge/mapping
                que le tableau "Dossiers candidats" (TableauDeBordAccueil.jsx), pour que le statut
                reste visible sans y retourner. */}
            {dossier && (
              <div className="page-validation__statut">
                <span className="page-validation__statut-libelle">Statut :</span>
                <StatutBadge libelle={dossier.statut_libelle} variante={varianteStatut(dossier.statut_code)} />
              </div>
            )}
          </div>
          <EnTeteBackOffice />
        </header>

        {/* Bandeau d'accès rapide aux autres écrans du dossier (patch léger, décision utilisateur
            2026-08-21) — voir NavigationFicheDossier.jsx : évite de perdre le fil en arrivant sur
            /pieces ou /relances, qui n'affichaient jusque-là aucun moyen de revenir ici ni d'aller
            à l'autre écran sans repasser par le tableau de bord. */}
        <NavigationFicheDossier dossierId={dossierId} pageActuelle="validation" />

        {/* Repositionnée juste sous le titre/statut (audit 2026-08-20, décision utilisateur) —
            auparavant tout en bas de la fiche, après Pièces/Rendez-vous/Relances/Notes : composant
            partagé (core/dossier/InformationsInscription.jsx), même emplacement appliqué sur
            VerificationPieces.jsx/Relances.jsx/GrilleEvaluation.jsx pour rester cohérent partout
            où cette section apparaît. */}
        {/* Mode dégradé du back-office (audit 2026-08-24) — chaque section garde son propre
            chargement de données indépendant, ErrorBoundary ajoute le filet manquant côté RENDU :
            un plantage n'empêche plus la consultation des autres sections de cette fiche.
            key={dossierId} pour repartir d'un état propre si l'agent change de dossier. Pas posée
            sur "Rendez-vous"/"Relances" plus bas : simples liens statiques dérivés de `dossier`
            (déjà chargé pour le titre), aucun chargement de données qui leur soit propre. */}
        <ErrorBoundary key={`inscription-${dossierId}`} titre="Informations d'inscription complètes">
          <InformationsInscription dossierId={dossierId} />
        </ErrorBoundary>

        <ErrorBoundary key={`pieces-${dossierId}`} titre="Pièces justificatives">
          <section className="page-validation__pieces">
            <div className="page-validation__pieces-entete">
              <h2>Pièces justificatives</h2>
              {/* Vers l'écran de capture/reprise des pièces (CaptureTablette.jsx via
                  VerificationPieces.jsx) — cette section-ci reste une simple liste de consultation
                  (voir son commentaire d'en-tête plus haut), ce lien est le seul moyen d'ajouter ou
                  de remplacer une pièce depuis la fiche dossier. Déplacé depuis
                  TableauDeBordAccueil.jsx (bouton "Pièces", audit 2026-08-19) : accessible pour
                  tous les statuts, sans exception, même comportement que là-bas. */}
              <Link className="page-validation__action" to={`/accueil/dossiers/${dossierId}/pieces`}>
                Gérer les pièces justificatives
              </Link>
              {/* Téléchargement réel (pas un aperçu intégré) : lien classique plutôt qu'un fetch en
                  blob (voir CaptureTablette.jsx pour l'inverse) — le back pose déjà
                  Content-Disposition: attachment (voir pieces.routes.js), le navigateur gère le
                  téléchargement seul via le cookie de session (same-origin). Visible seulement s'il
                  y a quelque chose à exporter. */}
              {!chargement && !erreur && pieces.length > 0 && (
                <a
                  className="page-validation__bouton-export-zip"
                  href={`${api.defaults.baseURL}/dossiers/${dossierId}/pieces/export-zip`}
                  download
                >
                  Télécharger toutes les pièces (ZIP)
                </a>
              )}
            </div>

            {chargement && <p>Chargement…</p>}
            {erreur && <p role="alert">{erreur}</p>}

            {!chargement && !erreur && pieces.length === 0 && (
              <p className="page-validation__pieces-vide">Aucune pièce reçue pour ce dossier.</p>
            )}

            {!chargement && !erreur && pieces.length > 0 && (
              <ul className="page-validation__pieces-liste">
                {pieces.map((piece) => (
                  <li key={piece.id}>
                    <span className="page-validation__piece-libelle">{piece.type_piece_libelle}</span>
                    {piece.statut_verification === 'orpheline' ? (
                      <span className="page-validation__piece-statut page-validation__piece-statut--orpheline">
                        {LIBELLE_PIECE_ORPHELINE}
                      </span>
                    ) : (
                      <span className="page-validation__piece-statut page-validation__piece-statut--recue">
                        ✓ Reçue
                      </span>
                    )}
                    <span className="page-validation__piece-date">
                      {FORMAT_DATE.format(new Date(piece.date_upload))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </ErrorBoundary>

        {/* Section "Rendez-vous" (action "Replanifier") — extraite sur son propre écran
            (Tests.jsx, décision utilisateur 2026-08-21) : n'ouvre plus ModalePlanificationTest en
            place, reste un lien vers l'écran dédié, même patron que "Relances" juste en dessous.
            Avant cette extraction, cette section restait volontairement inline (voir historique
            git) — un choix qui datait d'avant l'introduction du bandeau NavigationFicheDossier.jsx
            : une fois ce bandeau en place, une action inline ici restait invisible depuis
            /pieces et /relances. Gardée par STATUTS_REPLANIFIABLES, même règle de disponibilité
            par statut qu'avant. */}
        <section className="page-validation__rendezvous">
          <div className="page-validation__rendezvous-entete">
            <h2>Rendez-vous</h2>
            {dossier && STATUTS_REPLANIFIABLES.includes(dossier.statut_code) && (
              <Link
                className="page-validation__action"
                to={`/coordination/dossiers/${dossierId}/tests`}
                state={{ ouvrirReplanification: true }}
              >
                Replanifier un test
              </Link>
            )}
          </div>
          {dossier && !STATUTS_REPLANIFIABLES.includes(dossier.statut_code) && (
            <p className="page-validation__rendezvous-indisponible">
              Replanification indisponible pour le statut actuel de ce dossier.
            </p>
          )}
        </section>

        {/* Section "Relances" (déplacée depuis TableauDeBordAccueil.jsx, audit 2026-08-19) — reste
            un lien vers Relances.jsx (historique + formulaire d'ajout, GestionRendezvous), pas une
            fusion en place : cet écran gère aussi la confirmation de présence/désistement des
            rendez-vous existants, hors périmètre de cette fiche. Gardée par
            STATUTS_RELANCES_AUTORISEES, même règle de disponibilité par statut qu'avant ce
            déplacement. */}
        <section className="page-validation__relances">
          <div className="page-validation__relances-entete">
            <h2>Relances</h2>
            {/* Aligné à droite du titre de section, même pattern que "Pièces justificatives"/
                "Rendez-vous" juste au-dessus (voir .page-validation__pieces-entete/
                -rendezvous-entete) — auparavant seul sous le titre, décision utilisateur
                2026-08-19. */}
            {dossier && STATUTS_RELANCES_AUTORISEES.includes(dossier.statut_code) && (
              <Link className="page-validation__action" to={`/coordination/dossiers/${dossierId}/relances`}>
                Voir l&rsquo;historique et enregistrer une relance
              </Link>
            )}
          </div>
          {dossier && !STATUTS_RELANCES_AUTORISEES.includes(dossier.statut_code) && (
            <p className="page-validation__relances-indisponible">
              Relance indisponible pour le statut actuel de ce dossier.
            </p>
          )}
        </section>

        {/* "Marquer comme embauché" (audit 2026-08-31, nouveau statut terminal "Embauché", après
            "Validé - prêt à l'embauche") — Accueil/Coordination OU Admin, contrairement au bloc
            "Décision" ci-dessous (estAdmin seul) : action normale du parcours (transition
            marquer_embauche déclarée dans transitions_statut, voir workflow.config.json), pas un
            contournement, donc pas réservée à Admin. Visible uniquement quand le statut courant du
            dossier est précisément "valide_pret_embauche" — la transition serait de toute façon
            refusée côté serveur pour tout autre statut (workflowEngine.appliquerTransition), ce
            garde-fou n'évite qu'un aller-retour réseau inutile pour un bouton qui n'aurait aucun
            sens à afficher ailleurs dans le parcours. */}
        {peutMarquerEmbauche && dossier?.statut_code === 'valide_pret_embauche' && (
          <ErrorBoundary key={`embauche-${dossierId}`} titre="Embauche">
            <section className="page-validation__embauche">
              <div className="page-validation__embauche-entete">
                <h2>Embauche</h2>
                <button
                  type="button"
                  className="page-validation__action"
                  onClick={() => setModaleEmbaucheOuverte(true)}
                >
                  Marquer comme embauché
                </button>
              </div>
              <p className="page-validation__embauche-description">
                Confirme que le candidat est venu signer son contrat et récupérer sa tenue — demande
                la date d&rsquo;embauche et un commentaire, tous deux obligatoires.
              </p>
            </section>
          </ErrorBoundary>
        )}

        {peutMarquerEmbauche && modaleEmbaucheOuverte && dossier && (
          <ModaleMarquerEmbauche
            dossier={dossier}
            enCours={embaucheEnCours}
            erreur={erreurEmbauche}
            onAnnuler={() => {
              setModaleEmbaucheOuverte(false);
              setErreurEmbauche(null);
            }}
            onConfirmer={gererMarquerEmbauche}
          />
        )}

        {/* Bloc "Décision" (GestionTransitions) masqué sur cette fiche (audit 2026-08-19, voir
            rapport dans la conversation) : les boutons qu'il expose (replanifier_test,
            invalider_test, valider_envoi_formation, valider_pret_embauche, test_non_realise)
            appliquent une transition générique sans passer par les flux dédiés qui, eux,
            écrivent aussi les données liées (ModalePlanificationTest crée le rendez-vous,
            evaluationEngine enregistre l'évaluation) — même risque que le bouton planifier_test
            déjà retiré (incident dossier #75). Composant et route API (transitionService.js)
            volontairement INTACTS : GestionTransitions reste générique et réutilisable telle
            quelle si un futur écran en a besoin — voir son commentaire d'en-tête, qui ne connaît
            lui-même aucune page appelante en dur. L'outil d'override Admin envisagé ici (voir
            versions précédentes de ce commentaire) est finalement une modale dédiée ci-dessous
            (ModaleForcerStatut.jsx), pas ce composant : GestionTransitions reste borné aux
            transitions normales de `transitions_statut` (une seule origine possible chacune),
            alors que le changement de statut forcé doit pouvoir cibler N'IMPORTE QUEL statut
            indépendamment du statut courant — un besoin structurellement différent. */}
        {estAdmin && (
          <ErrorBoundary key={`forcer-statut-${dossierId}`} titre="Changement de statut manuel/forcé">
            <section className="page-validation__forcer-statut">
              <div className="page-validation__forcer-statut-entete">
                <h2>Changement de statut manuel/forcé</h2>
                <button
                  type="button"
                  className="page-validation__action page-validation__action--danger"
                  onClick={() => setModaleForcerStatutOuverte(true)}
                  disabled={!dossier || statuts.length === 0}
                >
                  Forcer le statut
                </button>
              </div>
              <p className="page-validation__forcer-statut-description">
                Réservé au rôle Admin — place le dossier directement sur le statut choisi, en
                dehors du parcours normal (voir la modale de confirmation pour le détail des effets
                de bord).
              </p>
            </section>
          </ErrorBoundary>
        )}

        {estAdmin && modaleForcerStatutOuverte && dossier && (
          <ModaleForcerStatut
            dossier={dossier}
            statuts={statuts}
            enCours={forcageEnCours}
            erreur={erreurForcage}
            onAnnuler={() => {
              setModaleForcerStatutOuverte(false);
              setErreurForcage(null);
            }}
            onConfirmer={gererForcageStatut}
          />
        )}

        <ErrorBoundary key={`notes-${dossierId}`} titre="Notes">
          <NotesDossier dossierId={dossierId} />
        </ErrorBoundary>
      </div>
    </PageBackOffice>
  );
}
