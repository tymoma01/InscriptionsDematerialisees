import { useEffect, useState } from 'react';
import { obtenirInscriptionComplete } from '../../services/dossierService';
import { listerPiecesJustificatives, obtenirApercuPiece } from '../../services/pieceJustificativeService';
import './InformationsInscription.css';

// Code de type de pièce (voir typesPiecesConfig.accecit.js, backend/scripts/seedTypesPieces.js)
// — pièce obligatoire, capturée uniquement à la caméra (jamais un fichier existant, voir
// CaptureTablette.jsx). Dupliqué ici tel quel plutôt que partagé (deux fichiers, même convention
// que le reste du projet).
const CODE_PHOTO_IDENTITE = 'photo_identite';

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

// Mêmes libellés que les blocs du formulaire d'inscription (BlocInfosPerso.jsx,
// BlocDisponibilites.jsx, BlocMutuelle.jsx, BlocConsentementRGPD.jsx) — dupliqués plutôt que
// partagés, même convention que le reste du projet (voir CLAUDE.md, conventions du projet, et
// libellePoste répété tel quel dans chaque page back-office).
const LIBELLES_CIVILITE = { monsieur: 'Monsieur', madame: 'Madame' };
const LIBELLES_CRENEAU = { matin: 'Matin', midi: 'Midi', soir: 'Soir' };
const LIBELLES_JOUR = {
  lundi: 'Lundi',
  mardi: 'Mardi',
  mercredi: 'Mercredi',
  jeudi: 'Jeudi',
  vendredi: 'Vendredi',
  samedi: 'Samedi',
  dimanche: 'Dimanche',
};
const LIBELLES_LANGUE = { francais: 'Français', anglais: 'Anglais', autre: 'Autre' };
const LIBELLES_POSTE = {
  nettoyage: 'Nettoyage',
  vitrerie: 'Vitrerie',
  machiniste: 'Machiniste',
  chef_equipe: "Chef d'équipe",
  autres: 'Autres',
  femme_valet_chambre: 'Femme/Valet de chambre',
  cafetier: 'Cafétier(ère)',
  equipier: 'Équipier(ère)',
  gouvernant: 'Gouvernant(e)',
};
const LIBELLES_TYPE_POSTE = { bureau: 'Bureau', hotel: 'Hôtel' };
const LIBELLES_COMMENT_CONNU = {
  bouche_a_oreille: 'Bouche à oreille',
  internet: 'Internet',
  cooptation: 'Cooptation',
  autre: 'Autre',
};
const LIBELLES_OUI_NON = { oui: 'Oui', non: 'Non' };
const LIBELLES_CONSENTEMENT_DIFFUSION = { autorise: 'Autorisée', refuse: 'Refusée' };
const LIBELLES_STATUT_PIECE = {
  en_attente: 'En attente',
  valide: 'Validée',
  rejete: 'Rejetée',
  orpheline: 'À recapturer (fichier perdu)',
};

function libelle(dictionnaire, code) {
  if (!code) return '-';
  return dictionnaire[code] ?? code;
}

function libelleListe(dictionnaire, codes) {
  if (!codes || codes.length === 0) return '-';
  return codes.map((code) => libelle(dictionnaire, code)).join(', ');
}

function formaterDate(valeur) {
  if (!valeur) return '-';
  return FORMAT_DATE.format(new Date(valeur));
}

// Une ligne "libellé : valeur" — évite de répéter la même structure pour chacun des ~25 champs
// affichés ci-dessous.
function Ligne({ libelle: intitule, valeur }) {
  return (
    <div className="informations-inscription__ligne">
      <span className="informations-inscription__libelle">{intitule}</span>
      <span className="informations-inscription__valeur">{valeur || '-'}</span>
    </div>
  );
}

