import { useEffect, useState } from 'react';
import { useSession } from '../auth/useSession';
import { listerRelances, enregistrerRelance, listerMotifsResultatRelance } from '../../services/relanceService';
import './HistoriqueRelances.css';

// Canaux universels (voir relanceService.js / backend relanceService.js, CANAUX_AUTORISES) : pas
// une donnée de configuration par entité comme les statuts ou les types de pièces (voir
// Modularité, CLAUDE.md), donc listés ici en dur plutôt que chargés depuis l'API.
const CANAUX = [
  { code: 'telephone', libelle: 'Téléphone' },
  { code: 'sms', libelle: 'SMS' },
  { code: 'email', libelle: 'Email' },
];

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

// Historique des relances d'un dossier (CLAUDE.md, besoin Accueil/Coordination : "historique des
// relances par candidat, pour ne pas relancer en double") : liste les relances déjà effectuées,
// met en avant la plus récente, puis permet d'en enregistrer une nouvelle.
//
// dossierId est reçu en prop (pas de useParams() ici) : ce composant ne connaît rien du routage,
// même patron que CaptureTablette.jsx — à l'appelant (pages/coordination/Relances.jsx) de le lire
// depuis un paramètre de route.
export default function HistoriqueRelances({ dossierId }) {
  const { utilisateur, chargement: chargementSession } = useSession();

  const [relances, setRelances] = useState([]);
  const [motifs, setMotifs] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);

  const [canal, setCanal] = useState(CANAUX[0].code);
  const [resultat, setResultat] = useState('');
  const [commentaire, setCommentaire] = useState('');
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [erreurEnvoi, setErreurEnvoi] = useState(null);

  const chargerRelances = () => {
    setChargement(true);
    setErreur(null);
    return listerRelances(dossierId)
      .then(setRelances)
      .catch((erreur) => setErreur(erreur.response?.data?.erreur ?? 'Impossible de récupérer l’historique des relances.'))
      .finally(() => setChargement(false));
  };

  useEffect(() => {
    let annule = false;
    chargerRelances();
    listerMotifsResultatRelance()
      .then((valeur) => {
        if (annule) return;
        setMotifs(valeur);
        if (valeur.length > 0) setResultat(valeur[0].code);
      })
      .catch(() => {
        // Non bloquant : sans résultats configurés, le formulaire d'ajout reste désactivé
        // (voir bouton plus bas) mais l'historique ci-dessus reste consultable.
      });
    return () => {
      annule = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dossierId]);

  const libelleCanal = (code) => CANAUX.find((c) => c.code === code)?.libelle ?? code;
  const libelleResultat = (code) => motifs.find((m) => m.code === code)?.libelle ?? code;

  const gererEnvoi = async (evenement) => {
    evenement.preventDefault();
    if (!resultat) return;
    setEnvoiEnCours(true);
    setErreurEnvoi(null);
    try {
      await enregistrerRelance(dossierId, { canal, resultat, commentaire: commentaire.trim() || undefined });
      await chargerRelances();
    } catch (erreur) {
      setErreurEnvoi(
        erreur.response
          ? (erreur.response.data?.erreur ?? "Le serveur n'a pas pu enregistrer la relance. Merci de réessayer.")
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
    return <p role="alert">Vous devez être connecté pour consulter les relances.</p>;
  }

  const derniereRelance = relances[0] ?? null;

  return (
    <section className="historique-relances">
      <h2>Relances</h2>

      {chargement && <p>Chargement de l’historique…</p>}
      {erreur && <p role="alert">{erreur}</p>}

      {!chargement && !erreur && derniereRelance && (
        <p className="historique-relances__alerte" role="status">
          Déjà relancé le {FORMAT_DATE.format(new Date(derniereRelance.date_envoi))} par{' '}
          {derniereRelance.agent_prenom} {derniereRelance.agent_nom} ({libelleCanal(derniereRelance.canal)}) —
          résultat : {libelleResultat(derniereRelance.resultat)}. Vérifiez l’historique avant de relancer à nouveau.
        </p>
      )}

      {!chargement && !erreur && relances.length === 0 && (
        <p className="historique-relances__vide">Aucune relance enregistrée pour ce dossier.</p>
      )}

      {!chargement && !erreur && relances.length > 0 && (
        <ul className="historique-relances__liste">
          {relances.map((relance) => (
            <li key={relance.id} className="historique-relances__item">
              <div className="historique-relances__item-ligne">
                <span className="historique-relances__canal">{libelleCanal(relance.canal)}</span>
                <span className="historique-relances__resultat">{libelleResultat(relance.resultat)}</span>
                <span className="historique-relances__meta">
                  {FORMAT_DATE.format(new Date(relance.date_envoi))} — {relance.agent_prenom} {relance.agent_nom}
                </span>
              </div>
              {relance.commentaire && <p className="historique-relances__commentaire-texte">{relance.commentaire}</p>}
            </li>
          ))}
        </ul>
      )}

      <form className="historique-relances__formulaire" onSubmit={gererEnvoi}>
        <h3>Enregistrer une relance</h3>

        <label>
          <span>Canal</span>
          <select value={canal} onChange={(evenement) => setCanal(evenement.target.value)}>
            {CANAUX.map((c) => (
              <option key={c.code} value={c.code}>
                {c.libelle}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Résultat</span>
          <select value={resultat} onChange={(evenement) => setResultat(evenement.target.value)} required>
            {motifs.length === 0 && <option value="">Aucun résultat configuré</option>}
            {motifs.map((motif) => (
              <option key={motif.code} value={motif.code}>
                {motif.libelle}
              </option>
            ))}
          </select>
        </label>

        <label className="historique-relances__champ-commentaire">
          <span>Commentaire (optionnel)</span>
          <textarea
            value={commentaire}
            onChange={(evenement) => setCommentaire(evenement.target.value)}
            rows={3}
            maxLength={2000}
          />
        </label>

        {erreurEnvoi && <p role="alert">{erreurEnvoi}</p>}

        <button type="submit" disabled={envoiEnCours || motifs.length === 0}>
          {envoiEnCours ? 'Enregistrement...' : 'Enregistrer la relance'}
        </button>
      </form>
    </section>
  );
}
