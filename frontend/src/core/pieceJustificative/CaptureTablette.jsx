import { useEffect, useMemo, useRef, useState } from 'react';
import { listerPiecesJustificatives, uploaderPieceJustificative } from '../../services/pieceJustificativeService';
import { useSession } from '../auth/useSession';
import EnTeteBackOffice from '../auth/EnTeteBackOffice';
import './CaptureTablette.css';

// Aligné sur la limite multer côté back (voir backend/src/api/routes/pieces.routes.js) — vérifié
// ici uniquement pour donner un retour immédiat à l'agent, le back revalide de toute façon.
const TAILLE_MAX_OCTETS = 15 * 1024 * 1024;
const PREFIXES_MIME_ACCEPTES = ['image/', 'application/pdf'];

function fichierAccepte(fichier) {
  return PREFIXES_MIME_ACCEPTES.some((prefixe) => fichier.type.startsWith(prefixe)) && fichier.size <= TAILLE_MAX_OCTETS;
}

// Écran de prise de pièces justificatives par l'accueil (CLAUDE.md, étape 3 du parcours
// fonctionnel) : pour un dossier candidat donné, une pièce à la fois, capturée à la caméra de la
// tablette ou choisie depuis un fichier existant, avec aperçu avant envoi.
//
// dossierId est une prop simple (pas de useParams() ici) : ce composant ne connaît rien du
// routage, comme BlocCoordonnees ne connaît rien du parcours d'inscription global — au futur
// appelant (ex. pages/accueil/VerificationPieces.jsx, encore à construire) de le lire depuis un
// paramètre de route et de le transmettre.
//
// typesPieces est reçu en prop plutôt que codé en dur (même patron que FormulaireInscription /
// configBlocs) : les 6 pièces ACCECIT vivent dans donneesTest/typesPiecesConfig.accecit.js, pas
// ici — une autre entité peut avoir un jeu de pièces différent sans toucher ce fichier (voir
// Modularité, CLAUDE.md).
//
// uploadedBy n'apparaît nulle part dans ce composant : l'agent est déjà authentifié via la
// session en place (useSession, cookie httpOnly), et c'est le back qui dérive l'auteur de
// l'upload depuis cette session — jamais un champ de saisie manuel (voir
// pieceJustificativeService.js et CLAUDE.auth-rbac.md pour le détail du correctif de sécurité
// que ce choix évite de réintroduire).
export default function CaptureTablette({ dossierId, typesPieces }) {
  const { utilisateur, chargement: chargementSession } = useSession();

  const [piecesCapturees, setPiecesCapturees] = useState(() => new Set());
  const [chargementListe, setChargementListe] = useState(true);
  const [erreurListe, setErreurListe] = useState(null);
  const [typeSelectionne, setTypeSelectionne] = useState(null);

  useEffect(() => {
    let annule = false;
    setChargementListe(true);
    setErreurListe(null);
    listerPiecesJustificatives(dossierId)
      .then((pieces) => {
        if (annule) return;
        setPiecesCapturees(new Set(pieces.map((piece) => piece.type_piece_code)));
      })
      .catch(() => {
        if (!annule) setErreurListe('Impossible de récupérer les pièces déjà envoyées pour ce dossier.');
      })
      .finally(() => {
        if (!annule) setChargementListe(false);
      });
    return () => {
      annule = true;
    };
  }, [dossierId]);

  const typeCourant = useMemo(
    () => typesPieces.find((type) => type.code === typeSelectionne) ?? null,
    [typesPieces, typeSelectionne],
  );

  const gererEnvoiReussi = (typePieceCode) => {
    setPiecesCapturees((precedent) => new Set(precedent).add(typePieceCode));
    setTypeSelectionne(null);
  };

  const nombreCapturees = typesPieces.filter((type) => piecesCapturees.has(type.code)).length;

  if (chargementSession) {
    return <p>Chargement de la session…</p>;
  }

  // Le back refuserait de toute façon (401) sans session valide : mieux vaut le dire tout de
  // suite que laisser l'agent capturer une pièce pour découvrir l'échec seulement à l'envoi.
  if (!utilisateur) {
    return <p role="alert">Vous devez être connecté pour capturer des pièces justificatives.</p>;
  }

  return (
    <section className="capture-tablette">
      <header className="capture-tablette__entete">
        <EnTeteBackOffice />
        <h2>Pièces justificatives</h2>
        <p className="capture-tablette__progression" role="status">
          {nombreCapturees} / {typesPieces.length} pièces capturées
        </p>
      </header>

      {chargementListe && <p>Chargement des pièces déjà envoyées…</p>}
      {erreurListe && <p role="alert">{erreurListe}</p>}

      <ul className="capture-tablette__liste">
        {typesPieces.map((type) => {
          const dejaCapturee = piecesCapturees.has(type.code);
          return (
            <li key={type.code} className="capture-tablette__item">
              <span
                className={
                  dejaCapturee ? 'capture-tablette__statut capture-tablette__statut--ok' : 'capture-tablette__statut'
                }
                aria-hidden="true"
              >
                {dejaCapturee ? '✓' : ''}
              </span>
              <span className="capture-tablette__libelle">
                {type.libelle}
                {!type.obligatoire && <span className="capture-tablette__optionnel"> (optionnel)</span>}
              </span>
              <button type="button" onClick={() => setTypeSelectionne(type.code)}>
                {dejaCapturee ? 'Reprendre' : 'Capturer'}
              </button>
            </li>
          );
        })}
      </ul>

      {typeCourant && (
        <PanneauCapture
          dossierId={dossierId}
          type={typeCourant}
          onAnnuler={() => setTypeSelectionne(null)}
          onEnvoiReussi={() => gererEnvoiReussi(typeCourant.code)}
        />
      )}
    </section>
  );
}

