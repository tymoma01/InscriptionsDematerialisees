import { useState } from 'react';
import { useSession } from '../../core/auth/useSession';
import { useParametreURL } from '../../core/filtres/useParametreURL';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import ListeEvaluationsAFaire from '../../core/evaluation/ListeEvaluationsAFaire';
import GrilleEvaluation from '../../core/evaluation/GrilleEvaluation';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import { useRafraichissementAuto } from '../../core/dossier/useRafraichissementAuto';
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

  // ?rendezvousId=... (lien "Voir l'évaluation de ce candidat" de l'email inspecteur, voir
  // formatageEmail.construireLienEvaluation) — même pattern que 'q' dans
  // ListeEvaluationsAFaire.jsx, transmis tel quel pour qu'il surligne/scrolle jusqu'à la ligne
  // correspondante (voir ListeEvaluationsAFaire.jsx, rendezvousIdCible). Même patron que
  // pages/formateur/Evaluation.jsx.
  const [rendezvousIdCible] = useParametreURL('rendezvousId', '');

  // Rafraîchissement automatique (audit 2026-08-24) : même patron que pages/formateur/Evaluation.jsx
  // (voir son commentaire) — réutilise compteurRafraichissement, aucune duplication de fetch.
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
      <div className="page-evaluation-inspecteur">
        <header className="page-evaluation-inspecteur__entete">
          <div className="page-evaluation-inspecteur__titre-bloc">
            <h1>Évaluations à venir</h1>
          </div>
          <EnTeteBackOffice />
        </header>

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
