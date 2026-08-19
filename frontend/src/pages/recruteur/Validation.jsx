import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ModalePlanificationTest from '../../core/dossier/ModalePlanificationTest';
import NotesDossier from '../../core/dossier/NotesDossier';
import InformationsInscription from '../../core/dossier/InformationsInscription';
import StatutBadge from '../../core/workflow/StatutBadge';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import { listerPiecesJustificatives } from '../../services/pieceJustificativeService';
import { obtenirDossier } from '../../services/dossierService';
import api from '../../services/api';
import './Validation.css';

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

// Code de la transition qui replanifie un test après un désistement (test_non_realise) ou un
// test invalidé (workflow v3 : les deux origines partagent ce même codeAction, vers
// test_planifie, voir workflow.config.json ACCECIT) — voir ModalePlanificationTest.jsx, qui ne
// connaît lui-même aucun statut ni codeAction en dur, c'est cette page qui décide depuis quelle
// action elle l'ouvre. Le moteur de transitions (workflowEngine.appliquerTransition) résout la
// bonne ligne transitions_statut à partir du statut réel du dossier, jamais choisie ici.
// Déplacé depuis TableauDeBordAccueil.jsx (audit 2026-08-19, colonne Actions surchargée) : le
// bouton "Replanifier" vit désormais directement sur la fiche dossier plutôt que sur la ligne du
// tableau.
const CODE_ACTION_REPLANIFIER_TEST = 'replanifier_test';

// Statuts depuis lesquels l'action "Replanifier" est proposée (voir Modularité, CLAUDE.md : reste
// propre à cette page/entité, pas au moteur générique GestionTransitions/ModalePlanificationTest).
// "invalide" remplace "verdict_negatif" (workflow v3, verdict_negatif retiré du parcours actif).
// "test_planifie" inclus (workflow v4, retrait de en_attente_verdict, responsable de projet,
// 2026-07-31) : la replanification doit rester possible à tout moment tant que le dossier est
// encore test_planifie (pas de restriction de délai) — le codeAction replanifier_test porte alors
// une transition vers ce même statut (voir workflow.config.json), pas un changement d'état à
// proprement parler. Même liste que l'ancien TableauDeBordAccueil.jsx (déplacée, pas dupliquée :
// cette page en est désormais la seule utilisatrice).
const STATUTS_REPLANIFIABLES = ['test_planifie', 'test_non_realise', 'invalide'];

// Statuts pour lesquels l'accès aux relances a un sens concret — au-delà (dossier transmis au
// recruteur, verdict rendu, décision finale prise), la relance sort du périmètre d'action, même
// logique de restriction que STATUTS_REPLANIFIABLES ci-dessus. "Pièces", lui, reste accessible
// pour tous les statuts sans exception (consultation/reprise de la capture toujours possible,
// même hors périmètre) — pas de garde équivalente sur son lien. Même liste que l'ancien
// TableauDeBordAccueil.jsx (déplacée, pas dupliquée).
const STATUTS_RELANCES_AUTORISEES = ['en_attente_pieces', 'test_planifie', 'test_non_realise', 'invalide'];

// Libellés des postes (sélection de poste(s) testé(s) de ModalePlanificationTest.jsx) — même
// mapping que TableauDeBordAccueil.jsx/VerificationPieces.jsx/Planification.jsx, dupliqué plutôt
// que partagé (voir CLAUDE.md conventions du projet) : un code absent (poste ajouté au formulaire
// mais pas encore ici) retombe simplement sur le code brut plutôt que d'échouer.
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

