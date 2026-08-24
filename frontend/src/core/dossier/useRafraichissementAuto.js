import { useEffect, useRef } from 'react';
import { obtenirDerniereModification } from '../../services/dossierService';

// Milieu de la fourchette 30-60s demandée (audit 2026-08-24, rafraîchissement automatique du
// back-office par polling léger — préféré à WebSocket/SSE : zéro nouvelle dépendance, cohérent
// avec node-cron déjà en place, voir l'audit pour le détail des options écartées).
const INTERVALLE_MS = 45_000;

// Rafraîchissement automatique de tout le back-office, déclenché par événement (audit
// 2026-08-24). Interroge GET /api/dossiers/derniere-modification (dossierService.js) — un seul
// horodatage, jamais les données elles-mêmes — et ne rappelle `onNouvelleModification` que si cet
// horodatage a changé depuis le dernier connu côté client. Chaque page garde sa fonction de fetch
// existante strictement inchangée : ce hook se contente de la redéclencher au bon moment, jamais
// de refonte de la couche de données (voir l'audit, point 5).
//
// Suspendu quand l'onglet n'est pas visible (Page Visibility API) : pas de polling en arrière-plan
// pour un onglet back-office resté ouvert mais inactif — revérifie immédiatement au retour de
// visibilité plutôt que d'attendre jusqu'à INTERVALLE_MS après un retour d'inactivité prolongée.
//
// `onNouvelleModification` passé via un ref (pas dans le tableau de dépendances de l'effet) : la
// plupart des appelants passent une fonction inline à chaque rendu (ex. `() => setDossiers(...)`),
// ce qui redémarrerait l'intervalle à chaque rendu si elle figurait dans les dépendances — même
// patron que useEffect(..., []) + ref déjà utilisé dans ce projet (voir BlocDisponibilites.jsx,
// typePostePrecedentRef) pour ignorer volontairement une dépendance changeante.
export function useRafraichissementAuto(onNouvelleModification) {
  const derniereConnueRef = useRef(null);
  const callbackRef = useRef(onNouvelleModification);
  callbackRef.current = onNouvelleModification;

  useEffect(() => {
    let annule = false;

    async function verifier() {
      if (document.visibilityState !== 'visible') return;
      try {
        const derniereModification = await obtenirDerniereModification();
        if (annule || !derniereModification) return;

        if (derniereConnueRef.current === null) {
          // Premier appel de ce montage : établit seulement la référence, sans redéclencher un
          // fetch que la page vient déjà de faire elle-même au montage — seul un VRAI changement
          // survenu APRÈS ce point de départ doit provoquer un re-fetch.
          derniereConnueRef.current = derniereModification;
          return;
        }

        if (derniereModification !== derniereConnueRef.current) {
          derniereConnueRef.current = derniereModification;
          callbackRef.current();
        }
      } catch {
        // Un échec ponctuel du polling (réseau, session expirée...) ne doit jamais casser la page
        // qui l'utilise — le prochain tick réessaiera de lui-même.
      }
    }

    verifier(); // établit la référence dès le montage, plutôt que d'attendre le premier tick
    const intervalle = setInterval(verifier, INTERVALLE_MS);

    function surVisibilite() {
      if (document.visibilityState === 'visible') verifier();
    }
    document.addEventListener('visibilitychange', surVisibilite);

    return () => {
      annule = true;
      clearInterval(intervalle);
      document.removeEventListener('visibilitychange', surVisibilite);
    };
  }, []);
}
