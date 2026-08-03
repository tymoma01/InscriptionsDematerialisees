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
