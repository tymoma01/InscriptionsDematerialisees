import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import GestionTransitions from '../../core/dossier/GestionTransitions';
import NotesDossier from '../../core/dossier/NotesDossier';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import { listerPiecesJustificatives } from '../../services/pieceJustificativeService';
import { obtenirDossier } from '../../services/dossierService';
import api from '../../services/api';
import './Validation.css';

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

const LIBELLES_STATUT_VERIFICATION = { en_attente: 'En attente', valide: 'Validée', rejete: 'Rejetée' };

// Écran détail dossier pour le recruteur (CLAUDE.md : "indicateur de complétude") — dossierId
// vient du paramètre de route (à la différence des composants génériques de core/, cette page
// connaît le routage, même patron que VerificationPieces.jsx / Relances.jsx).
//
// Depuis le workflow v3 (simplification du parcours, responsable de projet), la décision finale
// est prise directement par le formateur à l'issue du test (voir evaluationEngine.js) : cette
// page n'est donc plus un écran de décision pour le recruteur, mais une vue de consultation
// (pièces, historique via GestionTransitions/NotesDossier) — GestionTransitions reste générique
// et n'affiche simplement plus aucune action pour un dossier dont le statut ne propose aucune
// transition au rôle RECRUTEUR (voir workflow.config.json). Exception temporaire : les 2 derniers
// dossiers encore en_attente_validation_recruteur via l'ancien circuit (voir
// migrerWorkflowAccecitV3.js) y verront encore valider_dossier/rejeter_dossier le temps d'être
// clos.
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

  // Nom du candidat affiché à côté du numéro de dossier dans le titre, même patron que
  // CaptureTablette.jsx (obtenirDossier, statut + nom/prénom déjà joints côté back) : purement
  // informatif, un échec de chargement ne bloque donc pas le reste de l'écran de décision
  // (catch silencieux, comme là-bas).
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
        {/* Aligné à droite, juste sous Déconnexion — même patron que
            .capture-tablette__retour-ligne (CaptureTablette.css). */}
        <div className="page-validation__retour-ligne">
          <Link to="/recruteur/dossiers" className="page-validation__bouton-retour">
            Retour au tableau de bord
          </Link>
        </div>
        <div className="page-validation__titre-ligne">
          <h1>
            Dossier #{dossierId}
            {dossier && (
              <>
                {' — '}
                <span className="page-validation__candidat-nom">{dossier.candidat_nom}</span> {dossier.candidat_prenom}
              </>
            )}
          </h1>
        </div>

        <section className="page-validation__pieces">
          <div className="page-validation__pieces-entete">
            <h2>Pièces justificatives</h2>
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
                  <span
                    className={`page-validation__piece-statut page-validation__piece-statut--${piece.statut_verification}`}
                  >
                    {LIBELLES_STATUT_VERIFICATION[piece.statut_verification] ?? piece.statut_verification}
                  </span>
                  <span className="page-validation__piece-date">
                    {FORMAT_DATE.format(new Date(piece.date_upload))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <GestionTransitions dossierId={dossierId} />
        <NotesDossier dossierId={dossierId} />
      </div>
    </PageBackOffice>
  );
}
