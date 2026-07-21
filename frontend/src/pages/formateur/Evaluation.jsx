import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../../core/auth/useSession';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import ListeEvaluationsAFaire from '../../core/evaluation/ListeEvaluationsAFaire';
import GrilleEvaluation from '../../core/evaluation/GrilleEvaluation';
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
    return <p>Chargement de la session…</p>;
  }

  if (!utilisateur) {
    return (
      <p role="alert">
        Vous devez être connecté pour évaluer un test. <Link to="/connexion">Se connecter</Link>
      </p>
    );
  }

  const terminerEvaluation = () => {
    setRendezvousSelectionne(null);
    setCompteurRafraichissement((compteur) => compteur + 1);
  };

  return (
    <main className="page-evaluation">
      <header className="page-evaluation__entete">
        <h1>Évaluations à faire</h1>
        <EnTeteBackOffice />
      </header>

      {!rendezvousSelectionne && (
        <ListeEvaluationsAFaire onSelectionner={setRendezvousSelectionne} rafraichir={compteurRafraichissement} />
      )}

      {rendezvousSelectionne && (
        <GrilleEvaluation
          rendezvous={rendezvousSelectionne}
          onTermine={terminerEvaluation}
          onAnnuler={() => setRendezvousSelectionne(null)}
        />
      )}
    </main>
  );
}
