import { lignesSemaineType, PAUSE_ABSENTE } from './formatsDpae';
import './TableauSemaineType.css';

// Semaine type d'une demande DPAE en lecture : tableau Jour | Horaires | Pause | Site(s), jours travaillés
// seulement. Colonne Pause absente si aucun jour n'a de pause (lignesSemaineType).
export default function TableauSemaineType({ semaineType, sitesAffectation }) {
  const { lignes, avecPause } = lignesSemaineType(semaineType, sitesAffectation);
  if (lignes.length === 0) return <p>Aucun jour de travail renseigné.</p>;
  return (
    <div className="tableau-semaine-type">
      <table className={`tableau-semaine-type__table${avecPause ? ' tableau-semaine-type__table--avec-pause' : ''}`}>
        <colgroup>
          <col className="tableau-semaine-type__col-jour" />
          <col className="tableau-semaine-type__col-horaires" />
          {avecPause && <col className="tableau-semaine-type__col-pause" />}
          <col />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Jour</th>
            <th scope="col">Horaires</th>
            {avecPause && <th scope="col">Pause</th>}
            <th scope="col">Site(s)</th>
          </tr>
        </thead>
        <tbody>
          {lignes.map((ligne) => (
            <tr key={ligne.cle}>
              <th scope="row">{ligne.jour}</th>
              <td>{ligne.horaires}</td>
              {avecPause && <td>{ligne.pause}</td>}
              <td>
                {ligne.sites.length === 0
                  ? PAUSE_ABSENTE
                  : ligne.sites.map((site) => (
                      <div key={site}>{site}</div>
                    ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
