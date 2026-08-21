import { Link } from 'react-router-dom';
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
  { cle: 'pieces', libelle: 'Pièces justificatives', vers: (dossierId) => `/accueil/dossiers/${dossierId}/pieces` },
  { cle: 'tests', libelle: 'Tests', vers: (dossierId) => `/coordination/dossiers/${dossierId}/tests` },
  { cle: 'relances', libelle: 'Relances', vers: (dossierId) => `/coordination/dossiers/${dossierId}/relances` },
];

export default function NavigationFicheDossier({ dossierId, pageActuelle }) {
  return (
    <nav className="navigation-fiche-dossier" aria-label="Sections du dossier">
      {ONGLETS.map((onglet) =>
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
