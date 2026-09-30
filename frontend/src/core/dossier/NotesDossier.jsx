import { useEffect, useState } from 'react';
import { useSession } from '../auth/useSession';
import { listerNotesDossier, ajouterNoteDossier } from '../../services/noteDossierService';
import { useRafraichissementAuto } from './useRafraichissementAuto';
import './NotesDossier.css';

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const LONGUEUR_MAX_CONTENU = 1000;

// Journal de notes libres sur un dossier, indépendant des relances (voir CLAUDE.md, tâche
// "journal de notes horodatées") — chaque note est un ajout permanent (pas de modification/
// suppression), consultable et alimentable par tout agent back-office ayant accès au dossier
// (voir notes.routes.js, ROLES_NOTES_DOSSIER). Composant générique, réutilisé sur les 3 écrans où
// un dossier est consulté en détail (VerificationPieces.jsx, Relances.jsx, Validation.jsx) — pas
// de layout commun entre ces trois pages pour l'y intégrer autrement (chacune duplique déjà son
// propre <h1>Dossier #id) — voir Modularité, CLAUDE.md, même patron que HistoriqueRelances.jsx.
//
// dossierId reçu en prop, comme HistoriqueRelances.jsx/GestionRendezvous.jsx — ce composant ne
// connaît rien du routage.
//
// Réutilisable pour une autre cible que le dossier (2026-09-30 : notes d'une demande DPAE, voir
// DetailDemandeDpae.jsx) — même rendu, mêmes règles. Il suffit de fournir `cibleId` et les deux
// fonctions d'accès `lister(cibleId)` / `ajouter(cibleId, { contenu })` (réponse de même forme :
// id, contenu, date_creation, auteur_prenom, auteur_nom, auteur_role_libelle), plus les textes
// propres à la cible. Sans ces props : comportement historique du dossier, inchangé.
export default function NotesDossier({
  dossierId,
  cibleId = dossierId,
  lister = listerNotesDossier,
  ajouter = ajouterNoteDossier,
  texteAucuneNote = 'Aucune note enregistrée pour ce dossier.',
  texteErreurChargement = 'Impossible de récupérer les notes de ce dossier.',
}) {
  const { utilisateur, chargement: chargementSession } = useSession();

  const [notes, setNotes] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);

  const [contenu, setContenu] = useState('');
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [erreurEnvoi, setErreurEnvoi] = useState(null);

  const chargerNotes = () => {
    setChargement(true);
    setErreur(null);
    return lister(cibleId)
      .then(setNotes)
      .catch((erreur) => setErreur(erreur.response?.data?.erreur ?? texteErreurChargement))
      .finally(() => setChargement(false));
  };

  useEffect(() => {
    chargerNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cibleId]);

  // Rafraîchissement automatique (audit 2026-08-24) : ne touche que la liste des notes déjà
  // reçues, jamais `contenu` (le brouillon de note en cours de saisie, état séparé ci-dessus) —
  // aucun risque de perdre une note en cours de frappe.
  useRafraichissementAuto(chargerNotes);

  const gererEnvoi = async (evenement) => {
    evenement.preventDefault();
    const contenuNettoye = contenu.trim();
    if (!contenuNettoye) return;
    setEnvoiEnCours(true);
    setErreurEnvoi(null);
    try {
      await ajouter(cibleId, { contenu: contenuNettoye });
      setContenu('');
      await chargerNotes();
    } catch (erreur) {
      setErreurEnvoi(
        erreur.response
          ? (erreur.response.data?.erreur ?? "Le serveur n'a pas pu enregistrer la note. Merci de réessayer.")
          : 'Connexion au serveur impossible. Vérifiez le réseau et réessayez.',
      );
    } finally {
      setEnvoiEnCours(false);
    }
  };

  if (chargementSession) {
    return <p>Chargement de la session…</p>;
  }

  if (!utilisateur) {
    return <p role="alert">Vous devez être connecté pour consulter les notes.</p>;
  }

  return (
    <section className="notes-dossier">
      <h2>Notes</h2>

      {chargement && <p>Chargement des notes…</p>}
      {erreur && <p role="alert">{erreur}</p>}

      {!chargement && !erreur && notes.length === 0 && (
        <p className="notes-dossier__vide">{texteAucuneNote}</p>
      )}

      {!chargement && !erreur && notes.length > 0 && (
        <ul className="notes-dossier__liste">
          {notes.map((note) => (
            <li key={note.id} className="notes-dossier__item">
              <p className="notes-dossier__contenu">{note.contenu}</p>
              <span className="notes-dossier__meta">
                {/* "Nom (Rôle) _ date et heure" (ex. "Jeanne Dupont (Accueil / Coordination) _
                    05/08/2026 16:09", audit 2026-08-19, demande explicite) — auteur_role_libelle
                    vient de roles.libelle (notesDossierRepository.js), déjà en base pour le RBAC,
                    jamais deviné ici. */}
                {note.auteur_prenom} {note.auteur_nom} ({note.auteur_role_libelle}) _{' '}
                {FORMAT_DATE.format(new Date(note.date_creation))}
              </span>
            </li>
          ))}
        </ul>
      )}

      <form className="notes-dossier__formulaire" onSubmit={gererEnvoi}>
        <label>
          <span>Ajouter une note</span>
          <textarea
            value={contenu}
            onChange={(evenement) => setContenu(evenement.target.value)}
            rows={3}
            maxLength={LONGUEUR_MAX_CONTENU}
          />
        </label>

        {erreurEnvoi && <p role="alert">{erreurEnvoi}</p>}

        <button type="submit" disabled={envoiEnCours || !contenu.trim()}>
          {envoiEnCours ? 'Enregistrement...' : 'Ajouter une note'}
        </button>
      </form>
    </section>
  );
}
