import { useState } from 'react';
import { useSession } from '../../core/auth/useSession';
import { useParametreURL } from '../../core/filtres/useParametreURL';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import ModaleMonProfil from '../../core/auth/ModaleMonProfil';
import ListeEvaluationsAFaire from '../../core/evaluation/ListeEvaluationsAFaire';
import GrilleEvaluation from '../../core/evaluation/GrilleEvaluation';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import { useRafraichissementAuto } from '../../core/dossier/useRafraichissementAuto';
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
  const [profilOuvert, setProfilOuvert] = useState(false);

  // ?rendezvousId=... (lien "Voir l'évaluation de ce candidat" de l'email formateur, voir
  // formatageEmail.construireLienEvaluation) — même pattern que 'q' dans
  // ListeEvaluationsAFaire.jsx, transmis tel quel pour qu'il surligne/scrolle jusqu'à la ligne
  // correspondante (voir ListeEvaluationsAFaire.jsx, rendezvousIdCible).
  const [rendezvousIdCible] = useParametreURL('rendezvousId', '');

  // Rafraîchissement automatique (audit 2026-08-24) : réutilise le mécanisme déjà en place
  // (compteurRafraichissement, voir son commentaire d'en-tête) plutôt que de dupliquer la logique
  // de fetch — ListeEvaluationsAFaire n'est de toute façon montée que quand !rendezvousSelectionne,
  // sans risque de perturber une évaluation en cours de saisie (GrilleEvaluation).
  useRafraichissementAuto(() => setCompteurRafraichissement((compteur) => compteur + 1));

  // Session sans objet à vérifier ici (RouteProtegee, App.jsx, redirige déjà vers
  // /connexion?redirection=... — avec rendezvousId toujours dans l'URL — avant même de monter
  // cette page en l'absence de session) — `!utilisateur` ne couvre plus qu'un très bref instant où
  // le useSession() PROPRE à cette page (ci-dessus) n'a pas encore résolu le sien.
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

  return (
    <PageBackOffice>
      <div className="page-evaluation">
        <header className="page-evaluation__entete">
          <div className="page-evaluation__titre-bloc">
            <h1>Évaluations à venir</h1>
          </div>
          <EnTeteBackOffice>
            <button type="button" className="en-tete-back-office__action" onClick={() => setProfilOuvert(true)}>
              Mon profil
            </button>
          </EnTeteBackOffice>
        </header>

        {profilOuvert && <ModaleMonProfil onFermer={() => setProfilOuvert(false)} />}

        {!rendezvousSelectionne && (
          <ListeEvaluationsAFaire
            onSelectionner={setRendezvousSelectionne}
            rafraichir={compteurRafraichissement}
            rendezvousIdCible={rendezvousIdCible}
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
