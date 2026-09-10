import StatutBadge from '../workflow/StatutBadge';
import './DetailEvaluation.css';

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

// Mêmes codes/libellés que BlocDisponibilites.jsx/GrilleEvaluation.jsx/HistoriqueEvaluations.jsx
// (dupliqué plutôt que partagé, voir leurs commentaires respectifs).
const POSTE_HOTEL_LIBELLES = {
  femme_valet_chambre: 'Femme/Valet de chambre',
  cafetier: 'Cafétier(ère)',
  equipier: 'Équipier(ère)',
  gouvernant: 'Gouvernant(e)',
};
const POSTE_BUREAU_LIBELLES = {
  nettoyage: 'Nettoyage',
  vitrerie: 'Vitrerie',
  machiniste: 'Machiniste',
  chef_equipe: "Chef d'équipe",
  autres: 'Autres',
};

// Échelles de réponse — mêmes valeurs que backend evaluationEngine.js (ACQUIS_AUTORISEES /
// CHOIX_MULTIPLE_VALEURS) et GrilleEvaluation.jsx (ACQUIS / NIVEAUX_BUREAU), traduites en libellés
// lisibles pour cet affichage lecture seule. aucune_connaissance/excellent : échelle du
// questionnaire bureau (Inspecteur).
const LIBELLES_ACQUIS = {
  acquis: 'Acquis',
  non_acquis: 'Non acquis',
  a_ameliorer: 'A améliorer',
  aucune_connaissance: 'Aucune connaissance',
  excellent: 'Excellent',
};
const LIBELLES_CHOIX_MULTIPLE = { coche: 'Coché', non_coche: 'Non coché' };
// 'oui_non' (audit 2026-08-26, ex. "DEBUTANT(E)") — voir backend evaluationEngine.js,
// OUI_NON_AUTORISEES.
const LIBELLES_OUI_NON = { oui: 'Oui', non: 'Non' };

function libelleValeur(typeQuestion, valeur) {
  if (typeQuestion === 'grille_qcu') return LIBELLES_ACQUIS[valeur] ?? valeur;
  if (typeQuestion === 'choix_multiple') return LIBELLES_CHOIX_MULTIPLE[valeur] ?? valeur;
  if (typeQuestion === 'oui_non') return LIBELLES_OUI_NON[valeur] ?? valeur;
  return valeur;
}

// postesCodes : plusieurs postes peuvent avoir été évalués dans une même évaluation (blocs
// empilés, voir GrilleEvaluation.jsx / backend evaluationEngine.enregistrerEvaluation) — tableau
// vide = repli générique (dossier bureau, ou poste hôtel sans questionnaire dédié).
function libellePostes(postesCodes) {
  if (!postesCodes || postesCodes.length === 0) return 'Générique';
  return postesCodes.map((posteCode) => POSTE_HOTEL_LIBELLES[posteCode] ?? POSTE_BUREAU_LIBELLES[posteCode] ?? posteCode).join(', ');
}

// Voir HistoriqueEvaluations.jsx pour le même repli sur "prêt à l'embauche" quand orientation est
// NULL (verdict positif d'Inspecteur, bureau).
function libelleResultat(evaluation) {
  if (evaluation.resultatGlobal === 'invalide') return 'Invalidé';
  if (evaluation.orientation === 'envoi_formation') return 'Validé - envoyé en formation';
  return "Validé - prêt à l'embauche";
}

// Même distinction que HistoriqueEvaluations.jsx (varianteResultat) — vert-clair pour "prêt à
// l'embauche", succes pour "envoyé en formation", pour ne pas afficher deux verdicts positifs
// distincts sous la même couleur.
function varianteResultat(evaluation) {
  if (evaluation.resultatGlobal === 'invalide') return 'echec';
  return evaluation.orientation === 'envoi_formation' ? 'succes' : 'vert-clair';
}

// Rendu pur (aucun fetch, aucun état) du détail d'une évaluation déjà soumise — extrait de
// DetailEvaluation.jsx (demande utilisateur 2026-09-10) pour être réutilisé tel quel par
// Validation.jsx (section "Critères de validation du test" de la fiche dossier, visible
// uniquement une fois un test effectué) sans dupliquer ni la construction des libellés, ni le
// balisage. DetailEvaluation.jsx (historique du formateur, fetch par evaluationId) reste le seul
// consommateur qui ajoute lui-même le chargement/l'erreur/le bouton "Retour à l'historique" autour
// de ce contenu — aucun des deux n'a de sens pour Validation.jsx, qui affiche ce contenu inline,
// jamais comme un écran à part avec un retour.
export default function ContenuDetailEvaluation({ detail }) {
  const { evaluation, questions } = detail;

  return (
    <>
      <h2>
        Évaluation - {evaluation.candidatPrenom} {evaluation.candidatNom}
      </h2>

      <dl className="detail-evaluation__meta">
        <div>
          <dt>Poste(s) évalué(s)</dt>
          <dd>{libellePostes(evaluation.postesCodes)}</dd>
        </div>
        <div>
          <dt>Date du test</dt>
          <dd>{FORMAT_DATE.format(new Date(evaluation.dateEvaluation))}</dd>
        </div>
        <div>
          <dt>Résultat</dt>
          <dd>
            <StatutBadge libelle={libelleResultat(evaluation)} variante={varianteResultat(evaluation)} />
          </dd>
        </div>
      </dl>

      {questions.map((question) => (
        <fieldset key={question.code} className="detail-evaluation__question">
          <legend>{question.libelle}</legend>
          {question.type_question === 'texte_libre' ? (
            <p className="detail-evaluation__texte-libre">{question.valeur?.trim() ? question.valeur : '-'}</p>
          ) : question.type_question === 'oui_non' ? (
            // oui_non : une seule réponse portée par question.valeur (pas question.items, voir
            // backend evaluationEngine.construireDetailEvaluation) — même forme que texte_libre
            // ci-dessus, jamais question.items.map ici.
            <p className="detail-evaluation__texte-libre">{libelleValeur('oui_non', question.valeur)}</p>
          ) : (
            <ul className="detail-evaluation__items">
              {question.items.map((item) => (
                <li key={item.code}>
                  <span>{item.libelle}</span>
                  <strong>{libelleValeur(question.type_question, item.valeur)}</strong>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      ))}

      <div className="detail-evaluation__commentaire">
        <h3>Commentaire</h3>
        <p>{evaluation.commentaire}</p>
      </div>
    </>
  );
}
