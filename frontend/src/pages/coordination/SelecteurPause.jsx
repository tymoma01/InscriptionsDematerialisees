import { HEURES_PAUSE, MINUTES_PAUSE } from '../../core/dpae/formulaireDemandeDpae';

// Pause d'une journée : deux listes déroulantes (heures, minutes) ; la valeur échangée est un total
// de minutes (entier), comme dans la semaine type enregistrée.
// `idHeures` (facultatif) : id de la liste des heures, pour qu'une étiquette « Pause » puisse s'y lier.
export default function SelecteurPause({ minutes, onChanger, invalide = false, libelleJour = '', idHeures }) {
  const heures = Math.floor((minutes ?? 0) / 60);
  const minutesRestantes = (minutes ?? 0) % 60;
  const suffixe = libelleJour ? ` ${libelleJour}` : '';
  return (
    <span className="page-demande-dpae__pause">
      <select
        id={idHeures}
        aria-label={`Pause${suffixe} : heures`}
        aria-invalid={invalide || undefined}
        value={heures}
        onChange={(e) => onChanger(Number(e.target.value) * 60 + minutesRestantes)}
      >
        {HEURES_PAUSE.map((valeur) => (
          <option key={valeur} value={valeur}>
            {valeur} h
          </option>
        ))}
      </select>
      <select
        aria-label={`Pause${suffixe} : minutes`}
        aria-invalid={invalide || undefined}
        value={minutesRestantes}
        onChange={(e) => onChanger(heures * 60 + Number(e.target.value))}
      >
        {MINUTES_PAUSE.map((valeur) => (
          <option key={valeur} value={valeur}>
            {String(valeur).padStart(2, '0')}
          </option>
        ))}
      </select>
    </span>
  );
}
