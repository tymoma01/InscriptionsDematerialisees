import { useEffect, useState } from 'react';
import { listerPiecesJustificatives } from '../../services/pieceJustificativeService';
import { construirePiecesCapturees, calculerPiecesObligatoiresCompletes } from './premierePlanificationTest';

// Sait répondre uniquement "les pièces obligatoires de ce dossier sont-elles toutes capturées ?"
// — jamais la liste elle-même (voir CaptureTablette.jsx pour l'écran complet de capture/reprise/
// suppression, onglet "Pièces justificatives"). Portée volontairement réduite à ce seul besoin :
// Tests.jsx (onglet "Tests") n'a besoin que de ce booléen pour décider s'il peut proposer
// "Valider et planifier un test" sans renvoyer l'agent vers l'onglet Pièces justificatives —
// jamais d'afficher la liste des pièces elle-même sur cet onglet, hors périmètre de la demande.
// Fetch indépendant de celui de CaptureTablette.jsx (même patron que le reste de ce back-office,
// voir CLAUDE.md conventions du projet : chaque écran recharge ses propres données).
export function usePiecesObligatoiresCompletes(dossierId, typesPieces) {
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);
  const [piecesCapturees, setPiecesCapturees] = useState(() => new Map());

  useEffect(() => {
    let annule = false;
    setChargement(true);
    setErreur(null);
    listerPiecesJustificatives(dossierId)
      .then((pieces) => {
        if (!annule) setPiecesCapturees(construirePiecesCapturees(pieces));
      })
      .catch((erreurRequete) => {
        if (!annule) {
          setErreur(
            erreurRequete.response?.data?.erreur ?? 'Impossible de récupérer les pièces justificatives de ce dossier.',
          );
        }
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, [dossierId]);

  const { nombrePiecesObligatoires, piecesObligatoiresCompletes } = calculerPiecesObligatoiresCompletes(
    piecesCapturees,
    typesPieces,
  );

  return { chargement, erreur, nombrePiecesObligatoires, piecesObligatoiresCompletes };
}
