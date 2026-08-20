import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import HistoriqueRelances from '../../core/dossier/HistoriqueRelances';
import GestionRendezvous from '../../core/dossier/GestionRendezvous';
import NotesDossier from '../../core/dossier/NotesDossier';
import InformationsInscription from '../../core/dossier/InformationsInscription';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import { obtenirDossier } from '../../services/dossierService';
import './Relances.css';

// Page coordination : relances et rendez-vous d'un dossier (CLAUDE.md, étape "relances et
// reprogrammations"), les deux concernant le même besoin de suivi terrain — regroupées sur un
// même écran plutôt qu'éclatées, pour que la coordination voie en un coup d'œil l'historique des
// contacts ET les rendez-vous en cours. Lit dossierId depuis le paramètre de route et le
// transmet — ni HistoriqueRelances.jsx ni GestionRendezvous.jsx ne connaissent le routage, même
// patron que VerificationPieces.jsx pour CaptureTablette.jsx.
export default function Relances() {
  const { dossierId } = useParams();

  // Nom du candidat affiché à côté du numéro de dossier dans le titre, même patron que
  // Validation.jsx (obtenirDossier, statut + nom/prénom déjà joints côté back) : purement
  // informatif, un échec de chargement ne bloque donc pas le reste de l'écran (catch silencieux,
  // comme là-bas).
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
      <div className="page-relances">
        {/* Titre à gauche, EnTeteBackOffice (nom de l'agent + Déconnexion) à droite, même ligne
            — même patron que Planification.jsx/Indicateurs.jsx (décision utilisateur, 2026-08-13).
            Bouton "Retour au tableau de bord" retiré (refonte navigation, 2026-08-17) : couvert
            par le lien "Dossiers candidats" de la barre de navigation commune, voir
            BarreNavigation.jsx (montée dans PageBackOffice.jsx). */}
        <header className="page-relances__entete">
          <div className="page-relances__titre-bloc">
            <h1>
              Dossier #{dossierId}
              {dossier && (
                <>
                  {' - '}
                  <span className="page-relances__candidat-nom">{dossier.candidat_nom}</span> {dossier.candidat_prenom}
                </>
              )}
            </h1>
          </div>
          <EnTeteBackOffice />
        </header>

        {/* Repositionnée juste sous le titre (audit 2026-08-20, décision utilisateur) —
            auparavant tout en bas de la fiche, après Rendez-vous/Relances/Notes : composant
            partagé (core/dossier/InformationsInscription.jsx), même emplacement appliqué sur
            Validation.jsx/VerificationPieces.jsx/GrilleEvaluation.jsx pour rester cohérent
            partout où cette section apparaît. */}
        <InformationsInscription dossierId={dossierId} />

        <GestionRendezvous dossierId={dossierId} />
        <HistoriqueRelances dossierId={dossierId} />
        <NotesDossier dossierId={dossierId} />
      </div>
    </PageBackOffice>
  );
}
