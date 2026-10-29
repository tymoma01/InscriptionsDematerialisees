import { useEffect, useState } from 'react';
import { obtenirInformationsPieces } from '../../services/informationsPiecesService';

// La pièce d'identité et le RIB du dossier ont-ils été confirmés par l'accueil ? Condition, avec
// les pièces obligatoires, pour valider la candidature en planifiant le premier test (le serveur
// revérifie, voir informationsPiecesService.verifierInformationsPiecesConfirmees). Pour un écran
// qui n'affiche pas les blocs de confirmation (Tests.jsx) : CaptureTablette suit, lui, ce qui est
// affiché dans ses blocs. `actif` : false -> aucune requête, rien n'est considéré comme confirmé.
export function useInformationsPiecesConfirmees(dossierId, { actif = true } = {}) {
  const [chargement, setChargement] = useState(actif);
  const [confirmees, setConfirmees] = useState({ pieceIdentite: false, rib: false });

  useEffect(() => {
    if (!actif) {
      setChargement(false);
      return undefined;
    }
    let annule = false;
    setChargement(true);
    obtenirInformationsPieces(dossierId)
      .then(({ pieceIdentite, rib }) => {
        if (!annule) setConfirmees({ pieceIdentite: Boolean(pieceIdentite), rib: Boolean(rib) });
      })
      .catch(() => {
        if (!annule) setConfirmees({ pieceIdentite: false, rib: false });
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, [dossierId, actif]);

  return { chargement, toutesConfirmees: confirmees.pieceIdentite && confirmees.rib };
}
