import { useState } from 'react';
import './ChecklistInspection.css';

// Aide-mémoire de l'inspecteur avant/après le test bureau — purement informative, jamais envoyée
// au serveur ni liée à la soumission de l'évaluation (voir GrilleEvaluation.jsx, gererEnvoi : ne
// lit jamais l'état de ce composant). État local uniquement, remis à zéro à chaque nouvelle
// évaluation (ce composant est remonté avec elle, pas de useState partagé) — pas de trace
// attendue de ces cases, contrairement au commentaire/verdict de l'évaluation elle-même.
const ETAPES_AVANT_TEST = [
  { code: 'retrait_accessoires', libelle: 'Retrait casquette / foulard / manteau / sac' },
  { code: 'verification_identite', libelle: "Vérification des originaux d'identité (photo + date de validité)" },
  {
    code: 'verification_disponibilites',
    libelle: 'Vérification des disponibilités (matin 6h ou soir à partir de 18h, du lundi au vendredi impératif)',
  },
];

const ETAPES_APRES_TEST = [
  {
    code: 'photo_whatsapp',
    libelle: "Prise de photo et envoi via groupe WhatsApp (postulant + nom/prénom de l'agent)",
  },
  { code: 'verification_coordonnees', libelle: 'Vérification numéro de téléphone et adresse mail (ré-écrire si doute)' },
  { code: 'tableau_resultats', libelle: 'Remplir le tableau des résultats' },
  { code: 'orientation_planning', libelle: 'Diriger les candidats favorables vers le service planning' },
];

// `variante` pilote la teinte de fond/bordure de chaque sous-bloc (voir ChecklistInspection.css)
// — seule différence entre les deux appels ci-dessous, tout le reste du rendu reste identique.
function SectionChecklist({ titre, etapes, coches, onBasculer, variante }) {
  return (
    <fieldset className={`checklist-inspection__section checklist-inspection__section--${variante}`}>
      <legend>{titre}</legend>
      {etapes.map((etape) => (
        <label key={etape.code} className="checklist-inspection__etape">
          <input type="checkbox" checked={coches.has(etape.code)} onChange={() => onBasculer(etape.code)} />
          {etape.libelle}
        </label>
      ))}
    </fieldset>
  );
}

export default function ChecklistInspection() {
  const [coches, setCoches] = useState(() => new Set());

  const basculer = (code) => {
    setCoches((precedent) => {
      const suivant = new Set(precedent);
      if (suivant.has(code)) suivant.delete(code);
      else suivant.add(code);
      return suivant;
    });
  };

  return (
    <div className="checklist-inspection">
      <h2>Checklist</h2>
      {/* Deux colonnes côte à côte plutôt qu'empilées (voir ChecklistInspection.css) : occupe
          toute la largeur du bloc plutôt que de l'étirer verticalement. */}
      <div className="checklist-inspection__colonnes">
        <SectionChecklist
          titre="Avant le test"
          etapes={ETAPES_AVANT_TEST}
          coches={coches}
          onBasculer={basculer}
          variante="avant"
        />
        {/* Séparateur vertical entre les deux sous-blocs, en plus de leur bordure propre à
            chacun — masqué en colonne unique (voir ChecklistInspection.css), aria-hidden : purement
            décoratif, la légende de chaque fieldset porte déjà la structure pour un lecteur d'écran. */}
        <div className="checklist-inspection__separateur" aria-hidden="true" />
        <SectionChecklist
          titre="Après le test"
          etapes={ETAPES_APRES_TEST}
          coches={coches}
          onBasculer={basculer}
          variante="apres"
        />
      </div>
    </div>
  );
}
