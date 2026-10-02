import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../../core/auth/useSession';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import StatutBadge from '../../core/workflow/StatutBadge';
import FiltresStatut from '../../core/dossier/FiltresStatut';
import FiltreEntite from '../../core/dossier/FiltreEntite';
import FiltresRechercheDossiers from '../../core/dossier/FiltresRechercheDossiers';
import { normaliserTexte } from '../../core/filtres/normaliserTexte';
import { useParametreURL, useEnsembleURL } from '../../core/filtres/useParametreURL';
import { listerSuiviFormation } from '../../services/dossierService';
import { appliquerTransition } from '../../services/transitionService';
import { useRafraichissementAuto } from '../../core/dossier/useRafraichissementAuto';
import ModaleResultatFormation from './ModaleResultatFormation';
import { libellePoste } from '../../core/referentiels/postes';
import './SuiviFormation.css';

// Suivi de formation (audit 2026-08-28, révise une décision antérieure — "Validé - envoyé en
// formation"/"Validé - prêt à l'embauche" étaient posés comme deux statuts terminaux
// indépendants, la suite se faisant dans SmartOF, hors périmètre app) : liste des dossiers ayant
// atteint "Validé - envoyé en formation", avec retour manuel du résultat de formation (saisi à la
// main par l'agent depuis un support externe, papier ou autre — pas d'intégration SmartOF ici).
//
// Une SEULE page partagée par 3 rôles (Accueil/Coordination, Formateur, Admin — voir
// BarreNavigation.jsx ; Inspecteur RETIRÉ, audit 2026-09-26, règle métier confirmée : aucun
// dossier Tertiaire — le secteur de l'Inspecteur — ne passe en formation, voir App.jsx pour la
// garde de route équivalente), pas dupliquée par rôle comme Evaluation.jsx : même patron que
// Planification.jsx ("Suivi des tests"), qui différencie déjà en interne Coordination
// (lecture/actions groupées) de Formateur (lecture seule sur certains blocs) via un simple test
// sur roleCode, plutôt que deux pages quasi identiques. Ici : Accueil/Coordination voit la liste en
// LECTURE SEULE (aucun bouton), Formateur/Admin ont les 2 boutons d'action. La vraie barrière reste
// côté serveur (transition_roles, voir workflowEngine.js) — masquer les boutons ici n'est qu'un
// confort d'affichage, pas la sécurité elle-même.
//
// Statuts affichables (point 1, audit 2026-08-28) — même mapping variante que les 6 autres pages
// qui portent VARIANTE_PAR_CODE_ACCECIT (TableauDeBordAccueil.jsx et al.), dupliqué plutôt que
// partagé (voir CLAUDE.md conventions du projet). "En attente" reste le libellé affiché pour
// valide_envoi_formation SUR CETTE PAGE (comportement par défaut avant ce changement), distinct de
// son libellé officiel "Validé - envoyé en formation" utilisé ailleurs dans l'app.
const STATUTS_FILTRABLES = [
  { code: 'valide_envoi_formation', libelle: 'En attente' },
  { code: 'valide_pret_embauche', libelle: 'Formation validée' },
  { code: 'formation_non_validee', libelle: 'Formation non validée' },
];
const VARIANTE_PAR_CODE_ACCECIT = {
  valide_envoi_formation: 'succes',
  valide_pret_embauche: 'vert-clair',
  formation_non_validee: 'echec-fort',
};
// Libellé de badge : le libellé officiel est repris pour CHAQUE statut, SAUF celui-ci (correctif
// 2026-09-28, demande utilisateur — revient sur l'audit 2026-08-28 qui imposait explicitement le
// libellé officiel complet sur le badge, "jamais En attente") : "Validé - envoyé en formation" est
// le plus long des trois libellés officiels de cette page, seul à forcer le retour à la ligne dans
// .page-suivi-formation__item (flex-wrap: wrap) et donc seul à donner une hauteur de ligne
// différente des deux autres statuts. Réutilise le même texte court que STATUTS_FILTRABLES
// ci-dessus plutôt que d'en inventer un troisième.
const LIBELLE_BADGE_PAR_CODE = {
  valide_envoi_formation: 'En attente',
};
function libelleBadgeStatut(dossier) {
  return LIBELLE_BADGE_PAR_CODE[dossier.statut_code] ?? dossier.statut_libelle;
}
function varianteStatut(code) {
  return VARIANTE_PAR_CODE_ACCECIT[code] ?? 'neutre';
}

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

