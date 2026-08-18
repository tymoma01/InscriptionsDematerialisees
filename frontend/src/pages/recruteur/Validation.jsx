import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import GestionTransitions from '../../core/dossier/GestionTransitions';
import NotesDossier from '../../core/dossier/NotesDossier';
import InformationsInscription from '../../core/dossier/InformationsInscription';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import { listerPiecesJustificatives } from '../../services/pieceJustificativeService';
import { obtenirDossier } from '../../services/dossierService';
import api from '../../services/api';
import './Validation.css';

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

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

        <GestionTransitions dossierId={dossierId} />
        <NotesDossier dossierId={dossierId} />
        <InformationsInscription dossierId={dossierId} />
      </div>
    </PageBackOffice>
  );
}
