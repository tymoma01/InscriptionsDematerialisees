import { useEffect, useState } from 'react';
import { listerPiecesJustificatives } from '../../services/pieceJustificativeService';
import { construirePiecesCapturees, calculerPiecesObligatoiresCompletes } from './premierePlanificationTest';
import { useTypesPieces } from './useTypesPieces';

// Sait répondre uniquement "les pièces obligatoires de ce dossier sont-elles toutes capturées ?"
// — jamais la liste elle-même (voir CaptureTablette.jsx pour l'écran complet de capture/reprise/
// suppression, onglet "Pièces justificatives"). Portée volontairement réduite à ce seul besoin :
// Tests.jsx (onglet "Tests") n'a besoin que de ce booléen pour décider s'il peut proposer
// "Valider et planifier un test" sans renvoyer l'agent vers l'onglet Pièces justificatives —
// jamais d'afficher la liste des pièces elle-même sur cet onglet, hors périmètre de la demande.
// Fetch indépendant de celui de CaptureTablette.jsx (même patron que le reste de ce back-office,
// voir CLAUDE.md conventions du projet : chaque écran recharge ses propres données).
// `actif` : false -> aucune requête (rôle sans accès aux pièces, ex. Inspecteur
// Hôtellerie) ; pièces considérées comme non chargées. Par défaut true : comportement inchangé.
export function usePiecesObligatoiresCompletes(dossierId, { actif = true } = {}) {
  const { typesPieces, chargement: chargementTypes, erreur: erreurTypes } = useTypesPieces();
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);
  const [piecesCapturees, setPiecesCapturees] = useState(() => new Map());

  useEffect(() => {
    let annule = false;
    if (!actif) {
      setChargement(false);
      return undefined;
    }
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
  }, [dossierId, actif]);

  // Tant que la liste des types n'est pas connue, rien n'est considéré comme complet.
  const { nombrePiecesObligatoires, piecesObligatoiresCompletes } = typesPieces
    ? calculerPiecesObligatoiresCompletes(piecesCapturees, typesPieces)
    : { nombrePiecesObligatoires: 0, piecesObligatoiresCompletes: false };

  return {
    chargement: chargement || (actif && chargementTypes),
    erreur: erreur ?? (actif ? erreurTypes : null),
    nombrePiecesObligatoires,
    piecesObligatoiresCompletes,
  };
}
