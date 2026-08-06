import api from './api';

// Service dédié au tableau de bord KPI — encapsule l'appel réseau pour qu'Indicateurs.jsx n'ait
// pas à connaître la forme exacte de l'API back-end (même principe que dossierService.js).

export async function obtenirIndicateursKpi({ dateDebut, dateFin, typePoste, poste } = {}) {
  const { data } = await api.get('/statistiques/kpi', {
    params: {
      dateDebut,
      dateFin,
      ...(typePoste ? { typePoste } : {}),
      ...(poste ? { poste } : {}),
    },
  });
  return data;
}

// Tableau consolidé du dashboard KPI (cartes/segments cliquables, voir Indicateurs.jsx) — mêmes
// filtres période/poste que obtenirIndicateursKpi ci-dessus, plus `indicateurs` : un Set/tableau
// de codes, envoyé en une seule chaîne séparée par des virgules (voir statistiques.routes.js,
// dossiersQuerySchema — plus simple à construire ici qu'un paramètre de tableau dépendant de la
// configuration du parseur de query string). `indicateurs` vide renvoie directement un tableau
// vide sans appel réseau : aucune sélection ne peut logiquement donner un résultat.
export async function listerDossiersParIndicateurs({ dateDebut, dateFin, typePoste, poste, indicateurs } = {}) {
  if (!indicateurs || indicateurs.length === 0) return [];
  const { data } = await api.get('/statistiques/kpi/dossiers', {
    params: {
      dateDebut,
      dateFin,
      ...(typePoste ? { typePoste } : {}),
      ...(poste ? { poste } : {}),
      indicateurs: [...indicateurs].join(','),
    },
  });
  return data.dossiers;
}