// Panneau de capture pour une seule pièce à la fois : choix caméra/fichier -> aperçu -> envoi.
// Composant local (non exporté, non enregistré dans un registre) : contrairement aux blocs du
// formulaire d'inscription, une pièce justificative n'est pas un type extensible piloté par
// config — seule la liste des pièces l'est (typesPieces), pas la façon de les capturer.
function PanneauCapture({ dossierId, type, onAnnuler, onEnvoiReussi }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const [modeCamera, setModeCamera] = useState(false);
  const [erreurCamera, setErreurCamera] = useState(null);
  const [captureEnCours, setCaptureEnCours] = useState(null); // { blob, url, nomFichier }
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [erreurEnvoi, setErreurEnvoi] = useState(null);

  const arreterCamera = () => {
    streamRef.current?.getTracks().forEach((piste) => piste.stop());
    streamRef.current = null;
  };

  // Relâche systématiquement la caméra au démontage du panneau (fermeture, changement de pièce,
  // navigation ailleurs) — sinon le voyant caméra de la tablette resterait allumé inutilement.
  useEffect(() => arreterCamera, []);

  const demarrerCamera = async () => {
    setErreurCamera(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setErreurCamera(
        'Caméra indisponible sur cet appareil/navigateur (contexte non sécurisé ou API non supportée). ' +
          'Utilisez « Choisir un fichier ».',
      );
      return;
    }
    try {
      const flux = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = flux;
      // srcObject n'est jamais assigné ici : <video> n'est monté que si modeCamera est vrai
      // (voir le rendu plus bas), donc videoRef.current vaudrait encore null à cet instant — le
      // flux serait bien obtenu (permission accordée) mais jamais réellement branché à l'élément
      // vidéo affiché ensuite, d'où un aperçu noir malgré une caméra correctement autorisée.
      // L'assignation réelle se fait dans l'effet ci-dessous, une fois <video> effectivement monté.
      setModeCamera(true);
    } catch (erreur) {
      console.error('Échec de getUserMedia (accès caméra) :', erreur);
      setErreurCamera("Impossible d'accéder à la caméra. Vérifiez les autorisations données à l'application.");
    }
  };

  // Branche le flux sur <video> une fois l'élément réellement présent dans le DOM (après le
  // rendu déclenché par setModeCamera(true) ci-dessus) — voir le commentaire dans
  // demarrerCamera pour le bug que cet effet corrige.
  useEffect(() => {
    if (!modeCamera || !videoRef.current || !streamRef.current) return;
    const video = videoRef.current;
    video.srcObject = streamRef.current;
    video.play().catch((erreur) => {
      console.error('Échec de la lecture du flux caméra :', erreur);
      setErreurCamera("Impossible de démarrer l'aperçu caméra. Réessayez.");
    });
  }, [modeCamera]);

  const annulerCamera = () => {
    arreterCamera();
    setModeCamera(false);
  };

  // Fige l'image courante du flux vidéo sur un canvas hors-écran, puis l'exporte en JPEG —
  // la caméra est relâchée immédiatement après (plus besoin du flux une fois la photo figée).
  const capturerPhoto = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        arreterCamera();
        setModeCamera(false);
        setCaptureEnCours({ blob, url: URL.createObjectURL(blob), nomFichier: `${type.code}.jpg` });
      },
      'image/jpeg',
      0.92,
    );
  };

  const gererSelectionFichier = (evenement) => {
    const fichier = evenement.target.files?.[0];
    evenement.target.value = ''; // permet de resélectionner le même fichier après une reprise
    if (!fichier) return;
    if (!fichierAccepte(fichier)) {
      setErreurEnvoi('Fichier invalide (image ou PDF attendu, 15 Mio maximum).');
      return;
    }
    setErreurEnvoi(null);
    setCaptureEnCours({ blob: fichier, url: URL.createObjectURL(fichier), nomFichier: fichier.name });
  };

  const reprendre = () => {
    if (captureEnCours) URL.revokeObjectURL(captureEnCours.url);
    setCaptureEnCours(null);
    setErreurEnvoi(null);
  };

  const valider = async () => {
    if (!captureEnCours) return;
    setEnvoiEnCours(true);
    setErreurEnvoi(null);
    try {
      await uploaderPieceJustificative(dossierId, {
        typePieceCode: type.code,
        fichier: captureEnCours.blob,
        nomFichier: captureEnCours.nomFichier,
      });
      URL.revokeObjectURL(captureEnCours.url);
      onEnvoiReussi();
    } catch (erreur) {
      setErreurEnvoi(
        erreur.response
          ? "Le serveur n'a pas pu enregistrer la pièce. Merci de réessayer."
          : 'Connexion au serveur impossible. Vérifiez le réseau et réessayez.',
      );
    } finally {
      setEnvoiEnCours(false);
    }
  };

  const fermer = () => {
    arreterCamera();
    if (captureEnCours) URL.revokeObjectURL(captureEnCours.url);
    onAnnuler();
  };

  return (
    <div className="capture-tablette__panneau" role="dialog" aria-label={`Capture — ${type.libelle}`}>
      <div className="capture-tablette__panneau-entete">
        <h3>{type.libelle}</h3>
        <button type="button" onClick={fermer}>
          Fermer
        </button>
      </div>

      {!captureEnCours && !modeCamera && (
        <div className="capture-tablette__choix-methode">
          <button type="button" onClick={demarrerCamera}>
            Prendre une photo
          </button>
          <label className="capture-tablette__bouton-fichier">
            Choisir un fichier
            <input type="file" accept="image/*,application/pdf" onChange={gererSelectionFichier} />
          </label>
        </div>
      )}

      {erreurCamera && <p role="alert">{erreurCamera}</p>}

      {modeCamera && (
        <div className="capture-tablette__camera">
          {/* muted : évite tout blocage de lecture autoplay, même si aucune piste audio n'est
              demandée (video: {...} seul, pas de audio: true) — playsInline : empêche Safari iOS
              de forcer la vidéo en plein écran natif. autoPlay : filet de sécurité en plus de
              l'appel explicite à video.play() dans l'effet ci-dessus — sans effet indésirable
              ici puisque srcObject n'est de toute façon assigné qu'après le montage. */}
          <video ref={videoRef} className="capture-tablette__video" autoPlay playsInline muted />
          <button type="button" onClick={capturerPhoto}>
            Capturer la photo
          </button>
          <button type="button" onClick={annulerCamera}>
            Annuler
          </button>
        </div>
      )}

      {captureEnCours && (
        <div className="capture-tablette__apercu">
          {captureEnCours.blob.type?.startsWith('image/') ? (
            <img src={captureEnCours.url} alt={`Aperçu — ${type.libelle}`} className="capture-tablette__apercu-image" />
          ) : (
            <p className="capture-tablette__apercu-fichier">📄 {captureEnCours.nomFichier}</p>
          )}

          {erreurEnvoi && <p role="alert">{erreurEnvoi}</p>}

          <div className="capture-tablette__apercu-actions">
            <button type="button" onClick={reprendre} disabled={envoiEnCours}>
              Reprendre
            </button>
            <button type="button" onClick={valider} disabled={envoiEnCours}>
              {envoiEnCours ? 'Envoi en cours...' : 'Valider et envoyer'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
