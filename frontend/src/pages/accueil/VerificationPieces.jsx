import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import CaptureTablette from '../../core/pieceJustificative/CaptureTablette';
import { typesPiecesConfigAccecitTest } from '../../core/pieceJustificative/donneesTest/typesPiecesConfig.accecit';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import { obtenirDossier } from '../../services/dossierService';
import './VerificationPieces.css';

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
        <h1>
          Dossier #{dossierId}
          {dossier && (
            <>
              {' — '}
              <span className="page-verification-pieces__candidat-nom">{dossier.candidat_nom}</span>{' '}
              {dossier.candidat_prenom}
            </>
          )}
        </h1>
        <CaptureTablette dossierId={dossierId} typesPieces={typesPiecesConfigAccecitTest} />
      </div>
    </PageBackOffice>
  );
}
