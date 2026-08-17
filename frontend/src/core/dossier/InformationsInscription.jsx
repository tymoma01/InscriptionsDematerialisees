import { useEffect, useState } from 'react';
import { obtenirInscriptionComplete } from '../../services/dossierService';
import { listerPiecesJustificatives } from '../../services/pieceJustificativeService';
import './InformationsInscription.css';

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

  const gererOuverture = (evenement) => {
    if (!evenement.target.open || inscription) return;
    setChargement(true);
    setErreur(null);
    Promise.all([obtenirInscriptionComplete(dossierId), listerPiecesJustificatives(dossierId)])
      .then(([inscriptionValeur, piecesValeur]) => {
        setInscription(inscriptionValeur);
        setPieces(piecesValeur);
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
    </section>
  );
}
