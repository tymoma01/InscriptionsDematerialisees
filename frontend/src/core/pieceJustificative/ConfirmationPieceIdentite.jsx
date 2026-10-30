import { useEffect, useState } from 'react';
import { confirmerPieceIdentite, reporterPieceIdentite } from '../../services/informationsPiecesService';
import { TYPES_PIECE_IDENTITE } from '../referentiels/typesPieceIdentite';
import { ecarts } from './ocr/mrz';
import { lireMrz, lireVerso } from './ocr/ocr';
import './ConfirmationInformationsPieces.css';

const PIECE_VIDE = { type: '', numero: '', delivreeLe: '', expireLe: '' };

const MESSAGES_ECARTS = { nom: 'le nom', date_naissance: 'la date de naissance' };

const versBrouillon = (piece) => ({ ...PIECE_VIDE, ...Object.fromEntries(Object.entries(piece ?? {}).map(([cle, v]) => [cle, v ?? ''])) });

const compacter = (valeur) => valeur.replace(/\s+/g, '').toUpperCase();

/** Erreurs de saisie par champ, mêmes règles que le serveur ({} si tout est correct). */
export function erreursPiece({ type, numero, delivreeLe, expireLe }) {
  const erreurs = {};
  if (!TYPES_PIECE_IDENTITE.some((t) => t.code === type)) erreurs.type = 'Choisissez le type de pièce.';
  if (!/^[A-Z0-9]{5,30}$/.test(compacter(numero))) erreurs.numero = 'Numéro de 5 à 30 lettres et chiffres, tel qu’inscrit sur la pièce.';
  if (!expireLe) erreurs.expireLe = 'La date d’expiration est obligatoire.';
  else if (delivreeLe && expireLe <= delivreeLe) erreurs.expireLe = 'La date d’expiration doit suivre la date de délivrance.';
  return erreurs;
}

/**
 * Lecture d'une photo de la pièce : verso de l'ancienne carte (dates imprimées) puis bande MRZ.
 * Champs lus seulement s'ils se contrôlent (voir ocr/mrz.js, ocr/verso.js) ; null si rien n'est lu.
 */
async function lirePhoto({ fichier, verso }) {
  const dates = verso ? await lireVerso(fichier) : null;
  if (dates) return { dates };
  const mrz = await lireMrz(fichier);
  return mrz ? { mrz } : null;
}

/**
 * Informations de la pièce d'identité, pré-remplies par la lecture (OCR, dans le navigateur) de
 * chaque photo capturée, à confirmer par l'accueil avant enregistrement. Rien n'est enregistré
 * sans ce clic : une lecture n'écrase que les champs qu'elle a pu contrôler, et un nom ou une date
 * de naissance différents du formulaire sont signalés sans rien bloquer.
 *
 * photo : { fichier, verso, n } — dernière photo capturée de la pièce (n change à chaque capture).
 * aCompleter : l'accueil a choisi « Renseigner plus tard » (rien d'exigé, valeurs saisies conservées) ;
 * onReportee() : appelée une fois le report enregistré.
 * onEtatConfirmation(bool) : vrai quand ce qui est affiché est exactement ce qui est enregistré
 * (une nouvelle lecture ou une correction non encore confirmée le repasse à faux).
 */
