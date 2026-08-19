import { useEffect, useRef, useState } from 'react';
import { obtenirApercuPiece } from '../../services/pieceJustificativeService';
import './PanneauApercuPiece.css';

// Aperçu d'une pièce déjà capturée (bouton "Voir") — extrait de CaptureTablette.jsx (audit
// 2026-08-19, ajout du bouton "Voir" sur InformationsInscription.jsx) pour être réutilisé tel
// quel par les deux écrans plutôt que dupliqué : récupère le fichier réel côté serveur (voir
// pieceJustificativeService.obtenirApercuPiece, qui appelle la route .../pieces/:pieceId/apercu —
// jamais un lien direct SharePoint/OneDrive) et l'affiche intégré à la page, pas dans un nouvel
// onglet. `libelle` reçu en chaîne plutôt que l'objet `type` de configuration qu'utilise
// CaptureTablette.jsx en interne : ce composant n'a besoin que du texte affiché dans son titre,
// pas du reste d'un type de pièce (obligatoire, codeVerso...) propre à l'écran de capture — reste
// utilisable depuis n'importe quel écran qui connaît juste `piece` (voir
// listerPiecesJustificatives) et un libellé à afficher, sans dépendre de son vocabulaire.
export default function PanneauApercuPiece({ dossierId, libelle, piece, onFermer }) {
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);
  const [apercuUrl, setApercuUrl] = useState(null);
  const [contentType, setContentType] = useState(null);
  const panneauRef = useRef(null);

  // Défilement automatique à l'ouverture — dépend de piece.id (pas seulement au montage) : l'agent
  // peut cliquer "Voir" sur une autre pièce pendant que ce panneau est déjà ouvert (pas de `key`
  // posée par les appelants sur <PanneauApercuPiece>), il faut donc re-scroller à chaque nouvelle
  // pièce affichée, pas seulement à la toute première ouverture.
  useEffect(() => {
    panneauRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [piece.id]);

  // urlObjet (pas apercuUrl directement) dans la fermeture de nettoyage : évite de dépendre d'un
  // state React potentiellement pas encore mis à jour au moment du cleanup.
  useEffect(() => {
    let annule = false;
    let urlObjet = null;
    setChargement(true);
    setErreur(null);
    setApercuUrl(null);

    obtenirApercuPiece(dossierId, piece.id)
      .then((blob) => {
        if (annule) return;
        urlObjet = URL.createObjectURL(blob);
        setApercuUrl(urlObjet);
        setContentType(blob.type);
      })
      .catch((erreur) => {
        if (annule) return;
        // Distingue une vraie coupure réseau (erreur.response absent) d'une réponse d'erreur du
        // serveur, pour ne pas cacher le message réel derrière un texte générique en cas d'échec
        // HTTP.
        console.error('Échec de récupération de l’aperçu de la pièce :', erreur);
        setErreur(
          erreur.response
            ? (erreur.response.data?.erreur ?? "Impossible de récupérer l'aperçu de cette pièce.")
            : 'Connexion au serveur impossible. Vérifiez le réseau et réessayez.',
        );
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });

    return () => {
      annule = true;
      if (urlObjet) URL.revokeObjectURL(urlObjet);
    };
  }, [dossierId, piece.id]);

  return (
    <div ref={panneauRef} className="panneau-apercu-piece" role="dialog" aria-label={`Aperçu - ${libelle}`}>
      <div className="panneau-apercu-piece__entete">
        <h3>{libelle}</h3>
        <button type="button" onClick={onFermer}>
          Fermer
        </button>
      </div>

      {chargement && <p>Chargement de l’aperçu…</p>}
      {erreur && <p role="alert">{erreur}</p>}

      {apercuUrl && contentType?.startsWith('image/') && (
        <img src={apercuUrl} alt={`Aperçu - ${libelle}`} className="panneau-apercu-piece__image" />
      )}

      {/* Aucune lib PDF : le lecteur natif du navigateur s'affiche automatiquement dans un iframe
          pointant vers un blob de type application/pdf (Chrome/Firefox/Edge/Safari). */}
      {apercuUrl && contentType === 'application/pdf' && (
        <iframe src={apercuUrl} title={`Aperçu - ${libelle}`} className="panneau-apercu-piece__pdf" />
      )}

      {apercuUrl && contentType && !contentType.startsWith('image/') && contentType !== 'application/pdf' && (
        <p>Aperçu non disponible pour ce type de fichier ({contentType}).</p>
      )}
    </div>
  );
}
