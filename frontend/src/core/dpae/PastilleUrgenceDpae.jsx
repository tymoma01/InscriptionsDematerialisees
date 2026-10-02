import StatutBadge from '../workflow/StatutBadge';
import { calculerUrgence } from './urgenceDpae';

// Pastille d'urgence d'une demande DPAE (2026-10-02) : « J-5 », « Jour J », « En retard », couleur
// selon le délai restant, délai exact en info-bulle. Rien pour une demande validée/rejetée ou sans
// premier jour. Calcul : urgenceDpae.js (source unique, partagée par les trois écrans).
export default function PastilleUrgenceDpae({ demande }) {
  const urgence = calculerUrgence(demande);
  if (!urgence) return null;
  return <StatutBadge libelle={urgence.libelle} variante={urgence.variante} title={urgence.infoBulle} />;
}