// Commentaire désormais SAISI PAR L'AGENT, obligatoire (audit 2026-08-28, révise le choix initial
// "sans commentaire obligatoire") — voir ModaleResultatFormation.jsx, ouverte au clic sur l'un des
// deux boutons ci-dessous plutôt que d'appliquer la transition directement. Le texte tapé
// REMPLACE le commentaire auto-généré, ne s'y ajoute pas — workflowEngine.appliquerTransition
// n'exige qu'un commentaire non vide, sans distinguer sa provenance (déjà le cas pour
// GestionTransitions.jsx, qui envoie un commentaire tapé pour d'autres transitions), donc ce
// changement ne touche à rien côté backend.
// codeAction dédié (corrigé le 2026-09-01, audit tableau de bord 2026-08-31 point #5) — distinct de
// 'valider_pret_embauche', réservé au verdict initial du test (evaluationEngine.js), pour ne plus
// fausser "Délai moyen test → verdict" avec des dossiers passés par la formation (voir
// transitions.routes.js, embaucheService.js pour le même patron déjà appliqué à "Embauché").
const CODE_ACTION_FORMATION_VALIDEE = 'marquer_formation_validee';
const CODE_ACTION_FORMATION_NON_VALIDEE = 'invalider_formation';

// Libellés/options du filtre + colonne "Expérience" — mêmes codes que
// BlocDisponibilites.jsx (formulaire d'inscription)/Planification.jsx (Suivi des tests), dupliqués
// plutôt que partagés (voir CLAUDE.md conventions du projet). Cette page n'affichait jusqu'ici
// aucune colonne "Poste" (contrairement à Dossiers candidats/Suivi des tests) : "Expérience" est
// donc la première information candidat de ce type ajoutée ici, sans colonne "Poste" existante à
// ses côtés.
const LIBELLES_EXPERIENCE_PAR_CODE_ACCECIT = {
  aucune: "Pas d'expérience",
  plus_6_mois: 'Plus de 6 mois',
  plus_2_ans: 'Plus de 2 ans',
  plus_5_ans: 'Plus de 5 ans',
};
const CODES_EXPERIENCE_ACCECIT = ['aucune', 'plus_6_mois', 'plus_2_ans', 'plus_5_ans'];
function libelleExperience(code) {
  if (!code) return '-';
  return LIBELLES_EXPERIENCE_PAR_CODE_ACCECIT[code] ?? code;
}

// Recherche élargie (nom/prénom, n° de dossier, poste(s) déclaré(s), nom du formateur, libellé du
// statut) — même patron que Planification.jsx (rechercheCorrespond), dupliqué plutôt que partagé
// (voir CLAUDE.md conventions du projet, et son commentaire d'en-tête : la forme d'un dossier
// diffère de celle d'un rendez-vous). rechercheEstNumeroDossier/rechercheEstNumerique : une saisie
// numérique courte ("108") vise UNIQUEMENT le n° de dossier en égalité stricte, jamais une simple
// inclusion — même correctif que filtrerDossiers.js/Planification.jsx.
function rechercheCorrespond(
  dossier,
  { motsRechercheNom, rechercheNormaliseeTexte, rechercheChiffresSeuls, rechercheEstNumerique, rechercheEstNumeroDossier },
) {
  if (rechercheEstNumeroDossier) {
    return String(dossier.id) === rechercheChiffresSeuls;
  }
  if (rechercheEstNumerique) {
    return false;
  }
  const nomComplet = normaliserTexte(`${dossier.candidat_prenom} ${dossier.candidat_nom}`.toLowerCase());
  const correspondNom = motsRechercheNom.every((mot) => nomComplet.includes(mot));
  const postes = normaliserTexte(
    [...(dossier.postesBureau ?? []), ...(dossier.postesHotel ?? [])]
      .map(libellePoste)
      .join(' ')
      .toLowerCase(),
  );
  const correspondPoste = postes.includes(rechercheNormaliseeTexte);
  const nomFormateur = normaliserTexte(`${dossier.formateur_prenom ?? ''} ${dossier.formateur_nom ?? ''}`.toLowerCase());
  const correspondFormateur = motsRechercheNom.every((mot) => nomFormateur.includes(mot));
  const statut = normaliserTexte((dossier.statut_libelle ?? '').toLowerCase());
  const correspondStatut = statut.includes(rechercheNormaliseeTexte);
  return correspondNom || correspondPoste || correspondFormateur || correspondStatut;
}

