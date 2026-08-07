import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  listerPiecesJustificatives,
  uploaderPieceJustificative,
  supprimerPieceJustificative,
  obtenirApercuPiece,
} from '../../services/pieceJustificativeService';
import { useSession } from '../auth/useSession';
import EnTeteBackOffice from '../auth/EnTeteBackOffice';
import ModalePlanificationTest from '../dossier/ModalePlanificationTest';
import './CaptureTablette.css';

const FORMAT_DATE_HEURE = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

// Code de la transition qui planifie le test (voir workflow.config.json de l'entité) — ACCECIT
// l'a directement depuis en_attente_pieces (workflow v2 : la vérification des pièces est inline,
// jugée visuellement par l'accueil, plus une étape de statut séparée). Une autre entité peut
// nommer/enchaîner ça différemment, jamais codé en dur au-delà de cette seule constante. Transmis
// à ModalePlanificationTest (core/dossier/), composant générique partagé avec la replanification
// depuis TableauDeBordAccueil.jsx (codeAction "replanifier_test").
const CODE_ACTION_PLANIFIER_TEST = 'planifier_test';

// Statut sous lequel les pièces déjà capturées restent modifiables (reprise ou suppression) —
// aligné sur STATUTS_SUPPRESSION_AUTORISES côté back (pieceJustificativeService.js), qui reste
// seul juge en dernier ressort : cette constante n'est là que pour donner un retour immédiat à
// l'agent (masquer des actions vouées à échouer une fois le test planifié), pas pour dupliquer la
// règle métier.
const STATUT_DOSSIER_PIECES_MODIFIABLES = 'en_attente_pieces';

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
// postesBureau/postesHotel/libellePoste : purement transmis à ModalePlanificationTest.jsx (Phase
// 1, sélection de poste(s) testé(s), voir son en-tête de fichier) — ce composant ne s'en sert pas
// lui-même ailleurs, même principe que dossierId reçu sans routage.
export default function CaptureTablette({ dossierId, typesPieces, statutCode, postesBureau, postesHotel, libellePoste }) {
  const navigate = useNavigate();
  const { utilisateur, chargement: chargementSession } = useSession();

  // Map plutôt que Set : contrairement au simple "déjà capturée ?" d'origine, supprimer une
  // pièce nécessite son id (voir supprimerPieceJustificative, service front). pieces vient trié
  // date_upload desc (voir pieceJustificativeRepository.listerPiecesParDossier) : en ignorant les
  // codes déjà vus, on ne garde que la ligne la plus récente par type même quand plusieurs lignes
  // partagent le même type_piece_code (voir diagnostic pièces dupliquées).
  const [piecesCapturees, setPiecesCapturees] = useState(() => new Map());
  const [chargementListe, setChargementListe] = useState(true);
  const [erreurListe, setErreurListe] = useState(null);
  const [typeSelectionne, setTypeSelectionne] = useState(null);
  const [typeApercu, setTypeApercu] = useState(null); // code du type dont l'aperçu est ouvert
  const [suppressionEnCours, setSuppressionEnCours] = useState(null); // type_piece_code en cours
  const [erreurSuppression, setErreurSuppression] = useState(null);

  const [planificationOuverte, setPlanificationOuverte] = useState(false);
  const [planificationReussie, setPlanificationReussie] = useState(null); // { dateHeure, formateurNom }

  useEffect(() => {
    let annule = false;
    setChargementListe(true);
    setErreurListe(null);
    listerPiecesJustificatives(dossierId)
      .then((pieces) => {
        if (annule) return;
        const parType = new Map();
        pieces.forEach((piece) => {
          if (!parType.has(piece.type_piece_code)) parType.set(piece.type_piece_code, piece);
        });
        setPiecesCapturees(parType);
      })
      .catch((erreur) => {
        if (!annule) {
          setErreurListe(erreur.response?.data?.erreur ?? 'Impossible de récupérer les pièces déjà envoyées pour ce dossier.');
        }
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

  const typeEnApercu = useMemo(
    () => typesPieces.find((type) => type.code === typeApercu) ?? null,
    [typesPieces, typeApercu],
  );

  const gererEnvoiReussi = (typePieceCode, pieceId) => {
    setPiecesCapturees((precedent) => new Map(precedent).set(typePieceCode, { id: pieceId, type_piece_code: typePieceCode }));
    setTypeSelectionne(null);
  };

  // statutCode absent tant que la page appelante n'a pas fini de charger le dossier (voir
  // VerificationPieces.jsx) : permissif par défaut dans ce cas, comme la vérification de taille
  // de fichier plus haut — le back reste seul juge (STATUTS_SUPPRESSION_AUTORISES /
  // STATUTS_UPLOAD_AUTORISES) et revalide de toute façon à l'envoi.
  const dossierPiecesModifiables = statutCode == null || statutCode === STATUT_DOSSIER_PIECES_MODIFIABLES;

  const gererSuppression = async (type) => {
    const piece = piecesCapturees.get(type.code);
    if (!piece) return;
    const confirme = window.confirm('Êtes-vous sûr de vouloir supprimer cette pièce ? Cette action est irréversible.');
    if (!confirme) return;

    setErreurSuppression(null);
    setSuppressionEnCours(type.code);
    try {
      await supprimerPieceJustificative(dossierId, piece.id);
      setPiecesCapturees((precedent) => {
        const suivant = new Map(precedent);
        suivant.delete(type.code);
        return suivant;
      });
    } catch (erreur) {
      setErreurSuppression(
        erreur.response?.data?.erreur ?? "Impossible de supprimer cette pièce. Merci de réessayer.",
      );
    } finally {
      setSuppressionEnCours(null);
    }
  };

  const nombreCapturees = typesPieces.filter((type) => piecesCapturees.has(type.code)).length;

  // Seules les pièces obligatoires conditionnent le bouton de planification — les 2 pièces
  // optionnelles (justificatif d'expérience, attestation mutuelle) n'ont jamais besoin d'être
  // capturées pour avancer le dossier.
  const piecesObligatoiresCompletes = typesPieces
    .filter((type) => type.obligatoire)
    .every((type) => piecesCapturees.has(type.code));

  if (chargementSession) {
    return <p>Chargement de la session…</p>;
  }

  // Le back refuserait de toute façon (401) sans session valide : mieux vaut le dire tout de
  // suite que laisser l'agent capturer une pièce pour découvrir l'échec seulement à l'envoi.
  if (!utilisateur) {
    return <p role="alert">Vous devez être connecté pour capturer des pièces justificatives.</p>;
  }

  // Une fois le test planifié, l'agent n'a plus rien à faire sur cet écran — la liste des pièces
  // et le bouton de planification n'ont plus lieu d'être affichés à côté d'une confirmation qui
  // invite déjà à passer à autre chose (même principe que ConfirmationInscription.jsx : un écran
  // dédié plutôt qu'un message qui s'ajoute au-dessus du reste).
  if (planificationReussie) {
    return (
      <section className="capture-tablette">
        <header className="capture-tablette__entete">
          <EnTeteBackOffice />
          <h2>Pièces justificatives</h2>
        </header>
        <div className="capture-tablette__confirmation" role="status">
          <p>
            Test planifié le {FORMAT_DATE_HEURE.format(new Date(planificationReussie.dateHeure))} avec{' '}
            {planificationReussie.formateurNom}.
          </p>
          <button type="button" className="capture-tablette__bouton-retour" onClick={() => navigate('/accueil/tableau-de-bord')}>
            Retour au tableau de bord
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="capture-tablette">
      <header className="capture-tablette__entete">
        <EnTeteBackOffice />
        {/* Sous Déconnexion, aligné à droite — visible en permanence quel que soit le statut du
            dossier, contrairement à l'ancien unique emplacement de ce bouton (uniquement dans
            l'écran de confirmation planificationReussie ci-dessus, jamais atteint quand l'agent
            revient sur cette page après coup, ex. pour compléter une pièce optionnelle une fois
            le test déjà planifié). */}
        <div className="capture-tablette__retour-ligne">
          <button
            type="button"
            className="capture-tablette__bouton-retour"
            onClick={() => navigate('/accueil/tableau-de-bord')}
          >
            Retour au tableau de bord
          </button>
        </div>
        <h2>Pièces justificatives</h2>
        <p className="capture-tablette__progression" role="status">
          {nombreCapturees} / {typesPieces.length} pièces capturées
        </p>
      </header>

      {chargementListe && <p>Chargement des pièces déjà envoyées…</p>}
      {erreurListe && <p role="alert">{erreurListe}</p>}
      {erreurSuppression && <p role="alert">{erreurSuppression}</p>}

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
              {dejaCapturee ? (
                // Boutons toujours affichés à l'identique, y compris une fois le dossier
                // verrouillé (dossierPiecesModifiables faux) — juste désactivés plutôt que
                // remplacés par un message : l'agent garde la même structure de ligne partout
                // dans la liste, et comprend visuellement (grisé, curseur not-allowed, voir
                // CaptureTablette.css) que l'action n'est plus disponible à ce stade.
                <div className="capture-tablette__actions-piece">
                  {/* Même condition de verrouillage que Reprendre/Supprimer (dossierPiecesModifiables)
                      — pas de règle séparée pour l'aperçu. */}
                  <button
                    type="button"
                    className="capture-tablette__bouton-voir"
                    onClick={() => {
                      setTypeApercu(type.code);
                      setTypeSelectionne(null);
                    }}
                    disabled={!dossierPiecesModifiables}
                  >
                    Voir
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTypeSelectionne(type.code);
                      setTypeApercu(null);
                    }}
                    disabled={!dossierPiecesModifiables}
                  >
                    Reprendre
                  </button>
                  <button
                    type="button"
                    className="capture-tablette__bouton-supprimer"
                    onClick={() => gererSuppression(type)}
                    disabled={!dossierPiecesModifiables || suppressionEnCours === type.code}
                  >
                    {suppressionEnCours === type.code ? 'Suppression…' : 'Supprimer'}
                  </button>
                </div>
              ) : (
                // Le verrouillage post-planification ne concerne que les pièces déjà capturées
                // (voir dossierPiecesModifiables) — une pièce jamais capturée, obligatoire ou
                // optionnelle, doit rester capturable même après planification du test.
                <button
                  type="button"
                  onClick={() => {
                    setTypeSelectionne(type.code);
                    setTypeApercu(null);
                  }}
                >
                  Capturer
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {typeCourant && (
        <PanneauCapture
          dossierId={dossierId}
          type={typeCourant}
          onAnnuler={() => setTypeSelectionne(null)}
          onEnvoiReussi={(pieceId) => gererEnvoiReussi(typeCourant.code, pieceId)}
        />
      )}

      {typeEnApercu && (
        <PanneauApercuPiece
          dossierId={dossierId}
          type={typeEnApercu}
          piece={piecesCapturees.get(typeEnApercu.code)}
          onFermer={() => setTypeApercu(null)}
        />
      )}

      {/* Visible tant que le dossier est encore en_attente_pieces (CLAUDE.md, besoin
          Coordination : "planifie les tests"), désactivé tant que les pièces obligatoires ne sont
          pas toutes capturées — voir piecesObligatoiresCompletes ci-dessus. Une fois le test déjà
          planifié (dossierPiecesModifiables faux, voir plus haut), cet écran ne sert plus qu'à
          compléter une pièce manquante — pas à replanifier un test déjà en place, qui se fait
          depuis TableauDeBordAccueil.jsx (codeAction "replanifier_test") une fois le dossier
          repassé par test_non_realise/invalide, pas depuis ce bouton. */}
      {dossierPiecesModifiables && (
        <div className="capture-tablette__pied">
          <button
            type="button"
            onClick={() => setPlanificationOuverte(true)}
            disabled={!piecesObligatoiresCompletes}
          >
            Valider et planifier un test
          </button>
          {!piecesObligatoiresCompletes && (
            <p className="capture-tablette__pied-indication">
              Capturez les 4 pièces obligatoires pour activer ce bouton.
            </p>
          )}
        </div>
      )}

      {planificationOuverte && (
        <ModalePlanificationTest
          dossierId={dossierId}
          codeAction={CODE_ACTION_PLANIFIER_TEST}
          titre="Planifier un test"
          postesBureau={postesBureau}
          postesHotel={postesHotel}
          libellePoste={libellePoste}
          onAnnuler={() => setPlanificationOuverte(false)}
          onReussite={(resultat) => {
            setPlanificationOuverte(false);
            setPlanificationReussie(resultat);
          }}
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
  const panneauRef = useRef(null);

  // Défilement automatique vers le panneau au clic sur "Capturer"/"Reprendre" — sans lui, la
  // liste des pièces (potentiellement longue) laisse ce panneau hors champ en bas de page, l'agent
  // devant défiler manuellement pour l'atteindre. Dépendance sur type.code (pas juste au montage) :
  // ce composant reste monté et ne fait que changer de `type` si l'agent clique Reprendre sur une
  // autre pièce pendant que le panneau est déjà ouvert (pas de `key` posée par CaptureTablette.jsx
  // sur <PanneauCapture>) — sans cette dépendance, aucun nouveau défilement ne se déclencherait
  // dans ce cas précis.
  useEffect(() => {
    panneauRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [type.code]);

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
      const resultat = await uploaderPieceJustificative(dossierId, {
        typePieceCode: type.code,
        fichier: captureEnCours.blob,
        nomFichier: captureEnCours.nomFichier,
      });
      URL.revokeObjectURL(captureEnCours.url);
      onEnvoiReussi(resultat.pieceId);
    } catch (erreur) {
      setErreurEnvoi(
        erreur.response
          ? (erreur.response.data?.erreur ?? "Le serveur n'a pas pu enregistrer la pièce. Merci de réessayer.")
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
    <div ref={panneauRef} className="capture-tablette__panneau" role="dialog" aria-label={`Capture - ${type.libelle}`}>
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
          <div className="capture-tablette__camera-actions">
            <button type="button" onClick={capturerPhoto}>
              Capturer la photo
            </button>
            <button type="button" onClick={annulerCamera}>
              Annuler
            </button>
          </div>
        </div>
      )}

      {captureEnCours && (
        <div className="capture-tablette__apercu">
          {captureEnCours.blob.type?.startsWith('image/') ? (
            <img src={captureEnCours.url} alt={`Aperçu - ${type.libelle}`} className="capture-tablette__apercu-image" />
          ) : (
            <p className="capture-tablette__apercu-fichier">📄 {captureEnCours.nomFichier}</p>
          )}

          {erreurEnvoi && <p role="alert">{erreurEnvoi}</p>}

          <div className="capture-tablette__apercu-actions">
            <button type="button" onClick={reprendre} disabled={envoiEnCours}>
              Reprendre
            </button>
            <button type="button" onClick={valider} disabled={envoiEnCours}>
              {envoiEnCours ? 'Envoi en cours...' : 'Charger'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Aperçu d'une pièce déjà capturée (bouton "Voir") : récupère le fichier réel côté serveur (voir
// pieceJustificativeService.obtenirApercuPiece, qui appelle la route /apercu — jamais un lien
// direct SharePoint) et l'affiche intégré à la page, pas dans un nouvel onglet. Composant local
// comme PanneauCapture : pas de registre de types, ce n'est pas un contenu piloté par config.
function PanneauApercuPiece({ dossierId, type, piece, onFermer }) {
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);
  const [apercuUrl, setApercuUrl] = useState(null);
  const [contentType, setContentType] = useState(null);
  const panneauRef = useRef(null);

  // Même défilement automatique que PanneauCapture ci-dessus, pour le clic sur "Voir" — même
  // dépendance sur type.code (pas seulement au montage) et même raison : l'agent peut cliquer
  // "Voir" sur une autre pièce pendant que ce panneau est déjà ouvert (pas de `key` posée par
  // CaptureTablette.jsx sur <PanneauApercuPiece>).
  useEffect(() => {
    panneauRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [type.code]);

  // urlObjet (pas apercuUrl directement) dans la fermeture de nettoyage : évite de dépendre d'un
  // state React potentiellement pas encore mis à jour au moment du cleanup (même précaution que
  // reprendre()/fermer() pour la capture locale plus haut, qui révoquent captureEnCours.url).
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
        // serveur — même patron que valider()/gererSuppression() plus haut, pour ne pas cacher le
        // message réel derrière un texte générique en cas d'échec HTTP.
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
    <div
      ref={panneauRef}
      className="capture-tablette__panneau capture-tablette__panneau-apercu"
      role="dialog"
      aria-label={`Aperçu - ${type.libelle}`}
    >
      <div className="capture-tablette__panneau-entete">
        <h3>{type.libelle}</h3>
        <button type="button" onClick={onFermer}>
          Fermer
        </button>
      </div>

      {chargement && <p>Chargement de l’aperçu…</p>}
      {erreur && <p role="alert">{erreur}</p>}

      {apercuUrl && contentType?.startsWith('image/') && (
        <img src={apercuUrl} alt={`Aperçu - ${type.libelle}`} className="capture-tablette__apercu-grand-image" />
      )}

      {/* Aucune lib PDF : le lecteur natif du navigateur s'affiche automatiquement dans un iframe
          pointant vers un blob de type application/pdf (Chrome/Firefox/Edge/Safari). */}
      {apercuUrl && contentType === 'application/pdf' && (
        <iframe src={apercuUrl} title={`Aperçu - ${type.libelle}`} className="capture-tablette__apercu-pdf" />
      )}

      {apercuUrl && contentType && !contentType.startsWith('image/') && contentType !== 'application/pdf' && (
        <p>Aperçu non disponible pour ce type de fichier ({contentType}).</p>
      )}
    </div>
  );
}
