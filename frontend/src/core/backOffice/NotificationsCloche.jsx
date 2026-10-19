import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../auth/useSession';
import { peut } from '../auth/permissions';
import {
  listerNotifications,
  compterNotificationsNonLues,
  marquerNotificationLue,
  marquerToutesNotificationsLues,
} from '../../services/notificationService';
import './NotificationsCloche.css';

// Même intervalle que useRafraichissementAuto.js (core/dossier/) — pas ce hook lui-même,
// spécifique au polling "dernière modification des dossiers" (obtenirDerniereModification) : ce
// composant interroge une ressource différente (compteur de notifications), même principe
// (suspendu quand l'onglet n'est pas visible) réécrit ici en plus léger (pas de comparaison
// d'horodatage, juste le total).
const INTERVALLE_MS = 45_000;

const FORMAT_HEURE = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

// Système de notifications internes (basique — module Demandes DPAE, 2026-09-28) : cloche avec
// badge de compteur, dans l'en-tête back-office (voir EnTeteBackOffice.jsx). Purement in-app,
// aucun envoi SMS/email. Monté une seule fois (comme "Mon profil"), autonome (son propre polling),
// même patron que BarreNavigation.jsx/BoutonNouvelleInscription.jsx.
//
// Réservée aux rôles qui reçoivent des notifications DPAE : Admin, RH, Planning et Inspecteur
// Hôtellerie (permission `cloche`, voir `visible` plus bas) ; retirée pour les autres rôles.
// EnTeteBackOffice.jsx continue de monter ce composant sans condition sur TOUTES les pages
// back-office (patron d'auto-gating inchangé, voir son propre commentaire) : le filtrage par rôle
// reste entièrement local à CE composant, pas remonté à l'appelant.
//
// Chaque action sur une demande DPAE crée une notification pour les parties concernées (voir
// backend/src/core/dpae/notificationsDpae.js) : la cloche affiche ces notifications pour tous les rôles,
// RH comprise.
export default function NotificationsCloche() {
  // chargementSession (pas le `chargement` local plus bas, propre au panneau déroulant) : tant que la
  // session n'est pas résolue, `visible` vaut faussement `false` — aucun appel réseau avant.
  const { utilisateur, chargement: chargementSession } = useSession();
  const visible = peut(utilisateur, 'cloche');

  const [total, setTotal] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [ouvert, setOuvert] = useState(false);
  const [chargement, setChargement] = useState(false);
  const conteneurRef = useRef(null);
  const navigate = useNavigate();

  const rafraichirCompteur = () => {
    compterNotificationsNonLues()
      .then(setTotal)
      .catch(() => {});
  };

  useEffect(() => {
    // `visible` couvre déjà `!chargementSession` (utilisateur reste null tant que la session
    // n'est pas résolue, voir son calcul plus haut) — un rôle non autorisé ou une session encore en
    // cours de résolution ne déclenche donc aucun appel réseau ni polling inutile.
    if (chargementSession || !visible) return undefined;

    rafraichirCompteur();

    function verifier() {
      if (document.visibilityState !== 'visible') return;
      rafraichirCompteur();
    }
    const intervalle = setInterval(verifier, INTERVALLE_MS);
    document.addEventListener('visibilitychange', verifier);
    return () => {
      clearInterval(intervalle);
      document.removeEventListener('visibilitychange', verifier);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, chargementSession]);

  useEffect(() => {
    function surClicExterieur(evenement) {
      if (conteneurRef.current && !conteneurRef.current.contains(evenement.target)) {
        setOuvert(false);
      }
    }
    document.addEventListener('mousedown', surClicExterieur);
    return () => document.removeEventListener('mousedown', surClicExterieur);
  }, []);

  const ouvrir = () => {
    setOuvert((valeurPrecedente) => !valeurPrecedente);
    if (!ouvert) {
      setChargement(true);
      listerNotifications()
        .then(setNotifications)
        .catch(() => setNotifications([]))
        .finally(() => setChargement(false));
    }
  };

  const surClicNotification = async (notification) => {
    if (!notification.lue) {
      try {
        await marquerNotificationLue(notification.id);
        setTotal((valeurPrecedente) => Math.max(0, valeurPrecedente - 1));
        setNotifications((valeurPrecedente) =>
          valeurPrecedente.map((n) => (n.id === notification.id ? { ...n, lue: true } : n)),
        );
      } catch {
        // Non bloquant : la navigation vers le lien reste utile même si le marquage échoue.
      }
    }
    setOuvert(false);
    if (notification.lien) navigate(notification.lien);
  };

  const toutMarquerLu = async () => {
    try {
      await marquerToutesNotificationsLues();
      setTotal(0);
      setNotifications((valeurPrecedente) => valeurPrecedente.map((n) => ({ ...n, lue: true })));
    } catch {
      // Silencieux : un prochain clic réessaiera, même principe que useRafraichissementAuto.js.
    }
  };

  // Rien à monter pour un rôle non autorisé (Accueil/Coordination, Formateur, Inspecteur) — ni pour la brève fenêtre où la session n'est pas encore résolue (`visible` vaut
  // alors faussement `false`, utilisateur étant encore null : mieux vaut ne rien afficher un
  // instant que de laisser la cloche apparaître puis disparaître). Après les hooks ci-dessus
  // (jamais avant, voir la règle des Hooks) — même patron que EnTeteBackOffice.jsx.
  if (chargementSession || !visible) return null;

  return (
    <div className="notifications-cloche" ref={conteneurRef}>
      <button
        type="button"
        className="notifications-cloche__bouton"
        onClick={ouvrir}
        aria-haspopup="true"
        aria-expanded={ouvert}
        aria-label={total > 0 ? `Notifications, ${total} non lue(s)` : 'Notifications'}
      >
        🔔
        {total > 0 && <span className="notifications-cloche__badge">{total > 9 ? '9+' : total}</span>}
      </button>

      {ouvert && (
        <div className="notifications-cloche__panneau" role="menu">
          <div className="notifications-cloche__entete">
            <span>Notifications</span>
            {notifications.some((n) => !n.lue) && (
              <button type="button" onClick={toutMarquerLu}>
                Tout marquer comme lu
              </button>
            )}
          </div>

          {chargement && <p className="notifications-cloche__info">Chargement…</p>}
          {!chargement && notifications.length === 0 && (
            <p className="notifications-cloche__info">Aucune notification.</p>
          )}

          <ul className="notifications-cloche__liste">
            {notifications.map((notification) => (
              <li key={notification.id}>
                <button
                  type="button"
                  className={`notifications-cloche__item${notification.lue ? '' : ' notifications-cloche__item--non-lue'}`}
                  onClick={() => surClicNotification(notification)}
                >
                  <span className="notifications-cloche__message">{notification.message}</span>
                  <span className="notifications-cloche__date">{FORMAT_HEURE.format(new Date(notification.date_creation))}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