export default function SuiviFormation() {
  const navigate = useNavigate();
  const { utilisateur, chargement: chargementSession } = useSession();
  const [dossiers, setDossiers] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);
  const [enCoursId, setEnCoursId] = useState(null);
  const [erreurAction, setErreurAction] = useState(null);
  const [rafraichir, setRafraichir] = useState(0);
  // Action en attente de confirmation via ModaleResultatFormation — { dossier,
  // codeAction, titre } ou null tant qu'aucune modale n'est ouverte.
  const [actionAConfirmer, setActionAConfirmer] = useState(null);

  // Filtres persistés dans l'URL, même mécanisme que Planification.jsx/TableauDeBordAccueil.jsx
  // (useParametreURL.js, cohérence entre pages de filtres similaires). Défaut "En attente" (point
  // 1, comportement actuel avant ce changement) — pas null/"Tous" comme FiltresStatut.jsx le fait
  // par défaut ailleurs (Dossiers candidats) : demande explicite ici.
  //
  // Sentinelle 'tous' plutôt que null directement dans l'URL : useParametreURL traite `null` et
  // "valeur absente de l'URL" comme la MÊME chose (retombe sur valeurParDefaut) — avec un défaut
  // non-null ('valide_envoi_formation'), écrire `null` dans l'URL au clic sur "Tous"
  // (FiltresStatut.jsx) supprimerait le paramètre et reviendrait donc silencieusement à "En
  // attente" au lieu de "Tous". 'tous' reste une valeur explicite distincte du défaut, traduite en
  // `null` seulement à la frontière avec FiltresStatut (qui, lui, garde son API null-based
  // existante, inchangée pour ses autres appelants).
  const [statutFiltreBrut, setStatutFiltreBrut] = useParametreURL('statut', 'valide_envoi_formation');
  const statutFiltre = statutFiltreBrut === 'tous' ? null : statutFiltreBrut;
  const setStatutFiltre = (valeur) => setStatutFiltreBrut(valeur === null ? 'tous' : valeur);
  const [recherche, setRecherche] = useParametreURL('q', '');
  // Filtre "Code postal" (demande utilisateur d'harmonisation avec Dossiers candidats/Suivi des
  // tests, audit 2026-09-11) — même comportement "commence par" que TableauDeBordAccueil.jsx,
  // porté par FiltresRechercheDossiers.jsx (core/dossier/, même composant partagé). Filtrage
  // entièrement client (dossier.candidat_code_postal, extrait du bloc 'coordonnees' — ajouté à
  // listerSuiviFormation/dossierRepository.js pour ce filtre, absent jusqu'ici de cette liste).
  const [codePostalFiltre, setCodePostalFiltre] = useParametreURL('codePostal', '');
  const [dateDebutFiltre, setDateDebutFiltre] = useParametreURL('date_debut', '');
  const [dateFinFiltre, setDateFinFiltre] = useParametreURL('date_fin', '');
  // Filtre "Expérience" — même mécanisme <select> que Planification.jsx (Suivi
  // des tests), filtrage entièrement client. '' = toutes les tranches confondues.
  const [experienceFiltre, setExperienceFiltre] = useParametreURL('experience', '');
  // Filtre "Entité" (Hôtellerie/Tertiaire, demande utilisateur) — même composant/mécanisme que
  // TableauDeBordAccueil.jsx (Dossiers candidats)/Planification.jsx (Suivi des tests), voir
  // FiltreEntite.jsx : deux boutons indépendamment activables, Set vide = aucune restriction.
  // Filtrage entièrement client (dossier.postesHotel/postesBureau déjà présents sur chaque
  // dossier renvoyé par GET /api/dossiers/suivi-formation, voir listerSuiviFormation — déjà
  // utilisés par rechercheCorrespond ci-dessus, même si cette page n'affiche pas de colonne
  // "Poste").
  const [entitesFiltre, basculerEntiteFiltre] = useEnsembleURL('entites');

  // Inspecteur retiré (audit 2026-09-26, règle métier confirmée : aucun dossier Tertiaire ne
  // passe en formation) — voir le commentaire d'en-tête de ce fichier.
  const accesComplet = ['formateur', 'admin'].includes(utilisateur?.roleCode);

  useEffect(() => {
    let annule = false;
    setChargement(true);
    setErreur(null);
    listerSuiviFormation()
      .then((valeur) => {
        if (!annule) setDossiers(valeur);
      })
      .catch((erreur) => {
        if (!annule) setErreur(erreur.response?.data?.erreur ?? 'Impossible de récupérer les dossiers en formation.');
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, [rafraichir]);

  useRafraichissementAuto(() => setRafraichir((compteur) => compteur + 1));

  // Compteurs par statut (FiltresStatut.jsx, compteurTous/compteurs) — calculés sur la liste
  // COMPLÈTE reçue du serveur (avant filtre statut lui-même), mais APRÈS recherche/plage de date,
  // même principe que TableauDeBordAccueil.jsx (dossiersFiltresSansStatut) : un agent qui cherche
  // "Ibrahima" voit re-décompter les 3 boutons sur les seuls dossiers Ibrahima, pas sur la liste
  // entière.
  const dossiersRechercheDate = useMemo(() => {
    const rechercheNormalisee = recherche.trim().toLowerCase();
    const rechercheNormaliseeTexte = normaliserTexte(rechercheNormalisee);
    const motsRechercheNom = rechercheNormalisee.split(/\s+/).filter(Boolean).map(normaliserTexte);
    const rechercheChiffresSeuls = rechercheNormalisee.replace(/[\s-]/g, '');
    const rechercheEstNumerique = rechercheChiffresSeuls.length > 0 && /^\d+$/.test(rechercheChiffresSeuls);
    const rechercheEstNumeroDossier = rechercheEstNumerique && rechercheChiffresSeuls.length < 10;
    const debut = dateDebutFiltre ? new Date(`${dateDebutFiltre}T00:00:00`) : null;
    const fin = dateFinFiltre ? new Date(`${dateFinFiltre}T23:59:59.999`) : null;
    // "Commence par", null-safe — même comportement que filtrerDossiers.js/TableauDeBordAccueil.jsx
    // (Dossiers candidats), champ séparé de la recherche générale `recherche` ci-dessus.
    const codePostalFiltreNormalise = (codePostalFiltre ?? '').trim();
    return dossiers.filter((dossier) => {
      if (debut || fin) {
        if (!dossier.date_entree_statut) return false;
        const date = new Date(dossier.date_entree_statut);
        if (debut && date < debut) return false;
        if (fin && date > fin) return false;
      }
      if (
        codePostalFiltreNormalise &&
        !(dossier.candidat_code_postal ?? '').startsWith(codePostalFiltreNormalise)
      ) {
        return false;
      }
      if (motsRechercheNom.length === 0) return true;
      return rechercheCorrespond(dossier, {
        motsRechercheNom,
        rechercheNormaliseeTexte,
        rechercheChiffresSeuls,
        rechercheEstNumerique,
        rechercheEstNumeroDossier,
      });
    });
  }, [dossiers, recherche, codePostalFiltre, dateDebutFiltre, dateFinFiltre]);

  // Compteurs des boutons "Hôtellerie"/"Tertiaire" (demande utilisateur, même principe que
  // compteurHotel/compteurBureau sur TableauDeBordAccueil.jsx/Planification.jsx) : calculés sur
  // dossiersRechercheDate (recherche/plage de date déjà appliquées), AVANT le filtre entité
  // lui-même — chaque bouton doit répondre à "combien de dossiers si je clique CE bouton",
  // indépendamment de l'état actuel de entitesFiltre — mais statut/expérience réappliqués
  // manuellement ici pour que ces deux compteurs reflètent malgré tout les AUTRES filtres déjà
  // actifs, conformément à la liste actuellement affichée sur cet écran.
  const compteurHotel = useMemo(
    () =>
      dossiersRechercheDate.filter(
        (dossier) =>
          (!statutFiltre || dossier.statut_code === statutFiltre) &&
          (!experienceFiltre || dossier.experience === experienceFiltre) &&
          (dossier.postesHotel ?? []).length > 0,
      ).length,
    [dossiersRechercheDate, statutFiltre, experienceFiltre],
  );
  const compteurBureau = useMemo(
    () =>
      dossiersRechercheDate.filter(
        (dossier) =>
          (!statutFiltre || dossier.statut_code === statutFiltre) &&
          (!experienceFiltre || dossier.experience === experienceFiltre) &&
          (dossier.postesBureau ?? []).length > 0,
      ).length,
    [dossiersRechercheDate, statutFiltre, experienceFiltre],
  );

  // Filtre entité appliqué juste après recherche/plage de date (même position que
  // dossiersFiltresBase sur TableauDeBordAccueil.jsx) : tout ce qui suit (compteurs d'expérience/
  // statut, liste finale) reflète donc déjà l'entité sélectionnée, seuls les DEUX compteurs
  // ci-dessus l'ignorent délibérément (voir leur commentaire). Set vide = aucune restriction.
  const dossiersRechercheDateEntite = useMemo(() => {
    if (entitesFiltre.size === 0) return dossiersRechercheDate;
    return dossiersRechercheDate.filter(
      (dossier) =>
        (entitesFiltre.has('hotel') && (dossier.postesHotel ?? []).length > 0) ||
        (entitesFiltre.has('bureau') && (dossier.postesBureau ?? []).length > 0),
    );
  }, [dossiersRechercheDate, entitesFiltre]);

  // Expérience appliquée AVANT le statut (même patron que TableauDeBordAccueil.jsx/
  // Planification.jsx) : les compteurs de chaque bouton de statut reflètent la tranche
  // d'expérience actuellement sélectionnée, pas la liste entière.
  const dossiersRechercheDateExperience = useMemo(() => {
    if (!experienceFiltre) return dossiersRechercheDateEntite;
    return dossiersRechercheDateEntite.filter((dossier) => dossier.experience === experienceFiltre);
  }, [dossiersRechercheDateEntite, experienceFiltre]);

  const compteursParStatut = useMemo(() => {
    const compteurs = {};
    for (const dossier of dossiersRechercheDateExperience) {
      compteurs[dossier.statut_code] = (compteurs[dossier.statut_code] ?? 0) + 1;
    }
    return compteurs;
  }, [dossiersRechercheDateExperience]);

  const dossiersFiltres = useMemo(() => {
    if (!statutFiltre) return dossiersRechercheDateExperience;
    return dossiersRechercheDateExperience.filter((dossier) => dossier.statut_code === statutFiltre);
  }, [dossiersRechercheDateExperience, statutFiltre]);

  const enregistrerResultat = async (dossier, codeAction, commentaire) => {
    setEnCoursId(dossier.id);
    setErreurAction(null);
    try {
      await appliquerTransition(dossier.id, { codeAction, commentaire });
      setActionAConfirmer(null);
      setRafraichir((compteur) => compteur + 1);
    } catch (erreur) {
      // Modale gardée ouverte (pas de setActionAConfirmer(null) ici) : l'agent peut corriger/
      // retenter sans retaper son commentaire depuis zéro — l'erreur s'affiche dans la modale
      // elle-même (voir ModaleResultatFormation ci-dessous), pas sur la page en arrière-plan.
      setErreurAction(
        erreur.response
          ? (erreur.response.data?.erreur ?? "Impossible d'enregistrer ce résultat de formation. Merci de réessayer.")
          : 'Connexion au serveur impossible. Vérifiez le réseau et réessayez.',
      );
    } finally {
      setEnCoursId(null);
    }
  };

  if (chargementSession) {
    return (
      <PageBackOffice>
        <p>Chargement de la session…</p>
      </PageBackOffice>
    );
  }

  return (
    <PageBackOffice>
      <div className="page-suivi-formation">
        <header className="page-suivi-formation__entete">
          <div className="page-suivi-formation__titre-bloc">
            <h1>Suivi des formations</h1>
          </div>
          <EnTeteBackOffice />
        </header>

        {chargement && <p>Chargement…</p>}
        {erreur && <p role="alert">{erreur}</p>}

        {!chargement && !erreur && (
          <>
            {/* Ordre aligné sur Suivi des tests (Planification.jsx, redesign 2026-09-26, demande
                utilisateur explicite "même disposition... et même ordre") : filtres en liste
                déroulante (Expérience), puis barre de recherche, puis panneau de filtres en
                boutons, puis la liste. Plus de bouton "Plus de filtres" pour les masquer (retiré le
                2026-09-11, décision utilisateur : composant PanneauFiltresRepliable.jsx supprimé,
                ce bloc reste désormais visible en permanence). */}
            {/* Filtre "Expérience" — même mécanisme <select> que
                Planification.jsx (Suivi des tests), filtrage entièrement client. */}
            <div className="page-suivi-formation__filtres-avances">
              <label className="page-suivi-formation__filtre-experience">
                <span>Expérience</span>
                <select value={experienceFiltre} onChange={(evenement) => setExperienceFiltre(evenement.target.value)}>
                  <option value="">Toutes</option>
                  {CODES_EXPERIENCE_ACCECIT.map((code) => (
                    <option key={code} value={code}>
                      {libelleExperience(code)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* Composant partagé (core/dossier/FiltresRechercheDossiers.jsx, même modèle que
                Dossiers candidats/Suivi des tests, Code postal activé le 2026-09-11 — demande
                utilisateur, voir listerSuiviFormation/dossierRepository.js pour l'ajout du
                champ). placeholder/ariaLabel propres à cet écran, inchangés depuis avant cette
                harmonisation. Du/Au filtrent ici sur la date d'envoi en formation
                (date_entree_statut), pas la date de dernière mise à jour du dossier. */}
            <FiltresRechercheDossiers
              recherche={recherche}
              onChangerRecherche={setRecherche}
              placeholder="Nom, prénom, N° dossier, poste, formateur ou statut"
              ariaLabel="Rechercher un dossier par nom, prénom, n° de dossier, poste, formateur ou statut"
              codePostalFiltre={codePostalFiltre}
              onChangerCodePostalFiltre={setCodePostalFiltre}
              dateDebutFiltre={dateDebutFiltre}
              onChangerDateDebutFiltre={setDateDebutFiltre}
              dateFinFiltre={dateFinFiltre}
              onChangerDateFinFiltre={setDateFinFiltre}
            />

            {/* Panneau de filtres en boutons — plusieurs ajustements successifs le 2026-09-26 (voir
                SuiviFormation.css, .page-suivi-formation__panneau-filtres, pour le détail), ce
                dernier étant le seul à changer la STRUCTURE du DOM : demande utilisateur explicite,
                "la position actuelle du bloc Statut est validée, ne la change pas — déplace
                uniquement le bloc Secteur tout à gauche". Le séparateur et le groupe "Statut"
                sont désormais enveloppés ensemble (.page-suivi-formation__bloc-statut) pour former
                UNE seule unité dans la grille à 3 colonnes du panneau (1fr / auto / 1fr) : Secteur
                dans la 1ʳᵉ colonne (aligné à gauche), ce bloc dans la 2ᵉ (centrée par les deux
                colonnes 1fr qui l'entourent), 3ᵉ colonne vide — Suivi des tests, lui, N'A PAS été
                touché (Planification.jsx/.css), sa disposition reste celle validée. Dupliqué
                plutôt que partagé (CLAUDE.md, conventions du projet). Un seul bloc "Statut" ici
                (pas de second bloc "Rendez-vous" comme sur Suivi des tests, cette page n'a qu'une
                seule notion de statut). */}
            <div className="page-suivi-formation__panneau-filtres">
              <div className="page-suivi-formation__filtre-entite-standalone">
                <FiltreEntite
                  entitesFiltre={entitesFiltre}
                  onBasculerEntite={basculerEntiteFiltre}
                  compteurHotel={compteurHotel}
                  compteurBureau={compteurBureau}
                />
              </div>

              <div className="page-suivi-formation__bloc-statut">
                <span className="page-suivi-formation__separateur" aria-hidden="true" />

                <div className="page-suivi-formation__groupe-filtre-statut">
                  <span className="page-suivi-formation__label-filtre-statut">Statut</span>
                  <FiltresStatut
                    statuts={STATUTS_FILTRABLES}
                    statutFiltre={statutFiltre}
                    onChangerStatutFiltre={setStatutFiltre}
                    compteurTous={dossiersRechercheDateExperience.length}
                    compteurs={compteursParStatut}
                  />
                </div>
              </div>
            </div>
          </>
        )}

        {!chargement && !erreur && dossiersFiltres.length === 0 && (
          <p className="page-suivi-formation__vide">Aucun dossier ne correspond aux critères actuels.</p>
        )}

        {!chargement && !erreur && dossiersFiltres.length > 0 && (
          <ul className="page-suivi-formation__liste">
            {dossiersFiltres.map((dossier) => (
              <li key={dossier.id} className="page-suivi-formation__item">
                <span className="page-suivi-formation__candidat">
                  #{dossier.id} {dossier.candidat_prenom} {dossier.candidat_nom}
                </span>
                <span className="page-suivi-formation__date">
                  {dossier.date_entree_statut ? FORMAT_DATE.format(new Date(dossier.date_entree_statut)) : '—'}
                </span>
                <span className="page-suivi-formation__formateur">
                  {dossier.formateur_prenom || dossier.formateur_nom
                    ? `${dossier.formateur_prenom ?? ''} ${dossier.formateur_nom ?? ''}`.trim()
                    : '—'}
                </span>
                <span className="page-suivi-formation__experience">{libelleExperience(dossier.experience)}</span>
                <StatutBadge libelle={libelleBadgeStatut(dossier)} variante={varianteStatut(dossier.statut_code)} />

                {accesComplet && dossier.statut_code === 'valide_envoi_formation' && (
                  <div className="page-suivi-formation__actions">
                    <button
                      type="button"
                      disabled={enCoursId === dossier.id}
                      onClick={() =>
                        setActionAConfirmer({ dossier, codeAction: CODE_ACTION_FORMATION_VALIDEE, titre: 'Formation validée' })
                      }
                    >
                      Formation validée
                    </button>
                    <button
                      type="button"
                      className="page-suivi-formation__bouton-secondaire"
                      disabled={enCoursId === dossier.id}
                      onClick={() =>
                        setActionAConfirmer({
                          dossier,
                          codeAction: CODE_ACTION_FORMATION_NON_VALIDEE,
                          titre: 'Formation non validée',
                        })
                      }
                    >
                      Formation non validée
                    </button>
                  </div>
                )}

                {/* "Voir le dossier" — placé en dernier sur la ligne (audit 2026-08-31, décision
                    utilisateur : ordre nom/date/formateur/statut/"Formation validée"/"Formation non
                    validée"/"Voir le dossier"), déplacé depuis sa position d'origine juste après le
                    badge de statut. Même bouton (style/couleur/cadre/route fiche dossier) que sur
                    "Suivi des tests" (Planification.jsx, .planification__action-voir) : consultation
                    de la fiche dossier complète (onglet "Formation", historique complet — voir
                    Formation.jsx), sans restriction de rôle, contrairement aux deux boutons "Formation
                    validée"/"Formation non validée" ci-dessus (accesComplet). Accueil/Coordination,
                    qui n'a ici qu'un accès lecture seule (voir commentaire d'en-tête de ce fichier),
                    doit tout de même pouvoir consulter le dossier depuis cette page. */}
                <button
                  type="button"
                  className="page-suivi-formation__action-voir"
                  onClick={() => navigate(`/coordination/dossiers/${dossier.id}/formation`)}
                >
                  Voir le dossier
                </button>
              </li>
            ))}
          </ul>
        )}

        {actionAConfirmer && (
          <ModaleResultatFormation
            dossier={actionAConfirmer.dossier}
            titre={actionAConfirmer.titre}
            enCours={enCoursId === actionAConfirmer.dossier.id}
            erreur={erreurAction}
            onAnnuler={() => {
              setActionAConfirmer(null);
              setErreurAction(null);
            }}
            onConfirmer={(commentaire) =>
              enregistrerResultat(actionAConfirmer.dossier, actionAConfirmer.codeAction, commentaire)
            }
          />
        )}
      </div>
    </PageBackOffice>
  );
}
