import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../auth/useSession';
import {
  listerNotifications,
  compterNotificationsNonLues,
  marquerNotificationLue,
  marquerToutesNotificationsLues,
} from '../../services/notificationService';
import { listerDemandesRh } from '../../services/dpaeService';
import './NotificationsCloche.css';

// Même intervalle que useRafraichissementAuto.js (core/dossier/) — pas ce hook lui-même,
// spécifique au polling "dernière modification des dossiers" (obtenirDerniereModification) : ce
// composant interroge une ressource différente (compteur de notifications), même principe
// (suspendu quand l'onglet n'est pas visible) réécrit ici en plus léger (pas de comparaison
// d'horodatage, juste le total).
const INTERVALLE_MS = 45_000;

const FORMAT_HEURE = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

// Une demande DPAE en attente devient une "notification" d'affichage — même forme que
// notifications.routes.js (id/message/lien/lue/date_creation), pour réutiliser le même rendu
// ci-dessous sans le dupliquer. `lue` toujours false : voir le commentaire de estRh plus bas.
function demandeVersNotification(demande) {
  return {
    id: demande.id,
    message: `Nouvelle demande DPAE : ${demande.salarie_prenom} ${demande.salarie_nom}.`,
    lien: `/rh/dpae/${demande.id}`,
    lue: false,
    date_creation: demande.date_creation,
  };
}

// Système de notifications internes (basique — module Demandes DPAE, 2026-09-28) : cloche avec
// badge de compteur, dans l'en-tête back-office (voir EnTeteBackOffice.jsx). Purement in-app,
// aucun envoi SMS/email. Monté une seule fois (comme "Mon profil"), autonome (son propre polling),
// même patron que BarreNavigation.jsx/BoutonNouvelleInscription.jsx.
//
// RH (simplification 2026-09-28, demande utilisateur explicite — revient sur un premier essai de
// notifications stockées par destinataire à l'envoi, plus un rattrapage pour tout RH promu après
// coup : trop compliqué, et un compte RH créé après une demande ne recevait quand même rien tant
// que le rattrapage n'était pas déclenché) : pour ce rôle, la cloche n'interroge PAS
// /api/notifications — elle affiche directement "toutes les demandes en cours" (GET /api/dpae,
// statut 'envoyee' par défaut, la même file que la page "Demandes DPAE"), toujours exact quel que
// soit le moment où le compte a obtenu ce rôle, sans aucune notification à stocker ni à
// synchroniser. Pas de "lue"/"tout marquer comme lu" dans ce mode : une demande disparaît d'elle-
// même de la liste dès qu'elle est traitée (validée/rejetée), ce qui sert déjà de signal de
// résolution.
export default function NotificationsCloche() {
  // chargementSession (pas le `chargement` local plus bas, propre au panneau déroulant) : tant
  // que la session n'est pas résolue, `estRh` vaudrait à tort `false` (utilisateur encore null) —
  // sans ce garde-fou, le tout premier rafraîchissement de CHAQUE montage (donc à chaque
  // changement de page, ce composant étant remonté avec la page) interrogeait le mauvais
  // endpoint (notifications personnelles au lieu de la file RH) le temps que cette session,
  // strictement locale à ce composant (voir commentaire d'en-tête), se résolve à son tour —
  // symptôme observé : la cloche affichait brièvement un badge/compteur erroné avant de se
  // corriger un instant plus tard. On attend donc que la session soit résolue avant le tout
  // premier appel réseau, plutôt que de tenter puis corriger.
  const { utilisateur, chargement: chargementSession } = useSession();
  const estRh = utilisateur?.roleCode === 'rh';

  const [total, setTotal] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [ouvert, setOuvert] = useState(false);
  const [chargement, setChargement] = useState(false);
  const conteneurRef = useRef(null);
  const navigate = useNavigate();

  const rafraichirCompteur = () => {
    (estRh ? listerDemandesRh().then((demandes) => demandes.length) : compterNotificationsNonLues())
      .then(setTotal)
      .catch(() => {});
  };

  useEffect(() => {
    if (chargementSession) return undefined;

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
  }, [estRh, chargementSession]);

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
      (estRh ? listerDemandesRh().then((demandes) => demandes.map(demandeVersNotification)) : listerNotifications())
        .then(setNotifications)
        .catch(() => setNotifications([]))
        .finally(() => setChargement(false));
    }
  };

  const surClicNotification = async (notification) => {
    if (!estRh && !notification.lue) {
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

  return (
    <div className="notifications-cloche" ref={conteneurRef}>
      <button
        type="button"
        className="notifications-cloche__bouton"
        onClick={ouvrir}
        aria-haspopup="true"
        aria-expanded={ouvert}
        aria-label={
          estRh
            ? `Demandes DPAE en attente, ${total}`
            : total > 0
              ? `Notifications, ${total} non lue(s)`
              : 'Notifications'
        }
      >
        🔔
        {total > 0 && <span className="notifications-cloche__badge">{total > 9 ? '9+' : total}</span>}
      </button>

      {ouvert && (
        <div className="notifications-cloche__panneau" role="menu">
          <div className="notifications-cloche__entete">
            <span>{estRh ? 'Demandes en attente' : 'Notifications'}</span>
            {!estRh && notifications.some((n) => !n.lue) && (
              <button type="button" onClick={toutMarquerLu}>
                Tout marquer comme lu
              </button>
            )}
          </div>

          {chargement && <p className="notifications-cloche__info">Chargement…</p>}
          {!chargement && notifications.length === 0 && (
            <p className="notifications-cloche__info">{estRh ? 'Aucune demande en attente.' : 'Aucune notification.'}</p>
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
