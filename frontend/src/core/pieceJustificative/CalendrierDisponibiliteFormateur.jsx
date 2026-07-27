import { useEffect, useState } from 'react';
import { listerRendezvousTest } from '../../services/rendezvousService';
import './CalendrierDisponibiliteFormateur.css';

const JOURS_SEMAINE = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

const FORMAT_MOIS_ANNEE = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
const FORMAT_HEURE = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

function pad(nombre) {
  return String(nombre).padStart(2, '0');
}

function formatDateJour(annee, moisIndex, jour) {
  return `${annee}-${pad(moisIndex + 1)}-${pad(jour)}`;
}

function moisCourant() {
  const maintenant = new Date();
  return { annee: maintenant.getFullYear(), moisIndex: maintenant.getMonth() };
}

// Clé jour dérivée en heure locale du navigateur, comme le reste du composant parent (voir
// dateHeureChoisieIso dans CaptureTablette.jsx) : cohérent avec la façon dont l'agent lit un
// horaire sur la tablette, pas une conversion UTC qui décalerait l'affichage d'un jour selon
// l'heure de la journée.
function cleJourLocal(dateHeureIso) {
  const date = new Date(dateHeureIso);
  return formatDateJour(date.getFullYear(), date.getMonth(), date.getDate());
}

// Premier jour du mois suivant (borne exclusive envoyée au back) — calcul manuel plutôt que
// Date().toISOString() : évite tout décalage de fuseau, {annee, moisIndex} restent des entiers
// calendaires purs jusqu'à leur formatage final en 'AAAA-MM-JJ'.
function moisSuivant({ annee, moisIndex }) {
  return moisIndex === 11 ? { annee: annee + 1, moisIndex: 0 } : { annee, moisIndex: moisIndex + 1 };
}

function moisPrecedent({ annee, moisIndex }) {
  return moisIndex === 0 ? { annee: annee - 1, moisIndex: 11 } : { annee, moisIndex: moisIndex - 1 };
}

// Calendrier mensuel des créneaux déjà occupés par un formateur (bloc "Planifier un test",
// CaptureTablette.jsx) — aide visuelle uniquement : le contrôle qui fait foi reste
// trouverRendezvousFormateurAuCreneau côté serveur (409 ErreurCreneauPris à la création). Charge
// dynamiquement les rendez-vous du mois affiché à chaque navigation, pour ne jamais rapatrier
// l'historique complet d'un formateur.
function CalendrierDisponibiliteFormateur({ formateurId, dateSelectionnee, onSelectionnerJour }) {
  const [moisAffiche, setMoisAffiche] = useState(moisCourant);
  const [creneaux, setCreneaux] = useState([]);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState(null);

  const { annee, moisIndex } = moisAffiche;

  useEffect(() => {
    if (!formateurId) {
      setCreneaux([]);
      return undefined;
    }
    let annule = false;
    setChargement(true);
    setErreur(null);
    const dateDebut = formatDateJour(annee, moisIndex, 1);
    const { annee: anneeFin, moisIndex: moisIndexFin } = moisSuivant({ annee, moisIndex });
    const dateFin = formatDateJour(anneeFin, moisIndexFin, 1);

    listerRendezvousTest({ formateurId: Number(formateurId), dateDebut, dateFin })
      .then((valeur) => {
        if (!annule) setCreneaux(valeur);
      })
      .catch(() => {
        if (!annule) setErreur('Impossible de récupérer les créneaux occupés de ce formateur.');
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, [formateurId, annee, moisIndex]);

  const creneauxParJour = new Map();
  creneaux.forEach((rendezvous) => {
    const cle = cleJourLocal(rendezvous.date_heure);
    if (!creneauxParJour.has(cle)) creneauxParJour.set(cle, []);
    creneauxParJour.get(cle).push(rendezvous);
  });

  // Décalage lundi-first (getDay() renvoie 0 pour dimanche) pour aligner le 1er du mois sous la
  // bonne colonne d'en-tête.
  const decalage = (new Date(annee, moisIndex, 1).getDay() + 6) % 7;
  const nombreJours = new Date(annee, moisIndex + 1, 0).getDate();
  const cases = [
    ...Array.from({ length: decalage }, () => null),
    ...Array.from({ length: nombreJours }, (_, index) => index + 1),
  ];

  const { annee: anneeAujourdHui, moisIndex: moisIndexAujourdHui } = moisCourant();
  const surMoisCourant = annee === anneeAujourdHui && moisIndex === moisIndexAujourdHui;
  const aujourdHuiJour = new Date().getDate();

  const libelleMois = FORMAT_MOIS_ANNEE.format(new Date(annee, moisIndex, 1));
  const libelleMoisCapitalise = libelleMois.charAt(0).toUpperCase() + libelleMois.slice(1);

  return (
    <div className="calendrier-disponibilite">
      <div className="calendrier-disponibilite__entete">
        <button type="button" onClick={() => setMoisAffiche(moisPrecedent({ annee, moisIndex }))} aria-label="Mois précédent">
          ‹
        </button>
        <div className="calendrier-disponibilite__titre">
          <span>{libelleMoisCapitalise}</span>
          {!surMoisCourant && (
            <button type="button" className="calendrier-disponibilite__aujourdhui" onClick={() => setMoisAffiche(moisCourant())}>
              Aujourd&rsquo;hui
            </button>
          )}
        </div>
        <button type="button" onClick={() => setMoisAffiche(moisSuivant({ annee, moisIndex }))} aria-label="Mois suivant">
          ›
        </button>
      </div>

      {chargement && <p className="calendrier-disponibilite__statut">Chargement des créneaux…</p>}
      {erreur && <p className="calendrier-disponibilite__statut" role="alert">{erreur}</p>}

      <div className="calendrier-disponibilite__grille">
        {JOURS_SEMAINE.map((jour) => (
          <div key={jour} className="calendrier-disponibilite__entete-jour">
            {jour}
          </div>
        ))}

        {cases.map((jour, index) => {
          if (jour === null) {
            return <div key={`vide-${index}`} className="calendrier-disponibilite__case calendrier-disponibilite__case--vide" />;
          }

          const dateJourIso = formatDateJour(annee, moisIndex, jour);
          const creneauxJour = creneauxParJour.get(dateJourIso) ?? [];
          const estAujourdHui = surMoisCourant && jour === aujourdHuiJour;
          const estSelectionne = dateJourIso === dateSelectionnee;

          return (
            <button
              type="button"
              key={dateJourIso}
              className={[
                'calendrier-disponibilite__case',
                estAujourdHui ? 'calendrier-disponibilite__case--aujourdhui' : '',
                estSelectionne ? 'calendrier-disponibilite__case--selectionne' : '',
              ].join(' ').trim()}
              onClick={() => onSelectionnerJour(dateJourIso)}
            >
              <span className="calendrier-disponibilite__jour-numero">{jour}</span>
              {creneauxJour.length > 0 && (
                <span className="calendrier-disponibilite__badges">
                  {creneauxJour.map((rendezvous) => (
                    <span key={rendezvous.id} className="calendrier-disponibilite__badge">
                      {FORMAT_HEURE.format(new Date(rendezvous.date_heure))}
                    </span>
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default CalendrierDisponibiliteFormateur;
