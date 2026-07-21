import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import GestionTransitions from '../../core/dossier/GestionTransitions';
import { listerPiecesJustificatives } from '../../services/pieceJustificativeService';
import './Validation.css';

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

const LIBELLES_STATUT_VERIFICATION = { en_attente: 'En attente', valide: 'Validée', rejete: 'Rejetée' };

// Écran de décision recruteur pour un dossier (CLAUDE.md : "indicateur de complétude" +
// "décision finale (validé/refusé)") — dossierId vient du paramètre de route (à la différence des
// composants génériques de core/, cette page connaît le routage, même patron que
// VerificationPieces.jsx / Relances.jsx).
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

  useEffect(() => {
    let annule = false;
    setChargement(true);
    setErreur(null);
    listerPiecesJustificatives(dossierId)
      .then((valeur) => {
        if (!annule) setPieces(valeur);
      })
      .catch(() => {
        if (!annule) setErreur('Impossible de récupérer les pièces justificatives.');
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, [dossierId]);

  return (
    <main className="page-validation">
      <h1>Dossier #{dossierId}</h1>

      <section className="page-validation__pieces">
        <h2>Pièces justificatives</h2>

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
                <span className="page-validation__piece-date">{FORMAT_DATE.format(new Date(piece.date_upload))}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <GestionTransitions dossierId={dossierId} />
    </main>
  );
}
