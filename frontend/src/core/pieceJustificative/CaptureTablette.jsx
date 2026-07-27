import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listerPiecesJustificatives, uploaderPieceJustificative } from '../../services/pieceJustificativeService';
import { obtenirDossier } from '../../services/dossierService';
import { listerFormateurs } from '../../services/formateurService';
import { creerRendezvousAvecTransitions, listerRendezvousTest } from '../../services/rendezvousService';
import { useSession } from '../auth/useSession';
import EnTeteBackOffice from '../auth/EnTeteBackOffice';
import CalendrierDisponibiliteFormateur from './CalendrierDisponibiliteFormateur';
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
// nommer/enchaîner ça différemment, jamais codé en dur au-delà de cette seule constante.
const CODE_ACTION_PLANIFIER_TEST = 'planifier_test';

// L'input natif type="datetime-local" s'est révélé peu fiable au tactile pour sa partie
// heure/minute (segment difficile à cibler précisément, voir le correctif de largeur précédent
// qui n'a pas suffi) — remplacé par un input type="date" (fiable, déjà éprouvé) combiné à deux
// <select> classiques pour l'heure et les minutes : un select est un composant natif que
// l'agent peut ouvrir et faire défiler au doigt, sans dépendre d'une frappe précise sur un
// sous-segment. Minutes par pas de 15 : granularité suffisante pour planifier un test, une liste
// des 60 valeurs serait inutilement longue à faire défiler sur tablette.
const HEURES_DISPONIBLES = Array.from({ length: 24 }, (_, heure) => String(heure).padStart(2, '0'));
const MINUTES_DISPONIBLES = ['00', '15', '30', '45'];

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
  const navigate = useNavigate();
  const { utilisateur, chargement: chargementSession } = useSession();

  const [piecesCapturees, setPiecesCapturees] = useState(() => new Set());
  const [chargementListe, setChargementListe] = useState(true);
  const [erreurListe, setErreurListe] = useState(null);
  const [typeSelectionne, setTypeSelectionne] = useState(null);

  const [planificationOuverte, setPlanificationOuverte] = useState(false);
  const [planificationReussie, setPlanificationReussie] = useState(null); // { dateHeure, formateurNom }

  // Nom du candidat affiché en en-tête, pour que l'accueil identifie tout de suite le dossier
  // ouvert (utile quand plusieurs onglets/tablettes sont utilisés en parallèle). Purement
  // informatif : aucune autre partie de l'écran n'attend cette valeur, un échec de
  // chargement ne bloque donc rien (voir .catch ci-dessous, silencieux).
  const [dossier, setDossier] = useState(null);

  useEffect(() => {
    let annule = false;
    obtenirDossier(dossierId)
      .then((valeur) => {
        if (!annule) setDossier(valeur);
      })
      .catch(() => {
        // Silencieux : un nom de candidat manquant en en-tête n'empêche pas de capturer les
        // pièces, contrairement à erreurListe ci-dessous qui bloque un vrai besoin fonctionnel.
      });
    return () => {
      annule = true;
    };
  }, [dossierId]);

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
        {dossier && (
          <div className="capture-tablette__bandeau-candidat">
            Candidat : <span className="capture-tablette__candidat-nom">{dossier.candidat_nom}</span> {dossier.candidat_prenom}
          </div>
        )}
        <header className="capture-tablette__entete">
          <EnTeteBackOffice />
          <h2>Pièces justificatives</h2>
        </header>
        <div className="capture-tablette__confirmation" role="status">
          <p>
            Test planifié le {FORMAT_DATE_HEURE.format(new Date(planificationReussie.dateHeure))} avec{' '}
            {planificationReussie.formateurNom}.
          </p>
          <button type="button" onClick={() => navigate('/accueil/tableau-de-bord')}>
            Retour au tableau de bord
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="capture-tablette">
      {dossier && (
        <div className="capture-tablette__bandeau-candidat">
          Candidat : <span className="capture-tablette__candidat-nom">{dossier.candidat_nom}</span> {dossier.candidat_prenom}
        </div>
      )}
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

      {/* Toujours visible en bas de page (CLAUDE.md, besoin Coordination : "planifie les
          tests"), désactivé tant que les pièces obligatoires ne sont pas toutes capturées —
          voir piecesObligatoiresCompletes ci-dessus. */}
      <div className="capture-tablette__pied">
        <button
          type="button"
          onClick={() => setPlanificationOuverte(true)}
          disabled={!piecesObligatoiresCompletes}
        >
          Planifier un test
        </button>
        {!piecesObligatoiresCompletes && (
          <p className="capture-tablette__pied-indication">
            Capturez les 4 pièces obligatoires pour activer ce bouton.
          </p>
        )}
      </div>

      {planificationOuverte && (
        <ModalePlanificationTest
          dossierId={dossierId}
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

// Modale de planification d'un test : choix de la date/heure et du formateur, puis (1) création
// du rendez-vous, (2) avancement du statut du dossier jusqu'à test_planifie via le moteur de
// transitions générique. Composant local (non exporté), même patron que PanneauCapture ci-dessous.
function ModalePlanificationTest({ dossierId, onAnnuler, onReussite }) {
  const [formateurs, setFormateurs] = useState([]);
  const [chargementFormateurs, setChargementFormateurs] = useState(true);
  const [erreurFormateurs, setErreurFormateurs] = useState(null);

  const [dateTest, setDateTest] = useState('');
  const [heureTest, setHeureTest] = useState('');
  const [minuteTest, setMinuteTest] = useState('');
  const [formateurId, setFormateurId] = useState('');
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [erreurEnvoi, setErreurEnvoi] = useState(null);

  // Créneaux du formateur sélectionné, pour le seul jour choisi (voir calendrier mensuel plus
  // bas pour la vue d'ensemble par mois) — sert uniquement au message d'alerte + désactivation du
  // bouton ci-dessous. Confort visuel seulement : trouverRendezvousFormateurAuCreneau côté
  // serveur reste le garde-fou qui fait foi (409 ErreurCreneauPris à la création).
  const [creneauxJourSelectionne, setCreneauxJourSelectionne] = useState([]);

  useEffect(() => {
    let annule = false;
    listerFormateurs()
      .then((valeur) => {
        if (annule) return;
        setFormateurs(valeur);
        if (valeur.length > 0) setFormateurId(String(valeur[0].id));
      })
      .catch(() => {
        if (!annule) setErreurFormateurs('Impossible de récupérer la liste des formateurs.');
      })
      .finally(() => {
        if (!annule) setChargementFormateurs(false);
      });
    return () => {
      annule = true;
    };
  }, []);

  useEffect(() => {
    if (!formateurId || !dateTest) {
      setCreneauxJourSelectionne([]);
      return undefined;
    }
    let annule = false;
    // Bornes du seul jour choisi (dateFin exclusive) — calcul par arithmétique locale de Date
    // (pas de toISOString ici) pour ne jamais glisser sur le jour voisin selon le fuseau du
    // navigateur, cf. cleJourLocal dans CalendrierDisponibiliteFormateur.jsx.
    const [annee, mois, jour] = dateTest.split('-').map(Number);
    const lendemain = new Date(annee, mois - 1, jour + 1);
    const dateFin = `${lendemain.getFullYear()}-${String(lendemain.getMonth() + 1).padStart(2, '0')}-${String(lendemain.getDate()).padStart(2, '0')}`;

    listerRendezvousTest({ formateurId: Number(formateurId), dateDebut: dateTest, dateFin })
      .then((valeur) => {
        if (!annule) setCreneauxJourSelectionne(valeur);
      })
      .catch(() => {
        if (!annule) setCreneauxJourSelectionne([]);
      });
    return () => {
      annule = true;
    };
  }, [formateurId, dateTest]);

  // Même recombinaison que celle utilisée au submit (voir plus bas) : null tant que les trois
  // contrôles ne sont pas tous renseignés, pour ne pas comparer un créneau incomplet.
  const dateHeureChoisieIso = dateTest && heureTest && minuteTest
    ? new Date(`${dateTest}T${heureTest}:${minuteTest}`).toISOString()
    : null;

  const creneauDejaPris = dateHeureChoisieIso !== null
    && creneauxJourSelectionne.some((rendezvous) => new Date(rendezvous.date_heure).toISOString() === dateHeureChoisieIso);

  const soumettre = async (evenement) => {
    evenement.preventDefault();
    if (!dateTest || !heureTest || !minuteTest || !formateurId || envoiEnCours || creneauDejaPris) return;

    setEnvoiEnCours(true);
    setErreurEnvoi(null);

    const formateurChoisi = formateurs.find((f) => String(f.id) === formateurId);
    // Recombine les trois contrôles séparés (date + heure + minute) dans le même format que
    // produisait l'ancien input datetime-local ('aaaa-mm-jjTHH:mm'), pour ne rien changer côté
    // service/back (voir creerRendezvous, qui attend une chaîne convertible en Date).
    const dateHeureIso = dateHeureChoisieIso;

    // Une seule transition à appliquer désormais : "planifier_test" directement depuis
    // en_attente_pieces (workflow v2 — plus d'étape "pieces_completes" intermédiaire, la
    // vérification des pièces est inline/visuelle, voir CODE_ACTION_PLANIFIER_TEST plus haut).
    const transitions = [
      {
        codeAction: CODE_ACTION_PLANIFIER_TEST,
        commentaire: `Test planifié le ${FORMAT_DATE_HEURE.format(new Date(dateHeureIso))} avec ${formateurChoisi.prenom} ${formateurChoisi.nom}.`,
      },
    ];

    // Création du rendez-vous et changement de statut en une seule transaction côté back (voir
    // rendezvousService.creerRendezvousAvecTransitions) : soit les deux réussissent, soit aucun
    // des deux n'est enregistré — plus de rendez-vous "orphelin" possible si la transition échoue.
    try {
      await creerRendezvousAvecTransitions(dossierId, {
        typeRdv: 'test',
        dateHeure: dateHeureIso,
        formateurId: Number(formateurId),
        transitions,
      });
    } catch (erreur) {
      setEnvoiEnCours(false);
      setErreurEnvoi(
        erreur.response
          ? (erreur.response.data?.erreur ?? "Le serveur n'a pas pu enregistrer la planification. Merci de réessayer.")
          : 'Connexion au serveur impossible. Vérifiez le réseau et réessayez.',
      );
      return;
    }

    setEnvoiEnCours(false);
    onReussite({ dateHeure: dateHeureIso, formateurNom: `${formateurChoisi.prenom} ${formateurChoisi.nom}` });
  };

  return (
    <div className="capture-tablette__panneau" role="dialog" aria-label="Planifier un test">
      <div className="capture-tablette__panneau-entete">
        <h3>Planifier un test</h3>
        <button type="button" onClick={onAnnuler} disabled={envoiEnCours}>
          Fermer
        </button>
      </div>

      {chargementFormateurs && <p>Chargement des formateurs…</p>}
      {erreurFormateurs && <p role="alert">{erreurFormateurs}</p>}

      {!chargementFormateurs && !erreurFormateurs && formateurs.length === 0 && (
        <p role="alert">Aucun formateur disponible pour cette entité — impossible de planifier un test.</p>
      )}

      {!chargementFormateurs && formateurs.length > 0 && (
        <form className="capture-tablette__formulaire-planification" onSubmit={soumettre}>
          {/* Texte du label regroupé dans un unique <span> (plutôt que texte + astérisque comme
              deux enfants directs du label) : le label est en display: flex/column pour
              empiler son contenu au-dessus du <select> imbriqué (voir CaptureTablette.css) — un
              texte et un astérisque comme deux enfants directs se seraient sinon empilés l'un
              sous l'autre au lieu de rester sur la même ligne (même bug que celui corrigé pour
              date/heure ci-dessous, présent ici aussi). Placé avant le calendrier et la date/heure
              : le formateur doit être connu avant d'afficher ses disponibilités. */}
          <label>
            <span>
              Formateur <span className="champ-obligatoire">*</span>
            </span>
            <select
              id="planification-formateur"
              value={formateurId}
              onChange={(evenement) => setFormateurId(evenement.target.value)}
              required
            >
              {formateurs.map((formateur) => (
                <option key={formateur.id} value={formateur.id}>
                  {formateur.prenom} {formateur.nom}
                </option>
              ))}
            </select>
          </label>

          {/* Aide visuelle uniquement (voir commentaire de CalendrierDisponibiliteFormateur) : le
              clic sur un jour se contente de préremplir le input date ci-dessous, qui reste la
              seule source de vérité pour la date choisie. */}
          <CalendrierDisponibiliteFormateur
            formateurId={formateurId}
            dateSelectionnee={dateTest}
            onSelectionnerJour={setDateTest}
          />

          {/* fieldset plutôt qu'un simple label : trois contrôles distincts (date, heure,
              minute) partagent une seule légende — même patron que le groupe Civilité du
              formulaire d'inscription (BlocInfosPerso.jsx). Le texte de la légende reste un bloc
              unique (pas de display: flex sur le fieldset/legend ici), donc l'astérisque reste
              sur la même ligne. */}
          <fieldset className="capture-tablette__champ-date-heure">
            <legend>
              Date et heure du test <span className="champ-obligatoire">*</span>
            </legend>
            <div className="capture-tablette__date-heure-controles">
              <input
                id="planification-date"
                type="date"
                value={dateTest}
                onChange={(evenement) => setDateTest(evenement.target.value)}
                required
              />
              <select
                id="planification-heure"
                aria-label="Heure"
                value={heureTest}
                onChange={(evenement) => setHeureTest(evenement.target.value)}
                required
              >
                <option value="">--</option>
                {HEURES_DISPONIBLES.map((heure) => (
                  <option key={heure} value={heure}>
                    {heure}
                  </option>
                ))}
              </select>
              <span aria-hidden="true">:</span>
              <select
                id="planification-minute"
                aria-label="Minutes"
                value={minuteTest}
                onChange={(evenement) => setMinuteTest(evenement.target.value)}
                required
              >
                <option value="">--</option>
                {MINUTES_DISPONIBLES.map((minute) => (
                  <option key={minute} value={minute}>
                    {minute}
                  </option>
                ))}
              </select>
            </div>
          </fieldset>

          {creneauDejaPris && (
            <p role="alert">Ce formateur a déjà un test prévu à cet horaire. Choisissez un autre créneau.</p>
          )}

          {erreurEnvoi && <p role="alert">{erreurEnvoi}</p>}

          <div className="capture-tablette__formulaire-planification-actions">
            <button type="button" onClick={onAnnuler} disabled={envoiEnCours}>
              Annuler
            </button>
            <button
              type="submit"
              disabled={envoiEnCours || !dateTest || !heureTest || !minuteTest || !formateurId || creneauDejaPris}
            >
              {envoiEnCours ? 'Enregistrement...' : 'Confirmer la planification'}
            </button>
          </div>
        </form>
      )}
    </div>
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