export default function ConfirmationPieceIdentite({
  dossierId,
  candidat,
  enregistree,
  aCompleter = false,
  photo,
  modifiable,
  onConfirmee,
  onReportee,
  onEtatConfirmation,
}) {
  const [brouillon, setBrouillon] = useState(() => versBrouillon(enregistree));
  // aucune | en_cours | lue | illisible
  const [lecture, setLecture] = useState({ etat: 'aucune', mrz: null });
  const [erreurs, setErreurs] = useState({});
  const [erreurEnvoi, setErreurEnvoi] = useState(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    if (!photo?.fichier.type.startsWith('image/')) return undefined;
    let annule = false;
    setLecture((l) => ({ ...l, etat: 'en_cours' }));
    lirePhoto(photo).then((resultat) => {
      if (annule) return;
      if (!resultat) {
        // Une photo illisible ne fait pas oublier la lecture réussie de l'autre côté.
        setLecture((l) => (l.mrz || l.dates ? { ...l, etat: 'lue' } : { etat: 'illisible', mrz: null }));
        return;
      }
      const { mrz, dates } = resultat;
      setBrouillon((b) => ({
        ...b,
        type: mrz?.type ?? b.type,
        numero: mrz?.numero ?? b.numero,
        delivreeLe: dates?.delivree_le ?? b.delivreeLe,
        expireLe: mrz?.expire_le ?? dates?.expire_le ?? b.expireLe,
      }));
      setLecture((l) => ({ etat: 'lue', mrz: mrz ?? l.mrz, dates: dates ?? l.dates }));
    });
    return () => {
      annule = true;
    };
  }, [photo]);

  const confirmee = JSON.stringify(versBrouillon(enregistree)) === JSON.stringify({ ...brouillon, numero: compacter(brouillon.numero) });
  const aJour = Boolean(enregistree) && confirmee && lecture.etat !== 'en_cours';
  useEffect(() => {
    onEtatConfirmation?.(aJour);
  }, [aJour, onEtatConfirmation]);

  const differences =
    lecture.mrz && candidat
      ? ecarts(lecture.mrz, { nom: candidat.nom, nom_naissance: candidat.nomNaissance, date_naissance: candidat.dateNaissance })
      : [];

  const changer = (cle) => (evenement) => setBrouillon((b) => ({ ...b, [cle]: evenement.target.value }));

  const confirmer = async () => {
    const trouvees = erreursPiece(brouillon);
    setErreurs(trouvees);
    setErreurEnvoi(null);
    if (Object.keys(trouvees).length > 0) return;
    setEnvoi(true);
    try {
      const piece = await confirmerPieceIdentite(dossierId, {
        type: brouillon.type,
        numero: compacter(brouillon.numero),
        delivreeLe: brouillon.delivreeLe || null,
        expireLe: brouillon.expireLe,
      });
      onConfirmee(piece);
      setBrouillon(versBrouillon(piece));
    } catch (erreur) {
      setErreurEnvoi(erreur.response?.data?.erreur ?? 'Impossible d’enregistrer ces informations. Merci de réessayer.');
    } finally {
      setEnvoi(false);
    }
  };

  const reporter = async () => {
    setErreurEnvoi(null);
    setEnvoi(true);
    try {
      await reporterPieceIdentite(dossierId);
      onReportee?.();
    } catch (erreur) {
      setErreurEnvoi(erreur.response?.data?.erreur ?? 'Impossible d’enregistrer ce report. Merci de réessayer.');
    } finally {
      setEnvoi(false);
    }
  };

  const champ = (cle, libelle, saisie) => (
    <div className="confirmation-pieces__champ">
      <label htmlFor={`piece-identite-${cle}`}>{libelle}</label>
      {saisie}
      {erreurs[cle] && <p role="alert" className="confirmation-pieces__erreur">{erreurs[cle]}</p>}
    </div>
  );

  return (
    <div className="confirmation-pieces">
      <h3 className="confirmation-pieces__titre">
        Informations de la pièce
        {aCompleter && !enregistree && <span className="confirmation-pieces__badge">À compléter</span>}
      </h3>

      {lecture.etat === 'en_cours' && (
        <p className="confirmation-pieces__etat" role="status">
          Lecture de la pièce en cours…
        </p>
      )}
      {lecture.etat === 'lue' && (
        <p className="confirmation-pieces__etat" role="status">
          Informations lues sur la pièce : vérifiez-les avec le document en main, complétez les champs vides puis confirmez.
        </p>
      )}
      {lecture.etat === 'illisible' && (
        <p className="confirmation-pieces__etat confirmation-pieces__etat--avertissement" role="status">
          Bande de lecture (lignes de « &lt;&lt;&lt; ») introuvable sur cette photo : capturez l’autre face si elle la porte, reprenez une
          photo nette et sans reflet, ou recopiez les informations.
        </p>
      )}
      {differences.length > 0 && (
        <p className="confirmation-pieces__etat confirmation-pieces__etat--avertissement" role="alert">
          Attention : {differences.map((d) => MESSAGES_ECARTS[d]).join(' et ')} de la pièce ne correspond pas au formulaire
          d’inscription. Vérifiez qu’il s’agit bien de la pièce du candidat.
        </p>
      )}

      <fieldset className="confirmation-pieces__champs" disabled={!modifiable || lecture.etat === 'en_cours'}>
        {champ(
          'type',
          'Type de pièce',
          <select id="piece-identite-type" value={brouillon.type} onChange={changer('type')}>
            <option value="">Choisir…</option>
            {TYPES_PIECE_IDENTITE.map((t) => (
              <option key={t.code} value={t.code}>
                {t.libelle}
              </option>
            ))}
          </select>,
        )}
        {champ(
          'numero',
          'Numéro',
          <input id="piece-identite-numero" autoComplete="off" autoCapitalize="characters" value={brouillon.numero} onChange={changer('numero')} />,
        )}
        {champ(
          'delivreeLe',
          'Délivrée le (facultatif)',
          <input id="piece-identite-delivreeLe" type="date" value={brouillon.delivreeLe} onChange={changer('delivreeLe')} />,
        )}
        {champ(
          'expireLe',
          'Expire le',
          <input id="piece-identite-expireLe" type="date" value={brouillon.expireLe} onChange={changer('expireLe')} />,
        )}
      </fieldset>

      {erreurEnvoi && <p role="alert" className="confirmation-pieces__erreur">{erreurEnvoi}</p>}
      {confirmee && enregistree ? (
        <p className="confirmation-pieces__confirmee" role="status">
          ✓ Informations confirmées par l’accueil
        </p>
      ) : (
        modifiable && (
          <div className="confirmation-pieces__actions">
            <button
              type="button"
              className="capture-tablette__bouton-action capture-tablette__bouton-action--primaire capture-tablette__bouton-action--compacte"
              onClick={confirmer}
              disabled={envoi || lecture.etat === 'en_cours'}
            >
              {envoi ? 'Enregistrement…' : 'Confirmer ces informations'}
            </button>
            {!enregistree && !aCompleter && (
              <button
                type="button"
                className="capture-tablette__bouton-action capture-tablette__bouton-action--secondaire capture-tablette__bouton-action--compacte"
                onClick={reporter}
                disabled={envoi}
              >
                Renseigner plus tard
              </button>
            )}
          </div>
        )
      )}
    </div>
  );
}