// Section repliable "Informations d'inscription complètes" de la fiche dossier candidat
// (accessible via "Voir le dossier"/"Étudier le dossier", voir Relances.jsx/Validation.jsx) :
// reprend l'intégralité des données saisies par le candidat à l'inscription (état civil,
// coordonnées, situation professionnelle, mutuelle, consentement RGPD) ainsi que les pièces déjà
// reçues. <details>/<summary> natif plutôt qu'un état React dédié : repliée par défaut sans JS
// supplémentaire, comportement clavier/accessibilité déjà géré par le navigateur — le
// chargement réseau n'est déclenché qu'à la première ouverture (voir onToggle), pour ne pas
// alourdir le chargement de la fiche dossier par défaut.
//
// N'affiche jamais le NIR : dossierRepository.trouverInscriptionCompleteParDossierId (back) ne le
// sélectionne même pas — CLAUDE.md n'autorise son déchiffrement que côté serveur, pour un usage
// qui en a explicitement besoin, ce qui n'est pas le cas d'un affichage back-office générique
// comme celui-ci.
//
// dossierId reçu en prop, pas de useParams() ici : ce composant ne connaît rien du routage, même
// patron que HistoriqueRelances.jsx — à l'appelant de le lire depuis le paramètre de route.
export default function InformationsInscription({ dossierId }) {
  const [inscription, setInscription] = useState(null);
  const [pieces, setPieces] = useState([]);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState(null);

  // Vignette de la photo d'identité (voir CODE_PHOTO_IDENTITE) — même route/service que
  // "Voir" sur CaptureTablette.jsx (obtenirApercuPiece, GET .../pieces/:pieceId/apercu), donc le
  // même connecteur de stockage par entité (OneDrive/Microsoft Graph pour ACCECIT, voir
  // storageFactory côté back) que n'importe quelle autre pièce justificative — aucune route ni
  // logique de récupération propre à cette section. null tant qu'aucune photo n'est trouvée dans
  // `pieces` (dossier en cours, pas encore capturée) : distinct de chargement/erreur, sert de
  // condition "Non fournie" dans le rendu.
  const [photoIdentiteUrl, setPhotoIdentiteUrl] = useState(null);
  const [photoIdentiteChargement, setPhotoIdentiteChargement] = useState(false);
  const [photoIdentiteErreur, setPhotoIdentiteErreur] = useState(null);
  const [photoAgrandie, setPhotoAgrandie] = useState(false);

  // Révoque l'URL locale (blob) au démontage ou si elle change — même précaution que
  // CaptureTablette.jsx (PanneauApercuPiece) pour ne pas fuiter de mémoire.
  useEffect(() => {
    return () => {
      if (photoIdentiteUrl) URL.revokeObjectURL(photoIdentiteUrl);
    };
  }, [photoIdentiteUrl]);

  const gererOuverture = (evenement) => {
    if (!evenement.target.open || inscription) return;
    setChargement(true);
    setErreur(null);
    Promise.all([obtenirInscriptionComplete(dossierId), listerPiecesJustificatives(dossierId)])
      .then(([inscriptionValeur, piecesValeur]) => {
        setInscription(inscriptionValeur);
        setPieces(piecesValeur);

        const photoIdentite = piecesValeur.find((piece) => piece.type_piece_code === CODE_PHOTO_IDENTITE);
        if (!photoIdentite) return;
        setPhotoIdentiteChargement(true);
        obtenirApercuPiece(dossierId, photoIdentite.id)
          .then((blob) => setPhotoIdentiteUrl(URL.createObjectURL(blob)))
          .catch(() => setPhotoIdentiteErreur("Impossible de récupérer la photo d'identité."))
          .finally(() => setPhotoIdentiteChargement(false));
      })
      .catch((erreurRequete) => {
        setErreur(
          erreurRequete.response?.data?.erreur ?? "Impossible de récupérer les informations d'inscription.",
        );
      })
      .finally(() => setChargement(false));
  };

  const candidat = inscription?.candidat;
  const coordonnees = inscription?.blocs?.coordonnees ?? {};
  const disponibilites = inscription?.blocs?.disponibilites ?? {};
  const mutuelle = inscription?.blocs?.mutuelle ?? {};
  const consentementRgpd = inscription?.blocs?.consentement_rgpd ?? {};
  const postesRecherches = [...(disponibilites.posteBureau ?? []), ...(disponibilites.posteHotel ?? [])];

  return (
    <section className="informations-inscription">
      <details onToggle={gererOuverture}>
        <summary>Voir les informations d'inscription complètes</summary>

        {chargement && <p>Chargement…</p>}
        {erreur && <p role="alert">{erreur}</p>}

        {!chargement && !erreur && candidat && (
          <div className="informations-inscription__contenu">
            <div className="informations-inscription__groupe">
              <h3>Informations personnelles</h3>

              {/* Vignette cliquable, même route de récupération (obtenirApercuPiece) que "Voir"
                  sur CaptureTablette.jsx — voir son commentaire d'en-tête pour le détail du
                  stockage. "Non fournie" plutôt qu'un espace vide/une erreur tant que la pièce
                  (obligatoire mais capturée par l'accueil, pas par le candidat lui-même) n'a pas
                  encore été prise. */}
              <div className="informations-inscription__photo-identite">
                <span className="informations-inscription__libelle">Photo d'identité</span>
                {photoIdentiteChargement && <span className="informations-inscription__valeur">Chargement…</span>}
                {!photoIdentiteChargement && photoIdentiteErreur && (
                  <span className="informations-inscription__valeur" role="alert">
                    {photoIdentiteErreur}
                  </span>
                )}
                {!photoIdentiteChargement && !photoIdentiteErreur && photoIdentiteUrl && (
                  <button
                    type="button"
                    className="informations-inscription__photo-identite-bouton"
                    onClick={() => setPhotoAgrandie(true)}
                  >
                    <img
                      src={photoIdentiteUrl}
                      alt="Photo d'identité du candidat — cliquer pour agrandir"
                      className="informations-inscription__photo-identite-vignette"
                    />
                  </button>
                )}
                {!photoIdentiteChargement && !photoIdentiteErreur && !photoIdentiteUrl && (
                  <span className="informations-inscription__valeur">Non fournie</span>
                )}
              </div>

              <Ligne libelle="Civilité" valeur={libelle(LIBELLES_CIVILITE, candidat.civilite)} />
              <Ligne libelle="Nom" valeur={candidat.nom} />
              <Ligne libelle="Nom de naissance" valeur={candidat.nomNaissance} />
              <Ligne libelle="Prénom" valeur={candidat.prenom} />
              <Ligne libelle="Date de naissance" valeur={formaterDate(candidat.dateNaissance)} />
              <Ligne libelle="Lieu de naissance" valeur={candidat.lieuNaissance} />
              <Ligne libelle="Nationalité" valeur={candidat.nationalite} />
              <Ligne libelle="Situation familiale" valeur={candidat.situationFamiliale} />
              <Ligne libelle="Date d'inscription" valeur={formaterDate(candidat.dateInscription)} />
            </div>

            <div className="informations-inscription__groupe">
              <h3>Coordonnées</h3>
              <Ligne libelle="Adresse" valeur={coordonnees.adresse} />
              <Ligne libelle="Téléphone" valeur={coordonnees.telephone} />
              <Ligne libelle="Email" valeur={coordonnees.email ?? candidat.email} />
              <Ligne libelle="Contact d'urgence" valeur={coordonnees.contactUrgenceNom} />
              <Ligne libelle="Téléphone du contact d'urgence" valeur={coordonnees.contactUrgenceTelephone} />
            </div>

            <div className="informations-inscription__groupe">
              <h3>Situation professionnelle</h3>
              <Ligne
                libelle="Disponibilité"
                valeur={
                  disponibilites.disponibiliteImmediate
                    ? 'Immédiate'
                    : `Du ${formaterDate(disponibilites.dateDebut)} au ${formaterDate(disponibilites.dateFin)}`
                }
              />
              <Ligne libelle="Créneaux souhaités" valeur={libelleListe(LIBELLES_CRENEAU, disponibilites.creneaux)} />
              <Ligne
                libelle="Jours disponibles"
                valeur={libelleListe(LIBELLES_JOUR, disponibilites.joursDisponibles)}
              />
              <Ligne libelle="Langues parlées" valeur={libelleListe(LIBELLES_LANGUE, disponibilites.languesParlees)} />
              {disponibilites.autreLanguePrecision && (
                <Ligne libelle="Précision langue" valeur={disponibilites.autreLanguePrecision} />
              )}
              <Ligne
                libelle="Type de poste recherché"
                valeur={libelle(LIBELLES_TYPE_POSTE, disponibilites.typePoste)}
              />
              <Ligne libelle="Poste(s) recherché(s)" valeur={libelleListe(LIBELLES_POSTE, postesRecherches)} />
              <Ligne
                libelle="Comment nous a connu"
                valeur={libelle(LIBELLES_COMMENT_CONNU, disponibilites.commentConnu)}
              />
              {disponibilites.commentConnuPrecision && (
                <Ligne libelle="Précision" valeur={disponibilites.commentConnuPrecision} />
              )}
            </div>

            <div className="informations-inscription__groupe">
              <h3>Mutuelle d'entreprise</h3>
              <Ligne libelle="CMU-C" valeur={libelle(LIBELLES_OUI_NON, mutuelle.cas1CmuC)} />
              <Ligne libelle="ACS" valeur={libelle(LIBELLES_OUI_NON, mutuelle.cas2Acs)} />
              <Ligne
                libelle="Mutuelle individuelle"
                valeur={libelle(LIBELLES_OUI_NON, mutuelle.cas3MutuelleIndividuelle)}
              />
              <Ligne
                libelle="Mutuelle collective"
                valeur={libelle(LIBELLES_OUI_NON, mutuelle.cas4MutuelleCollective)}
              />
              <Ligne libelle="Dispense certifiée" valeur={mutuelle.certificationAucuneDispense ? 'Oui' : 'Non'} />
            </div>

            <div className="informations-inscription__groupe">
              <h3>Consentement RGPD</h3>
              <Ligne
                libelle="Autorisation de diffusion des données"
                valeur={libelle(LIBELLES_CONSENTEMENT_DIFFUSION, consentementRgpd.consentementDiffusion)}
              />
              {consentementRgpd.dateSignature && (
                <Ligne libelle="Signé le" valeur={formaterDate(consentementRgpd.dateSignature)} />
              )}
            </div>

            <div className="informations-inscription__groupe">
              <h3>Pièces jointes</h3>
              {pieces.length === 0 && (
                <p className="informations-inscription__vide">Aucune pièce reçue pour ce dossier.</p>
              )}
              {pieces.length > 0 && (
                <ul className="informations-inscription__pieces">
                  {pieces.map((piece) => (
                    <li key={piece.id}>
                      <span>{piece.type_piece_libelle}</span>
                      <span>{LIBELLES_STATUT_PIECE[piece.statut_verification] ?? piece.statut_verification}</span>
                      <span>{formaterDate(piece.date_upload)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </details>

      {photoAgrandie && photoIdentiteUrl && (
        <div
          className="informations-inscription__photo-identite-overlay"
          role="dialog"
          aria-label="Photo d'identité en grand"
          onClick={() => setPhotoAgrandie(false)}
        >
          <img src={photoIdentiteUrl} alt="Photo d'identité du candidat" />
          <button type="button" onClick={() => setPhotoAgrandie(false)}>
            Fermer
          </button>
        </div>
      )}
    </section>
  );
}
