import { normaliserTexte } from '../filtres/normaliserTexte';

// Retire espaces et tirets pour comparer deux numéros de téléphone quel que soit leur formatage
// de saisie (ex. "06 12 34 56 78" doit matcher "0612345678") — appliqué à la fois au champ de
// recherche et au téléphone du dossier, jamais stocké ainsi (l'affichage garde le formatage
// d'origine, voir DossierList.jsx). Pas de normaliserTexte ici : ce sont des chiffres, seuls les
// espaces/tirets de formatage sont à traiter, pas d'accents.
function normaliserTelephone(valeur) {
  return valeur.replace(/[\s-]/g, '');
}

// Filtrage client (recherche nom/prénom/téléphone/email/poste/statut/n° de dossier + plage de
// date de dernière mise à jour) sur une liste de dossiers déjà chargée en mémoire — voir
// FiltresRechercheDossiers.jsx pour le pourquoi (pas de pagination serveur, filtrage instantané).
// Fonction pure, utilisée par TableauDeBordAccueil.jsx (Backoffice.jsx/recruteur, qui la
// consommait aussi jusqu'ici, a été fusionné dans cette page — voir App.jsx), pour ne pas
// dupliquer deux fois la même logique de comparaison de dates.
//
// `libellePoste` optionnel, même patron que DossierList.jsx (voir sa colonne "Poste") : les codes
// bruts (dossier.postesBureau/postesHotel) sont un vocabulaire propre à ACCECIT, ce module
// générique ne les traduit pas lui-même — sans traducteur fourni, la recherche matche sur le code
// brut plutôt que d'échouer.
//
// `entitesFiltre` optionnel (Set de 'hotel'/'bureau') : même détermination de l'entité d'un
// dossier que le filtre "Entité" (typePoste) du tableau de bord Indicateurs — via les postes
// déclarés sur le dossier (dossier.postesHotel/postesBureau), pas un champ entité_id distinct (un
// dossier n'a qu'une seule entité_id, celle de l'agence ACCECIT/Adaptel qui l'a créé — voir
// CLAUDE.md, section Modularité — sans rapport avec Hôtellerie/Tertiaire, qui distingue deux
// FAMILLES DE POSTES au sein d'une même entité).
//
// Un dossier sans AUCUN poste déclaré (ni Hôtellerie ni Tertiaire) est toujours exclu, que le Set
// soit vide ou non (audit 2026-08-18 : 6 dossiers "nouveau", inscription abandonnée avant le bloc
// "Situation professionnelle", gonflaient le compteur "Tous" de FiltresStatut sans jamais
// apparaître dans Hôtellerie/Tertiaire — Set vide y était jusqu'ici interprété comme "aucune
// restriction", donc ces dossiers "passaient" alors qu'ils ne correspondent à aucune des deux
// familles). Le Set ne sert plus qu'à restreindre à UNE famille précise quand il n'est pas vide.
// Un dossier avec les deux familles renseignées (candidat intéressé par Hôtellerie ET Tertiaire)
// n'est PAS exclu au double titre : il compte alors dans les deux boutons Hôtellerie/Tertiaire
// (TableauDeBordAccueil.jsx, compteurHotel/compteurBureau) — reflète son intérêt réel plutôt que
// de le masquer d'un des deux filtres via une entité "principale" arbitraire. "Tous" reste exact
// dans ce cas car calculé ici comme une liste de dossiers DISTINCTS (union), jamais comme la somme
// Hôtellerie + Tertiaire : Tous < Hôtellerie + Tertiaire est donc un résultat attendu si un tel
// dossier existe un jour, pas un bug (voir commentaire de compteurHotel/compteurBureau).
export function filtrerDossiers(dossiers, { recherche, dateDebutFiltre, dateFinFiltre, libellePoste, entitesFiltre }) {
  const rechercheNormalisee = recherche.trim().toLowerCase();
  const rechercheNormaliseeTexte = normaliserTexte(rechercheNormalisee);
  const rechercheTelephone = normaliserTelephone(rechercheNormalisee);
  // Mots de la recherche nom/prénom, normalisés individuellement (accents retirés) mais PAS
  // reconcaténés en un seul bloc comme rechercheNormaliseeTexte ci-dessus — matcher chaque mot
  // indépendamment contre nomComplet (voir plus bas) rend la recherche insensible à l'ordre de
  // saisie : "ETEST TEST" retrouve désormais le candidat "TEST ETEST", pas seulement "TEST ETEST"
  // saisi dans le même ordre que prénom+nom. Reste propre au nom/prénom : postes ci-dessous garde
  // rechercheNormaliseeTexte (bloc unique), aucun bug équivalent signalé sur ce champ.
  const motsRechercheNom = rechercheNormalisee.split(/\s+/).filter(Boolean).map(normaliserTexte);
  // Saisie strictement numérique (audit 2026-08-19 : "91" remontait à la fois le dossier #91 ET
  // le téléphone "0780891746", qui contient "91") — désambiguïsée par la LONGUEUR plutôt que de
  // laisser les deux champs concourir par simple inclusion :
  // - moins de 10 chiffres : trop court pour un téléphone français, ne peut viser que le n° de
  //   dossier (rechercheEstNumeroDossier) — correspondance EXACTE plutôt que "contient" (l'objectif
  //   est un résultat unique, "9" ne doit plus remonter 9 ET 19 ET 91...).
  // - 10 chiffres ou plus : comportement téléphone inchangé (rechercheTelephone ci-dessus).
  // rechercheTelephone (pas rechercheNormalisee) sert de base : une saisie "06 12 34 56 78"
  // (espaces) doit être traitée comme 10 chiffres, pas rejetée par le test /^\d+$/ à cause de ces
  // espaces.
  const rechercheEstNumerique = rechercheTelephone.length > 0 && /^\d+$/.test(rechercheTelephone);
  const rechercheEstNumeroDossier = rechercheEstNumerique && rechercheTelephone.length < 10;
  // Bornes en heure locale (pas de découpage de chaîne ISO en UTC) : dateDebutFiltre/dateFinFiltre
  // viennent d'un <input type="date"> et représentent des jours calendaires tels que l'agent les
  // lit sur la tablette, pas des instants UTC.
  const debut = dateDebutFiltre ? new Date(`${dateDebutFiltre}T00:00:00`) : null;
  const fin = dateFinFiltre ? new Date(`${dateFinFiltre}T23:59:59.999`) : null;

  return dossiers.filter((dossier) => {
    if (rechercheEstNumeroDossier) {
      // Cas 1 (saisie numérique courte) : uniquement le n° de dossier, égalité stricte — un champ
      // à la fois, jamais combiné au nom/email/poste/téléphone ci-dessous.
      if (String(dossier.id) !== rechercheTelephone) return false;
    } else if (rechercheEstNumerique) {
      // Cas 2 (saisie numérique longue) : uniquement le téléphone, comportement "contient" déjà en
      // place — un numéro complet à 14 chiffres avec indicatif retrouve toujours un dossier dont
      // seuls les 10 derniers chiffres sont enregistrés.
      const telephone = normaliserTelephone(dossier.candidat_telephone ?? '');
      if (!telephone.includes(rechercheTelephone)) return false;
    } else if (rechercheNormalisee) {
      // Cas 3 (saisie non numérique) : nom/prénom, email, poste, statut (colonne STATUT, ajoutée
      // audit 2026-08-20 — toutes les colonnes visibles du tableau doivent être cherchables,
      // jamais seulement un sous-ensemble). Comparé sur le LIBELLÉ affiché (dossier.statut_libelle,
      // même champ que StatutBadge dans DossierList.jsx), pas le code brut : un agent tape ce
      // qu'il voit à l'écran ("invalidé"), pas un code interne qu'il ne connaît pas forcément
      // ("test_non_realise"). Simple inclusion sur un bloc normalisé, même patron que `postes`
      // ci-dessous (pas de correspondance mot à mot comme le nom : "attente" doit retrouver "En
      // attente de pièces" même si le reste du libellé ne matche aucun mot isolé).
      const nomComplet = normaliserTexte(`${dossier.candidat_prenom} ${dossier.candidat_nom}`.toLowerCase());
      const email = (dossier.candidat_email ?? '').toLowerCase();
      const postes = normaliserTexte(
        [...(dossier.postesBureau ?? []), ...(dossier.postesHotel ?? [])]
          .map((code) => (libellePoste ? libellePoste(code) : code))
          .join(' ')
          .toLowerCase(),
      );
      const statut = normaliserTexte((dossier.statut_libelle ?? '').toLowerCase());
      const correspond =
        motsRechercheNom.every((mot) => nomComplet.includes(mot)) ||
        email.includes(rechercheNormalisee) ||
        postes.includes(rechercheNormaliseeTexte) ||
        statut.includes(rechercheNormaliseeTexte);
      if (!correspond) return false;
    }
    if (debut || fin) {
      const dateMaj = new Date(dossier.date_maj);
      if (debut && dateMaj < debut) return false;
      if (fin && dateMaj > fin) return false;
    }
    const aPosteHotel = (dossier.postesHotel ?? []).length > 0;
    const aPosteBureau = (dossier.postesBureau ?? []).length > 0;
    if (!aPosteHotel && !aPosteBureau) return false;
    if (entitesFiltre && entitesFiltre.size > 0) {
      const correspondEntite = (entitesFiltre.has('hotel') && aPosteHotel) || (entitesFiltre.has('bureau') && aPosteBureau);
      if (!correspondEntite) return false;
    }
    return true;
  });
}
