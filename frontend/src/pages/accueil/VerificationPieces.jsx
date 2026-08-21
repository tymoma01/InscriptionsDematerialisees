import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import CaptureTablette from '../../core/pieceJustificative/CaptureTablette';
import NotesDossier from '../../core/dossier/NotesDossier';
import InformationsInscription from '../../core/dossier/InformationsInscription';
import NavigationFicheDossier from '../../core/dossier/NavigationFicheDossier';
import StatutBadge from '../../core/workflow/StatutBadge';
import { typesPiecesConfigAccecitTest } from '../../core/pieceJustificative/donneesTest/typesPiecesConfig.accecit';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import { obtenirDossier } from '../../services/dossierService';
import './VerificationPieces.css';

// Mapping purement visuel, propre à cette page (pas au moteur générique StatutBadge, voir
// Modularité CLAUDE.md) — même mapping que Validation.jsx (VARIANTE_PAR_CODE_ACCECIT), dupliqué
// plutôt que partagé (voir CLAUDE.md conventions du projet) : un code absent de ce mapping (autre
// entité, nouveau statut) retombe simplement sur un badge neutre plutôt que d'échouer. Badge
// ajouté sur cette fiche (audit 2026-08-21) : le statut du dossier n'y était jusque-là visible
// nulle part, alors que dossier.statut_code/statut_libelle est déjà chargé ci-dessous
// (obtenirDossier) pour le nom du candidat dans le titre.
const VARIANTE_PAR_CODE_ACCECIT = {
  // nouveau/test_non_planifie/test_realise ajoutés (workflow v5, audit 2026-08-21) — même mapping
  // que TableauDeBordAccueil.jsx, voir son commentaire d'en-tête pour le détail des choix de
  // couleur.
  nouveau: 'neutre',
  en_attente_pieces: 'attente',
  en_attente_verification: 'attente', // workflow hérité, plus jamais atteint
  test_non_planifie: 'attente',
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

// Libellés des postes (sélection de poste(s) testé(s), voir ModalePlanificationTest.jsx via
// CaptureTablette.jsx) — même mapping que TableauDeBordAccueil.jsx/Backoffice.jsx/Planification.jsx,
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

// Page accueil : prise des pièces justificatives (CLAUDE.md, étape 3 du parcours), une fois le
// candidat inscrit. Lit dossierId depuis le paramètre de route et transmet la config des types
// de pièces de l'entité — donnée de test locale tant que le backend n'expose pas cette
// configuration (voir typesPiecesConfig.accecit.js), même patron que InscriptionTablette.jsx
// pour formulaireConfig.accecit.js. CaptureTablette.jsx lui-même ne connaît pas le routage
// (voir son commentaire d'en-tête) : c'est cette page qui fait le lien. PageBackOffice fournit
// l'habillage commun aux pages back-office (en-tête/pied de page/filigrane, voir son commentaire
// d'en-tête) — première page à l'utiliser, voir aussi pages/admin/Utilisateurs.jsx.
export default function VerificationPieces() {
  const { dossierId } = useParams();

  // Nom du candidat affiché à côté du numéro de dossier dans le titre, même patron que
  // Validation.jsx/Relances.jsx (obtenirDossier, statut + nom/prénom déjà joints côté back) :
  // requête distincte de celle que CaptureTablette.jsx fait déjà en interne pour son propre
  // affichage "Candidat : NOM Prénom" — ce composant ne remonte pas ses données chargées à sa
  // page appelante (voir son commentaire d'en-tête), d'où ce second appel, purement informatif
  // et à l'échec silencieux (comme là-bas).
  const [dossier, setDossier] = useState(null);

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

  return (
    <PageBackOffice>
      <div className="page-verification-pieces">
        {/* Titre à gauche, EnTeteBackOffice (nom de l'agent + Déconnexion) à droite, même ligne
            — même patron que Relances.jsx/Planification.jsx (décision utilisateur, 2026-08-13/14).
            Bouton "Retour au tableau de bord" retiré (refonte navigation, 2026-08-17) : couvert
            par le lien "Dossiers candidats" de la barre de navigation commune, voir
            BarreNavigation.jsx (montée dans PageBackOffice.jsx). */}
        <header className="page-verification-pieces__entete">
          <div className="page-verification-pieces__titre-bloc">
            <h1>
              Dossier #{dossierId}
              {dossier && (
                <>
                  {' - '}
                  <span className="page-verification-pieces__candidat-nom">{dossier.candidat_nom}</span>{' '}
                  {dossier.candidat_prenom}
                </>
              )}
            </h1>
            {/* Même badge/mapping que Validation.jsx/Relances.jsx, pour que le statut reste
                visible depuis n'importe quel onglet de la fiche dossier. */}
            {dossier && (
              <div className="page-verification-pieces__statut">
                <span className="page-verification-pieces__statut-libelle">Statut :</span>
                <StatutBadge libelle={dossier.statut_libelle} variante={varianteStatut(dossier.statut_code)} />
              </div>
            )}
          </div>
          <EnTeteBackOffice />
        </header>

        {/* Bandeau d'accès rapide aux autres écrans du dossier (patch léger, décision utilisateur
            2026-08-21) — voir NavigationFicheDossier.jsx : jusque-là cet écran n'affichait ni le
            statut ni les sections "Rendez-vous"/"Relances" de Validation.jsx, sans aucun moyen d'y
            accéder sinon revenir au tableau de bord. */}
        <NavigationFicheDossier dossierId={dossierId} pageActuelle="pieces" />

        {/* Repositionnée juste sous le titre (audit 2026-08-20, décision utilisateur) —
            auparavant tout en bas de la fiche, après Pièces/Notes : composant partagé
            (core/dossier/InformationsInscription.jsx), même emplacement appliqué sur
            Validation.jsx/Relances.jsx/GrilleEvaluation.jsx pour rester cohérent partout où
            cette section apparaît. */}
        <InformationsInscription dossierId={dossierId} />

        <CaptureTablette
          dossierId={dossierId}
          typesPieces={typesPiecesConfigAccecitTest}
          statutCode={dossier?.statut_code}
          postesBureau={dossier?.postesBureau}
          postesHotel={dossier?.postesHotel}
          libellePoste={libellePoste}
        />
        <NotesDossier dossierId={dossierId} />
      </div>
    </PageBackOffice>
  );
}
