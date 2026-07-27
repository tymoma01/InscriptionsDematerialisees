// Filtrage client (recherche nom/prénom + plage de date de dernière mise à jour) sur une liste de
// dossiers déjà chargée en mémoire — voir FiltresRechercheDossiers.jsx pour le pourquoi (pas de
// pagination serveur, filtrage instantané). Fonction pure, partagée par TableauDeBordAccueil.jsx
// et Backoffice.jsx (recruteur), pour ne pas dupliquer deux fois la même logique de comparaison
// de dates.
export function filtrerDossiers(dossiers, { recherche, dateDebutFiltre, dateFinFiltre }) {
  const rechercheNormalisee = recherche.trim().toLowerCase();
  // Bornes en heure locale (pas de découpage de chaîne ISO en UTC) : dateDebutFiltre/dateFinFiltre
  // viennent d'un <input type="date"> et représentent des jours calendaires tels que l'agent les
  // lit sur la tablette, pas des instants UTC.
  const debut = dateDebutFiltre ? new Date(`${dateDebutFiltre}T00:00:00`) : null;
  const fin = dateFinFiltre ? new Date(`${dateFinFiltre}T23:59:59.999`) : null;

  return dossiers.filter((dossier) => {
    if (rechercheNormalisee) {
      const nomComplet = `${dossier.candidat_prenom} ${dossier.candidat_nom}`.toLowerCase();
      if (!nomComplet.includes(rechercheNormalisee)) return false;
    }
    if (debut || fin) {
      const dateMaj = new Date(dossier.date_maj);
      if (debut && dateMaj < debut) return false;
      if (fin && dateMaj > fin) return false;
    }
    return true;
  });
}
