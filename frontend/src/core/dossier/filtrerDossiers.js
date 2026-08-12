import { normaliserTexte } from '../filtres/normaliserTexte';

// Retire espaces et tirets pour comparer deux numéros de téléphone quel que soit leur formatage
// de saisie (ex. "06 12 34 56 78" doit matcher "0612345678") — appliqué à la fois au champ de
// recherche et au téléphone du dossier, jamais stocké ainsi (l'affichage garde le formatage
// d'origine, voir DossierList.jsx). Pas de normaliserTexte ici : ce sont des chiffres, seuls les
// espaces/tirets de formatage sont à traiter, pas d'accents.
function normaliserTelephone(valeur) {
  return valeur.replace(/[\s-]/g, '');
}

// Filtrage client (recherche nom/prénom/téléphone/email/poste + plage de date de dernière mise à
// jour) sur une liste de dossiers déjà chargée en mémoire — voir FiltresRechercheDossiers.jsx
// pour le pourquoi (pas de pagination serveur, filtrage instantané). Fonction pure, partagée par
// TableauDeBordAccueil.jsx et Backoffice.jsx (recruteur), pour ne pas dupliquer deux fois la même
// logique de comparaison de dates.
//
// `libellePoste` optionnel, même patron que DossierList.jsx (voir sa colonne "Poste") : les codes
// bruts (dossier.postesBureau/postesHotel) sont un vocabulaire propre à ACCECIT, ce module
// générique ne les traduit pas lui-même — sans traducteur fourni, la recherche matche sur le code
// brut plutôt que d'échouer.
//
// `entitesFiltre` optionnel (Set de 'hotel'/'bureau', voir Backoffice.jsx) : même détermination de
// l'entité d'un dossier que le filtre "Entité" (typePoste) du tableau de bord Indicateurs — via
// les postes déclarés sur le dossier (dossier.postesHotel/postesBureau), pas un champ entité_id
// distinct (un dossier n'a qu'une seule entité_id, celle de l'agence ACCECIT/Adaptel qui l'a créé
// — voir CLAUDE.md, section Modularité — sans rapport avec Hôtellerie/Tertiaire, qui distingue
// deux FAMILLES DE POSTES au sein d'une même entité). Set vide/absent : aucune restriction, tous
// les dossiers passent — même sémantique que recherche/dateDebutFiltre/dateFinFiltre vides
// ci-dessus.
export function filtrerDossiers(dossiers, { recherche, dateDebutFiltre, dateFinFiltre, libellePoste, entitesFiltre }) {
  const rechercheNormalisee = recherche.trim().toLowerCase();
  const rechercheNormaliseeTexte = normaliserTexte(rechercheNormalisee);
  const rechercheTelephone = normaliserTelephone(rechercheNormalisee);
  // Bornes en heure locale (pas de découpage de chaîne ISO en UTC) : dateDebutFiltre/dateFinFiltre
  // viennent d'un <input type="date"> et représentent des jours calendaires tels que l'agent les
  // lit sur la tablette, pas des instants UTC.
  const debut = dateDebutFiltre ? new Date(`${dateDebutFiltre}T00:00:00`) : null;
  const fin = dateFinFiltre ? new Date(`${dateFinFiltre}T23:59:59.999`) : null;

  return dossiers.filter((dossier) => {
    if (rechercheNormalisee) {
      const nomComplet = normaliserTexte(`${dossier.candidat_prenom} ${dossier.candidat_nom}`.toLowerCase());
      const email = (dossier.candidat_email ?? '').toLowerCase();
      const telephone = normaliserTelephone(dossier.candidat_telephone ?? '');
      const postes = normaliserTexte(
        [...(dossier.postesBureau ?? []), ...(dossier.postesHotel ?? [])]
          .map((code) => (libellePoste ? libellePoste(code) : code))
          .join(' ')
          .toLowerCase(),
      );
      const correspond =
        nomComplet.includes(rechercheNormaliseeTexte) ||
        email.includes(rechercheNormalisee) ||
        postes.includes(rechercheNormaliseeTexte) ||
        // rechercheTelephone vide (recherche sans chiffre, ex. juste des espaces/tirets) ne doit
        // jamais matcher un dossier sans téléphone saisi — .includes('') serait toujours vrai.
        (rechercheTelephone && telephone.includes(rechercheTelephone));
      if (!correspond) return false;
    }
    if (debut || fin) {
      const dateMaj = new Date(dossier.date_maj);
      if (debut && dateMaj < debut) return false;
      if (fin && dateMaj > fin) return false;
    }
    if (entitesFiltre && entitesFiltre.size > 0) {
      const aPosteHotel = (dossier.postesHotel ?? []).length > 0;
      const aPosteBureau = (dossier.postesBureau ?? []).length > 0;
      const correspondEntite = (entitesFiltre.has('hotel') && aPosteHotel) || (entitesFiltre.has('bureau') && aPosteBureau);
      if (!correspondEntite) return false;
    }
    return true;
  });
}
