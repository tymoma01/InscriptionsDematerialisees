import { Link } from 'react-router-dom';
import { useSession } from '../auth/useSession';
import { peut } from '../auth/permissions';
import './NavigationFicheDossier.css';

// Bandeau d'accès rapide entre les écrans d'un même dossier — patch léger (décision utilisateur,
// 2026-08-21) : chaque écran (Validation.jsx/VerificationPieces.jsx/Relances.jsx) reste une route
// dédiée, ce composant ne fait qu'afficher où on se trouve et permettre d'aller directement aux
// deux autres sans repasser par le tableau de bord. Avant ce bandeau, /pieces et /relances
// n'affichaient aucune section "Relances"/"Pièces" et ne laissaient deviner ni leur existence ni
// comment y accéder depuis là où on se trouvait.
//
// Générique (core/dossier/) : ne connaît aucun statut ni règle de disponibilité propre à une
// entité (voir Modularité, CLAUDE.md) — contrairement au lien "Relances" de Validation.jsx, qui
// lui reste gardé par STATUTS_RELANCES_AUTORISEES. Les trois onglets sont donc toujours affichés
// ici ; une entité qui n'active pas un de ces écrans ne doit simplement pas monter ce composant sur
// la route correspondante (rien à configurer côté bandeau lui-même).
const ONGLETS = [
  { cle: 'validation', libelle: 'Dossier', vers: (dossierId) => `/recruteur/dossiers/${dossierId}/validation` },
  // Écran de GESTION des pièces (ajout, remplacement, suppression) : réservé aux rôles qui peuvent
  // écrire — les autres (RH, Formateur, Inspecteur) consultent et téléchargent les
  // pièces depuis l'onglet « Dossier », sans jamais tomber sur des actions refusées (403).
  { cle: 'pieces', libelle: 'Pièces justificatives', vers: (dossierId) => `/accueil/dossiers/${dossierId}/pieces`, permission: 'gestionPieces' },
  // Tests, Relances, Formation : leurs données sont refusées à la RH côté serveur —
  // onglets affichés seulement aux rôles qui peuvent les lire.
  { cle: 'tests', libelle: 'Tests', vers: (dossierId) => `/coordination/dossiers/${dossierId}/tests`, permission: 'lectureRendezvous' },
  { cle: 'relances', libelle: 'Relances', vers: (dossierId) => `/coordination/dossiers/${dossierId}/relances`, permission: 'lectureRelances' },
  // Historique de formation (audit 2026-08-28, révise une décision antérieure — voir CLAUDE.md) :
  // même patron que les trois onglets ci-dessus, toujours affiché (voir commentaire d'en-tête de
  // ce fichier — pas de règle de disponibilité propre à une entité ici).
  { cle: 'formation', libelle: 'Formation', vers: (dossierId) => `/coordination/dossiers/${dossierId}/formation`, permission: 'lectureFormation' },
];

export default function NavigationFicheDossier({ dossierId, pageActuelle }) {
  const { utilisateur } = useSession();
  // `permission` absente : onglet visible pour tous.
  const onglets = ONGLETS.filter((onglet) => !onglet.permission || peut(utilisateur, onglet.permission));
  return (
    <nav className="navigation-fiche-dossier" aria-label="Sections du dossier">
      {onglets.map((onglet) =>
        onglet.cle === pageActuelle ? (
          <span
            key={onglet.cle}
            className="navigation-fiche-dossier__onglet navigation-fiche-dossier__onglet--actif"
            aria-current="page"
          >
            {onglet.libelle}
          </span>
        ) : (
          <Link key={onglet.cle} className="navigation-fiche-dossier__onglet" to={onglet.vers(dossierId)}>
            {onglet.libelle}
          </Link>
        ),
      )}
    </nav>
  );
}
