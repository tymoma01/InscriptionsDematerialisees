import { useEffect, useState } from 'react';
import { listerTypesPieces } from '../../services/typesPiecesService';

// Liste des pièces justificatives de l'entité, lue une seule fois par chargement de l'application
// (simple configuration, partagée par l'écran de capture et l'onglet Tests). En cas d'échec, la
// requête est retentée au prochain montage.
let requeteEnCours = null;

function chargerTypesPieces() {
  if (!requeteEnCours) {
    requeteEnCours = listerTypesPieces().catch((erreur) => {
      requeteEnCours = null;
      throw erreur;
    });
  }
  return requeteEnCours;
}

export function useTypesPieces() {
  const [typesPieces, setTypesPieces] = useState(null);
  const [erreur, setErreur] = useState(null);

  useEffect(() => {
    let annule = false;
    chargerTypesPieces()
      .then((types) => {
        if (!annule) setTypesPieces(types);
      })
      .catch(() => {
        if (!annule) setErreur('Impossible de récupérer la liste des pièces justificatives.');
      });
    return () => {
      annule = true;
    };
  }, []);

  return { typesPieces, chargement: !typesPieces && !erreur, erreur };
}
