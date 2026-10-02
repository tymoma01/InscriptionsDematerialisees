import StatutBadge from '../workflow/StatutBadge';

// Réponse « Êtes-vous étudiant ? » (dossiers.est_etudiant) en pastille — même forme, taille et
// typographie que BadgeExperience : les deux reposent sur la même pastille de base (StatutBadge,
// classe .statut-badge), seule la variante de couleur change (StatutBadge.css) :
//   - étudiant : 'etudiant' (bleu-gris doux de la palette, absent des pastilles de statut et
//     d'expérience affichées sur la même ligne de Dossiers candidats) ;
//   - non étudiant : 'non-etudiant' (gris neutre de « Pas d'expérience ») ;
//   - sans réponse (dossier antérieur à la question) : « — » en texte simple, sans pastille.
// libelleOui/libelleNon : « Oui »/« Non » là où l'intitulé « Étudiant » est déjà affiché à côté
// (informations d'inscription complètes) ; mêmes couleurs partout.
export default function BadgeEtudiant({ estEtudiant, libelleOui = 'Étudiant', libelleNon = 'Non étudiant' }) {
  if (estEtudiant !== true && estEtudiant !== false) return '—';
  return estEtudiant ? (
    <StatutBadge libelle={libelleOui} variante="etudiant" />
  ) : (
    <StatutBadge libelle={libelleNon} variante="non-etudiant" />
  );
}
