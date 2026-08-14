import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import CaptureTablette from '../../core/pieceJustificative/CaptureTablette';
import NotesDossier from '../../core/dossier/NotesDossier';
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
        {/* Lien "Retour" + titre à gauche, EnTeteBackOffice ("Agent connecté" + Déconnexion) à
            droite, même ligne — même patron que Relances.jsx/Planification.jsx (décision
            utilisateur, 2026-08-13/14). Remplace l'ancien EnTeteBackOffice + bouton "Retour"
            portés par CaptureTablette.jsx lui-même (voir son commentaire d'en-tête) : déplacés
            ici pour que "Retour" précède bien le titre du dossier, que CaptureTablette.jsx ne
            connaît pas (dossierId lui est transmis en prop, voir son en-tête). */}
        <header className="page-verification-pieces__entete">
          <div className="page-verification-pieces__titre-bloc">
            <Link to="/accueil/tableau-de-bord" className="page-verification-pieces__bouton-retour">
              Retour au tableau de bord
            </Link>
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
