import { useEffect, useState } from 'react';
import { listerFormateurs } from '../../services/formateurService';
import './SelecteurEvaluateurAdmin.css';

// Rôle des comptes proposés selon la vue Admin : "Vue Formateur" = secteur
// Hôtellerie -> Formateurs, "Vue Inspecteur" = secteur Tertiaire -> Inspecteurs.
const ROLE_PAR_SECTEUR = { hotellerie: 'formateur', tertiaire: 'inspecteur' };
// Libellés de rôle : 'formateur' = « Formateur Hôtellerie », 'inspecteur' = « Formateur
// Tertiaire » (codes techniques inchangés).
const LIBELLE_PAR_SECTEUR = { hotellerie: 'Formateur Hôtellerie', tertiaire: 'Formateur Tertiaire' };

// Sélecteur "Tous / [nom]" des vues Admin "Vue Formateur"/"Vue Inspecteur" —
// partagé par ListeEvaluationsAFaire.jsx et HistoriqueEvaluations.jsx plutôt que dupliqué dans
// chacun. Alimenté par GET /api/formateurs (Formateurs ET Inspecteurs actifs de l'entité, voir
// utilisateurService.listerFormateursEtInspecteurs), filtré ici sur le rôle correspondant au
// secteur de la vue. `valeur` = id sous forme de chaîne ('' = Tous), pour rester compatible avec un
// paramètre d'URL (voir useParametreURL chez les appelants). Rendu par les appelants UNIQUEMENT en
// vue Admin : le serveur ignore de toute façon ce filtre pour les autres rôles.
export default function SelecteurEvaluateurAdmin({ secteur, valeur, onChanger }) {
  const [evaluateurs, setEvaluateurs] = useState([]);

  useEffect(() => {
    let annule = false;
    listerFormateurs()
      .then((liste) => {
        if (!annule) setEvaluateurs(liste.filter((utilisateur) => utilisateur.role_code === ROLE_PAR_SECTEUR[secteur]));
      })
      .catch(() => {
        // Liste indisponible : le sélecteur reste sur "Tous" (vue complète du secteur), sans
        // bloquer l'écran pour un simple filtre d'affichage.
        if (!annule) setEvaluateurs([]);
      });
    return () => {
      annule = true;
    };
  }, [secteur]);

  return (
    <label className="selecteur-evaluateur-admin">
      <span>{LIBELLE_PAR_SECTEUR[secteur]}</span>
      <select value={valeur} onChange={(evenement) => onChanger(evenement.target.value)}>
        <option value="">Tous</option>
        {evaluateurs.map((evaluateur) => (
          <option key={evaluateur.id} value={String(evaluateur.id)}>
            {evaluateur.prenom} {evaluateur.nom}
          </option>
        ))}
      </select>
    </label>
  );
}
