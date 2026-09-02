import { Link } from 'react-router-dom';
import { useSession } from '../auth/useSession';
import './BoutonNouvelleInscription.css';

// Codes de rôle en dur plutôt qu'une constante partagée : le projet n'exporte aujourd'hui aucun
// équivalent front de ROLES (backend/src/core/auth/rbac.js), même choix déjà fait ailleurs (ex.
// GestionRendezvous.ROLES_GESTION_RENDEZVOUS, HistoriqueRelances.jsx) pour leurs propres
// comparaisons de rôle.
// Admin ajouté (audit 2026-09-02, capture utilisateur : bouton absent pour ce rôle) — même
// périmètre que ROLES_GESTION_RENDEZVOUS/BarreNavigation.jsx (entrée "Dossiers candidats") :
// Admin voit et peut utiliser toutes les actions d'Accueil/Coordination sur cette page, jamais
// une exception isolée. POST /api/candidats (route liée, voir Link ci-dessous) reste public côté
// API — aucune vérification de rôle à assouplir là-bas, ce bouton n'ouvre qu'une porte déjà
// ouverte à quiconque connaît l'URL "/".
const ROLES_AUTORISES = ['accueil_coordination', 'admin'];

// SVG dessiné à la main (silhouette + badge "+"), dans le même esprit épuré qu'une icône
// lucide-react — le projet n'a aucune bibliothèque d'icônes installée (voir package.json), pas de
// quoi justifier une dépendance pour une seule icône.
function IconePersonnePlus() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="28"
      height="28"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="9" cy="7" r="4" />
      <path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2" />
      <line x1="19" y1="8" x2="19" y2="14" className="bouton-nouvelle-inscription__icone-plus" />
      <line x1="16" y1="11" x2="22" y2="11" className="bouton-nouvelle-inscription__icone-plus" />
    </svg>
  );
}

// Bouton flottant permanent (pas de prop, pas de placement par page appelante) : mêmes raisons
// que EnTeteBackOffice.jsx pour appeler son propre useSession() plutôt que de recevoir le rôle en
// prop — permet de monter ce bouton une seule fois dans PageBackOffice.jsx (partagé par les 9
// pages back-office, tous rôles) sans toucher chaque page individuellement. Ne rend rien tant que
// la session n'est pas résolue ou pour tout rôle hors ROLES_AUTORISES — Recruteur et Formateur/
// Inspecteur ne voient jamais ce bouton (une inscription ne relève ni de leur rôle ni de leur
// écran).
export default function BoutonNouvelleInscription() {
  const { utilisateur, chargement } = useSession();

  if (chargement || !ROLES_AUTORISES.includes(utilisateur?.roleCode)) {
    return null;
  }

  return (
    // Pas d'attribut title : sa bulle est dessinée par le système d'exploitation, impossible à
    // recolorer en CSS — remplacée par une infobulle maison (voir .bouton-nouvelle-inscription__infobulle,
    // affichée au survol/focus) pour reprendre le même dégradé bleu/violet que le bouton.
    // aria-label conservé : porte la même information pour un lecteur d'écran, indépendamment
    // du survol.
    <Link to="/" className="bouton-nouvelle-inscription" aria-label="Nouvelle inscription">
      <IconePersonnePlus />
      <span className="bouton-nouvelle-inscription__infobulle" aria-hidden="true">
        Nouvelle inscription
      </span>
    </Link>
  );
}
