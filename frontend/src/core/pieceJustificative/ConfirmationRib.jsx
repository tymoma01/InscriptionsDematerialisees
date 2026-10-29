import { useEffect, useState } from 'react';
import { confirmerRib } from '../../services/informationsPiecesService';
import { nomBanque } from './ocr/banques';
import { compacterIban, formaterIban, ibanValide } from './ocr/iban';
import { lireRib } from './ocr/ocr';
import './ConfirmationInformationsPieces.css';

const BIC = /^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/;

const versBrouillon = (rib) => ({ iban: rib?.iban ? formaterIban(rib.iban) : '', bic: rib?.bic ?? '' });

/** Erreurs de saisie par champ, mêmes règles que le serveur ({} si tout est correct). */
export function erreursRib({ iban, bic }) {
  const erreurs = {};
  if (!ibanValide(iban)) erreurs.iban = 'IBAN invalide : vérifiez chaque caractère (la clé de contrôle ne correspond pas).';
  if (!BIC.test(compacterIban(bic))) erreurs.bic = 'BIC invalide (8 ou 11 caractères).';
  return erreurs;
}

/**
 * IBAN et BIC, pré-remplis par la lecture (OCR, dans le navigateur) de la photo du RIB et confirmés
 * par l'accueil avant enregistrement. Seul un IBAN dont la clé modulo 97 concorde est pré-rempli
 * (voir ocr/rib.js) ; un PDF ou une photo illisible laissent la saisie manuelle.
 *
 * photo : { fichier, n } — dernière photo capturée du RIB (n change à chaque capture).
 * onEtatConfirmation(bool) : comme pour ConfirmationPieceIdentite.
 */
export default function ConfirmationRib({ dossierId, enregistre, photo, modifiable, onConfirme, onEtatConfirmation }) {
  const [brouillon, setBrouillon] = useState(() => versBrouillon(enregistre));
  // aucune | en_cours | lue | illisible
  const [lecture, setLecture] = useState('aucune');
  const [erreurs, setErreurs] = useState({});
  const [erreurEnvoi, setErreurEnvoi] = useState(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    if (!photo) return undefined;
    // PDF : pas de lecture, saisie manuelle.
    if (!photo.fichier.type.startsWith('image/')) {
      setLecture('illisible');
      return undefined;
    }
    let annule = false;
    setLecture('en_cours');
    lireRib(photo.fichier).then(({ iban, bic }) => {
      if (annule) return;
      if (!iban) {
        setLecture('illisible');
        return;
      }
      setBrouillon((b) => ({ iban: formaterIban(iban), bic: bic ?? b.bic }));
      setLecture('lue');
    });
    return () => {
      annule = true;
    };
  }, [photo]);

  const actuel = { iban: compacterIban(brouillon.iban), bic: compacterIban(brouillon.bic) };
  const confirme = Boolean(enregistre) && enregistre.iban === actuel.iban && enregistre.bic === actuel.bic;
  const aJour = confirme && lecture !== 'en_cours';
  useEffect(() => {
    onEtatConfirmation?.(aJour);
  }, [aJour, onEtatConfirmation]);

  const banque = ibanValide(brouillon.iban) ? nomBanque(actuel) : null;

  const changer = (cle) => (evenement) => setBrouillon((b) => ({ ...b, [cle]: evenement.target.value }));

  const confirmer = async () => {
    const trouvees = erreursRib(brouillon);
    setErreurs(trouvees);
    setErreurEnvoi(null);
    if (Object.keys(trouvees).length > 0) return;
    setEnvoi(true);
    try {
      const rib = await confirmerRib(dossierId, actuel);
      onConfirme(rib);
      setBrouillon(versBrouillon(rib));
    } catch (erreur) {
      setErreurEnvoi(erreur.response?.data?.erreur ?? 'Impossible d’enregistrer ces informations. Merci de réessayer.');
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <div className="confirmation-pieces">
      <h3 className="confirmation-pieces__titre">Coordonnées bancaires</h3>

      {lecture === 'en_cours' && (
        <p className="confirmation-pieces__etat" role="status">
          Lecture du RIB en cours…
        </p>
      )}
      {lecture === 'lue' && (
        <p className="confirmation-pieces__etat" role="status">
          IBAN lu sur le RIB : vérifiez-le avec le document en main{actuel.bic ? '' : ', complétez le BIC'} puis confirmez.
        </p>
      )}
      {lecture === 'illisible' && (
        <p className="confirmation-pieces__etat confirmation-pieces__etat--avertissement" role="status">
          IBAN non lu automatiquement : reprenez une photo nette du RIB à plat, ou recopiez l’IBAN et le BIC.
        </p>
      )}

      <fieldset className="confirmation-pieces__champs" disabled={!modifiable || lecture === 'en_cours'}>
        <div className="confirmation-pieces__champ confirmation-pieces__champ--large">
          <label htmlFor="rib-iban">IBAN</label>
          <input id="rib-iban" autoComplete="off" autoCapitalize="characters" value={brouillon.iban} onChange={changer('iban')} />
          {erreurs.iban && <p role="alert" className="confirmation-pieces__erreur">{erreurs.iban}</p>}
        </div>
        <div className="confirmation-pieces__champ">
          <label htmlFor="rib-bic">BIC</label>
          <input id="rib-bic" autoComplete="off" autoCapitalize="characters" value={brouillon.bic} onChange={changer('bic')} />
          {banque && <p className="confirmation-pieces__aide">{banque}</p>}
          {erreurs.bic && <p role="alert" className="confirmation-pieces__erreur">{erreurs.bic}</p>}
        </div>
      </fieldset>

      {erreurEnvoi && <p role="alert" className="confirmation-pieces__erreur">{erreurEnvoi}</p>}
      {confirme ? (
        <p className="confirmation-pieces__confirmee" role="status">
          ✓ Coordonnées bancaires confirmées par l’accueil
        </p>
      ) : (
        modifiable && (
          <button
            type="button"
            className="capture-tablette__bouton-action capture-tablette__bouton-action--primaire capture-tablette__bouton-action--compacte"
            onClick={confirmer}
            disabled={envoi || lecture === 'en_cours'}
          >
            {envoi ? 'Enregistrement…' : 'Confirmer ces informations'}
          </button>
        )
      )}
    </div>
  );
}
