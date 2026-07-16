import axios from 'axios';

// Client HTTP générique, partagé par tous les services front — base URL configurable par
// variable d'environnement Vite (utile pour pointer vers le bon sous-domaine d'entité).
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

export default api;
