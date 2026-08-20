import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../../core/auth/useSession';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import ListeEvaluationsAFaire from '../../core/evaluation/ListeEvaluationsAFaire';
import GrilleEvaluation from '../../core/evaluation/GrilleEvaluation';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import './Evaluation.css';

// Écran formateur (CLAUDE.md, section Rôles : "Formateur ... évalue les candidats, valide/
// invalide le test") — un seul écran à deux états, comme GestionRendezvous.jsx : la liste des
// rendez-vous de test à évaluer, puis la grille pour celui sélectionné. Une fois l'évaluation
// soumise, le rendez-vous disparaît de la liste (le serveur ne le renvoie plus, voir
// backend GET /api/evaluations/a-faire) — `compteurRafraichissement` force ListeEvaluationsAFaire
// à recharger sans dupliquer sa logique de fetch ici.
export default function Evaluation() {
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
      <div className="page-evaluation">
        <header className="page-evaluation__entete">
          <div className="page-evaluation__titre-bloc">
            <h1>Évaluations à venir</h1>
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