// Mapping purement visuel, propre à cette page (pas au moteur générique StatutBadge, voir
// Modularité CLAUDE.md) — même mapping que TableauDeBordAccueil.jsx (VARIANTE_PAR_CODE_ACCECIT),
// dupliqué plutôt que partagé (voir CLAUDE.md conventions du projet) : un code absent de ce
// mapping (autre entité, nouveau statut) retombe simplement sur un badge neutre plutôt que
// d'échouer. Badge ajouté sur cette fiche (audit 2026-08-19) pour que le statut du dossier reste
// visible sans revenir au tableau "Dossiers candidats".
const VARIANTE_PAR_CODE_ACCECIT = {
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

  const [pieces, setPieces] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);

  // Panneau de replanification (ModalePlanificationTest, voir plus bas) — ouvert/fermé, plus
  // besoin de retenir "quel dossier" (contrairement à l'ancien dossierAReplanifier de
  // TableauDeBordAccueil.jsx) puisque cette page est déjà scopée à un seul dossier via dossierId.
  const [panneauReplanificationOuvert, setPanneauReplanificationOuvert] = useState(false);

  // Nom du candidat affiché à côté du numéro de dossier dans le titre, même patron que
  // CaptureTablette.jsx (obtenirDossier, statut + nom/prénom déjà joints côté back) : purement
  // informatif, un échec de chargement ne bloque donc pas le reste de l'écran de décision
  // (catch silencieux, comme là-bas).
  const [dossier, setDossier] = useState(null);

  // Rechargement manuel après une replanification réussie (voir plus bas, ModalePlanificationTest
  // onReussite) : le statut du dossier a pu changer, or c'est lui qui pilote la visibilité des
  // actions "Replanifier"/"Relances" ci-dessous (STATUTS_REPLANIFIABLES/
  // STATUTS_RELANCES_AUTORISEES) — sans ce rechargement, ces actions resteraient affichées/
  // masquées selon le statut d'avant l'action tant que l'agent ne recharge pas la page.
  const rechargerDossier = () => {
    obtenirDossier(dossierId)
      .then(setDossier)
      .catch(() => {});
  };

  useEffect(() => {
    rechargerDossier();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dossierId]);

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

  return (
    <PageBackOffice>
      <div className="page-validation">
        <EnTeteBackOffice />
        {/* Bouton "Retour au tableau de bord" retiré (refonte navigation, 2026-08-17) : couvert
            par le lien "Back-office recruteur" de la barre de navigation commune, voir
            BarreNavigation.jsx (montée dans PageBackOffice.jsx). */}
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

        {/* Section "Rendez-vous" (action "Replanifier", déplacée depuis TableauDeBordAccueil.jsx,
            audit 2026-08-19) — disponible "directement sur la fiche dossier" (décision produit),
            contrairement à Pièces/Relances qui restent des liens vers leurs écrans dédiés : ouvre
            ModalePlanificationTest en place, sans navigation. Gardée par STATUTS_REPLANIFIABLES,
            même règle de disponibilité par statut qu'avant ce déplacement. */}
        <section className="page-validation__rendezvous">
          <div className="page-validation__rendezvous-entete">
            <h2>Rendez-vous</h2>
            {dossier && STATUTS_REPLANIFIABLES.includes(dossier.statut_code) && (
              <button className="page-validation__action" type="button" onClick={() => setPanneauReplanificationOuvert(true)}>
                Replanifier un test
              </button>
            )}
          </div>
          {dossier && !STATUTS_REPLANIFIABLES.includes(dossier.statut_code) && (
            <p className="page-validation__rendezvous-indisponible">
              Replanification indisponible pour le statut actuel de ce dossier.
            </p>
          )}
        </section>

        {panneauReplanificationOuvert && dossier && (
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
            }}
          />
        )}

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

        {/* Bloc "Décision" (GestionTransitions) masqué sur cette fiche (audit 2026-08-19, voir
            rapport dans la conversation) : les boutons qu'il expose (replanifier_test,
            invalider_test, valider_envoi_formation, valider_pret_embauche, test_non_realise)
            appliquent une transition générique sans passer par les flux dédiés qui, eux,
            écrivent aussi les données liées (ModalePlanificationTest crée le rendez-vous,
            evaluationEngine enregistre l'évaluation) — même risque que le bouton planifier_test
            déjà retiré (incident dossier #75). Composant et route API (transitionService.js)
            volontairement INTACTS : GestionTransitions reste générique et réutilisable telle
            quelle si un futur écran (ex. un outil d'override Admin) en a besoin — voir son
            commentaire d'en-tête, qui ne connaît lui-même aucune page appelante en dur. */}
        <NotesDossier dossierId={dossierId} />
        <InformationsInscription dossierId={dossierId} />
      </div>
    </PageBackOffice>
  );
}
