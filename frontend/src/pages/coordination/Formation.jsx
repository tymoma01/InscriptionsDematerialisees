import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import HistoriqueFormation from '../../core/dossier/HistoriqueFormation';
import InformationsInscription from '../../core/dossier/InformationsInscription';
import NavigationFicheDossier from '../../core/dossier/NavigationFicheDossier';
import StatutBadge from '../../core/workflow/StatutBadge';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import ErrorBoundary from '../../core/backOffice/ErrorBoundary';
import { obtenirDossier } from '../../services/dossierService';
import { useRafraichissementAuto } from '../../core/dossier/useRafraichissementAuto';
import './Formation.css';

// Mapping purement visuel, propre à cette page — même mapping que Relances.jsx/Validation.jsx,
// dupliqué plutôt que partagé (voir CLAUDE.md conventions du projet).
const VARIANTE_PAR_CODE_ACCECIT = {
  nouveau: 'neutre',
  en_attente_pieces: 'attente',
  en_attente_verification: 'attente', // workflow hérité, plus jamais atteint
  test_non_planifie: 'rose',
  test_planifie: 'bleu',
  test_realise: 'violet',
  test_non_realise: 'alerte',
  invalide: 'echec',
  valide_envoi_formation: 'succes',
  valide_pret_embauche: 'vert-clair',
  formation_non_validee: 'echec-fort',
  // Statut terminal "Embauché" (audit 2026-08-31) : 'vert-fonce', voir variables.css.
  embauche: 'vert-fonce',
};
function varianteStatut(code) {
  return VARIANTE_PAR_CODE_ACCECIT[code] ?? 'neutre';
}

// Nouvel onglet "Formation" de la fiche dossier (audit 2026-08-28, révise une décision antérieure
// — voir CLAUDE.md) : retrace l'historique de formation du candidat (voir
// core/dossier/HistoriqueFormation.jsx pour la logique de reconstitution des entrées). Même
// structure que Relances.jsx (dossierId depuis l'URL, chargement du dossier pour le titre/statut,
// rafraîchissement automatique du badge) — HistoriqueFormation.jsx gère son propre chargement,
// même patron que HistoriqueRelances.jsx.
export default function Formation() {
  const { dossierId } = useParams();

  const [dossier, setDossier] = useState(null);

  useEffect(() => {
    let annule = false;
    obtenirDossier(dossierId)
      .then((valeur) => {
        if (!annule) setDossier(valeur);
      })
      .catch(() => {});
    return () => {
      annule = true;
    };
  }, [dossierId]);

  useRafraichissementAuto(() => {
    obtenirDossier(dossierId)
      .then(setDossier)
      .catch(() => {});
  });

  return (
    <PageBackOffice>
      <div className="page-formation">
        <header className="page-formation__entete">
          <div className="page-formation__titre-bloc">
            <h1>
              Dossier #{dossierId}
              {dossier && (
                <>
                  {' - '}
                  <span className="page-formation__candidat-nom">{dossier.candidat_nom}</span> {dossier.candidat_prenom}
                </>
              )}
            </h1>
            {dossier && (
              <div className="page-formation__statut">
                <span className="page-formation__statut-libelle">Statut :</span>
                <StatutBadge libelle={dossier.statut_libelle} variante={varianteStatut(dossier.statut_code)} />
              </div>
            )}
          </div>
          <EnTeteBackOffice />
        </header>

        <NavigationFicheDossier dossierId={dossierId} pageActuelle="formation" />

        <ErrorBoundary key={`inscription-${dossierId}`} titre="Informations d'inscription complètes">
          <InformationsInscription dossierId={dossierId} />
        </ErrorBoundary>

        <ErrorBoundary key={`formation-${dossierId}`} titre="Formation">
          <HistoriqueFormation dossierId={dossierId} />
        </ErrorBoundary>
      </div>
    </PageBackOffice>
  );
}
