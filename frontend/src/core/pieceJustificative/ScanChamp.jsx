import { useRef, useState } from 'react';
import { lireChamp } from './ocr/ocr';

/**
 * Bouton « Scanner » sous un champ lisible sur la pièce : ouvre l'appareil photo (caméra arrière),
 * lit ce seul champ sur la photo rapprochée et le renseigne via onValeur. La photo reste dans le
 * navigateur : jamais envoyée, enregistrée ni rattachée au dossier, et aucune valeur lue n'est
 * journalisée. Un champ non lu reste inchangé.
 *
 * nature : numero | delivree_le | expire_le | iban | bic (voir ocr/champ.js).
 */
export default function ScanChamp({ nature, onValeur, disabled }) {
  const entree = useRef(null);
  // aucun | en_cours | lu | illisible
  const [etat, setEtat] = useState('aucun');

  const apresPhoto = async (evenement) => {
    const photo = evenement.target.files?.[0];
    // Remis à zéro : la même photo peut être reprise, et le fichier n'est pas gardé par le champ.
    evenement.target.value = '';
    if (!photo) return;
    setEtat('en_cours');
    const valeur = await lireChamp(photo, nature);
    if (valeur) onValeur(valeur);
    setEtat(valeur ? 'lu' : 'illisible');
  };

  return (
    <div className="scan-champ">
      <input ref={entree} type="file" accept="image/*" capture="environment" hidden onChange={apresPhoto} />
      <button
        type="button"
        className="scan-champ__bouton"
        onClick={() => entree.current.click()}
        disabled={disabled || etat === 'en_cours'}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
          <circle cx="12" cy="13" r="3.5" />
        </svg>
        Scanner
      </button>
      {etat === 'en_cours' && (
        <p className="scan-champ__message" role="status">
          Lecture en cours…
        </p>
      )}
      {etat === 'lu' && (
        <p className="scan-champ__message" role="status">
          Lu sur la photo, vérifiez avant de confirmer.
        </p>
      )}
      {etat === 'illisible' && (
        <p className="scan-champ__message scan-champ__message--avertissement" role="status">
          Information illisible, rapprochez-vous ou saisissez-la à la main.
        </p>
      )}
    </div>
  );
}
