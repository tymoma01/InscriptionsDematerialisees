import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import CaptureTablette from '../../core/pieceJustificative/CaptureTablette';
import NotesDossier from '../../core/dossier/NotesDossier';
import InformationsInscription from '../../core/dossier/InformationsInscription';
import { typesPiecesConfigAccecitTest } from '../../core/pieceJustificative/donneesTest/typesPiecesConfig.accecit';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import { obtenirDossier } from '../../services/dossierService';
import './VerificationPieces.css';

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
          </div>
          <EnTeteBackOffice />
        </header>

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
