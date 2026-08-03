import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../../core/auth/useSession';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import ListeEvaluationsAFaire from '../../core/evaluation/ListeEvaluationsAFaire';
import GrilleEvaluation from '../../core/evaluation/GrilleEvaluation';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import './Evaluation.css';

// Écran inspecteur (rôle INSPECTEUR, voir backend rbac.js) : section dédiée pour les postes
// bureau, distincte de pages/formateur/Evaluation.jsx (hôtel) — même patron "une section par
// rôle" que le reste du back-office (accueil, coordination, recruteur, formateur, admin), voir
// App.jsx. Dupliqué depuis Evaluation.jsx plutôt que partagé (une seule route par rôle, jamais de
// route paramétrée par rôle dans ce projet) : ListeEvaluationsAFaire/GrilleEvaluation (core), eux,
// restent entièrement réutilisés tels quels — GrilleEvaluation connaît déjà l'affichage propre à
// l'Inspecteur via son prop roleCode (échelle bureau, pas d'Orientation, checklist).
//
// Scope "bureau uniquement" : procédural, pas technique (voir rbac.js) — ListeEvaluationsAFaire
// ne renvoie que les rendez-vous assignés à CET utilisateur connecté (formateur_id, back
// evaluationRepository.listerRendezvousAEvaluer), qu'il soit Formateur ou Inspecteur ; la garantie
// tient à ce qu'Accueil/Coordination n'assigne un Inspecteur qu'à des tests bureau (voir
// ModalePlanificationTest.jsx, onglet "Inspecteurs").
export default function EvaluationInspecteur() {
  const { utilisateur, chargement: chargementSession } = useSession();
  const [rendezvousSelectionne, setRendezvousSelectionne] = useState(null);
  const [compteurRafraichissement, setCompteurRafraichissement] = useState(0);

  if (chargementSession) {
    return (
      <PageBackOffice>
        <p>Chargement de la session…</p>
      </PageBackOffice>
    );
  }

  if (!utilisateur) {
    return (
      <PageBackOffice>
        <p role="alert">
          Vous devez être connecté pour évaluer un test. <Link to="/connexion">Se connecter</Link>
        </p>
      </PageBackOffice>
    );
  }

  const terminerEvaluation = () => {
    setRendezvousSelectionne(null);
    setCompteurRafraichissement((compteur) => compteur + 1);
  };

  return (
    <PageBackOffice>
      <div className="page-evaluation-inspecteur">
        <header className="page-evaluation-inspecteur__entete">
          <div className="page-evaluation-inspecteur__titre-bloc">
            <h1>Évaluations à faire</h1>
            <Link to="/inspecteur/historique" className="page-evaluation-inspecteur__bouton-historique">
              Historique des évaluations
            </Link>
          </div>
          <EnTeteBackOffice />
        </header>

        {!rendezvousSelectionne && (
          <ListeEvaluationsAFaire onSelectionner={setRendezvousSelectionne} rafraichir={compteurRafraichissement} />
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
