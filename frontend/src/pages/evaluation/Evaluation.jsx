import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useSession } from '../../core/auth/useSession';
import { useParametreURL } from '../../core/filtres/useParametreURL';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import ListeEvaluationsAFaire from '../../core/evaluation/ListeEvaluationsAFaire';
import GrilleEvaluation from '../../core/evaluation/GrilleEvaluation';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import { useRafraichissementAuto } from '../../core/dossier/useRafraichissementAuto';
import './Evaluation.css';

// « Évaluations à venir » d'un secteur — même page pour le Formateur (secteur 'hotellerie',
// /formateur/evaluations) et l'Inspecteur (secteur 'tertiaire', /inspecteur/evaluations).
// L'Admin y accède par les onglets « Formateur Hôtellerie »/« Formateur Tertiaire » et voit tout
// le secteur (`secteurVueAdmin`).
//
// Tertiaire : la liste n'est pas filtrée par évaluateur (calendrier partagé, chaque Inspecteur
// voit et peut traiter tous les tests du secteur, voir evaluationEngine) — d'où la colonne
// « Assigné à ». Le Formateur ne voit que ses propres tests.
//
// `rendezvousId` (paramètre d'URL, lien de convocation) : ouvre directement le bon rendez-vous.
export default function Evaluation({ secteur }) {
  const { utilisateur, chargement: chargementSession } = useSession();
  const [rendezvousSelectionne, setRendezvousSelectionne] = useState(null);
  const [compteurRafraichissement, setCompteurRafraichissement] = useState(0);

  const [rendezvousIdCible] = useParametreURL('rendezvousId', '');
  const { key: cleNavigation } = useLocation();

  // Un clic sur l'onglet courant (même URL, nouvelle clé de navigation) revient à la liste.
  useEffect(() => {
    setRendezvousSelectionne(null);
  }, [cleNavigation]);

  useRafraichissementAuto(() => setCompteurRafraichissement((compteur) => compteur + 1));

  if (chargementSession || !utilisateur) {
    return (
      <PageBackOffice>
        <p>Chargement de la session…</p>
      </PageBackOffice>
    );
  }

  const terminerEvaluation = () => {
    setRendezvousSelectionne(null);
    setCompteurRafraichissement((compteur) => compteur + 1);
  };

  const secteurVueAdmin = utilisateur.roleCode === 'admin' ? secteur : undefined;

  return (
    <PageBackOffice>
      <div className="page-evaluation">
        <header className="page-evaluation__entete">
          <div className="page-evaluation__titre-bloc">
            <h1>Évaluations à venir</h1>
          </div>
          <EnTeteBackOffice />
        </header>

        {!rendezvousSelectionne && (
          <ListeEvaluationsAFaire
            onSelectionner={setRendezvousSelectionne}
            rafraichir={compteurRafraichissement}
            rendezvousIdCible={rendezvousIdCible}
            secteurVueAdmin={secteurVueAdmin}
            afficherAssigne={secteur === 'tertiaire'}
          />
        )}

        {rendezvousSelectionne && (
          <GrilleEvaluation
            rendezvous={rendezvousSelectionne}
            roleCode={utilisateur.roleCode}
            onTermine={terminerEvaluation}
            onAnnuler={() => setRendezvousSelectionne(null)}
          />
        )}
      </div>
    </PageBackOffice>
  );
}
