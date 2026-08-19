import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import DossierList from '../../core/dossier/DossierList';
import FiltresStatut from '../../core/dossier/FiltresStatut';
import FiltresRechercheDossiers from '../../core/dossier/FiltresRechercheDossiers';
import { filtrerDossiers } from '../../core/dossier/filtrerDossiers';
import { useParametreURL, useEnsembleURL } from '../../core/filtres/useParametreURL';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import { useSession } from '../../core/auth/useSession';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import { listerDossiers, listerStatuts } from '../../services/dossierService';
import './TableauDeBordAccueil.css';

// Mapping purement visuel, propre à cette page (pas au moteur générique DossierList/StatutBadge,
// voir Modularité CLAUDE.md) — donnée de test locale au même titre que
// formulaireConfig.accecit.js le temps que `statuts` porte une polarité succès/échec/attente en
// base : un code absent de ce mapping (autre entité, nouveau statut) retombe simplement sur un
// badge neutre plutôt que d'échouer.
// Une variante distincte par statut (voir styles/variables.css, --statut-*) plutôt que les 4
// polarités génériques seules — même mapping que Backoffice.jsx (dupliqué plutôt que partagé :
// quelques lignes de données, pas de quoi justifier un module commun, voir CLAUDE.md conventions
// du projet).
const VARIANTE_PAR_CODE_ACCECIT = {
  // 'nouveau' retiré (audit 2026-08-19) : plus aucun dossier ne peut atteindre ce statut depuis
  // que dossierService.inscrireCandidat fait passer automatiquement en_attente_pieces à la fin
  // d'une inscription (transaction atomique) — les 20 derniers dossiers encore à "nouveau" (tous
  // antérieurs au moteur de workflow lui-même, 21/07/2026) ont été basculés rétroactivement, voir
  // scripts/basculerDossiersNouveauEnAttentePieces.js. Un code absent de ce mapping retombe de
  // toute façon sur le badge neutre (voir varianteStatut ci-dessous) : rien à afficher au cas où
  // la valeur "nouveau" réapparaîtrait un jour (elle reste dans l'enum en base, volontairement).
  en_attente_pieces: 'attente',
  en_attente_verification: 'attente', // workflow hérité, plus jamais atteint
  test_planifie: 'bleu',
  test_non_realise: 'alerte',
  invalide: 'echec',
  valide_envoi_formation: 'succes',
  valide_pret_embauche: 'vert-clair',
};
function varianteStatut(code) {
  return VARIANTE_PAR_CODE_ACCECIT[code] ?? 'neutre';
}

// Libellés des postes (colonne "Poste" de DossierList.jsx) — mêmes codes/libellés que
// BlocDisponibilites.jsx (POSTES_BUREAU/POSTES_HOTEL), dupliqué plutôt que partagé (même
// convention que VARIANTE_PAR_CODE_ACCECIT ci-dessus, voir CLAUDE.md conventions du projet) : un
// code absent (poste ajouté au formulaire mais pas encore ici) retombe simplement sur le code
// brut plutôt que d'échouer.
const LIBELLES_POSTE_PAR_CODE_ACCECIT = {
  nettoyage: 'Nettoyage',
  vitrerie: 'Vitrerie',
  machiniste: 'Machiniste',
  chef_equipe: "Chef d'équipe",
  autres: 'Autres',
  femme_valet_chambre: 'Femme/Valet de chambre',
  cafetier: 'Cafétier(ère)',
  equipier: 'Équipier(ère)',
  gouvernant: 'Gouvernant(e)',
};
function libellePoste(code) {
  return LIBELLES_POSTE_PAR_CODE_ACCECIT[code] ?? code;
}

// Tous les statuts réellement atteignables aujourd'hui dans le workflow actif (vérifié en base :
// `est_initial` ou cible d'une transition existante dans `transitions_statut`, entité ACCECIT,
// 2026-08-04) — propre à cette page, pas au moteur générique FiltresStatut.jsx qui reste piloté
// entièrement par la prop `statuts` qu'on lui passe. "En attente de vérification" (workflow
// hérité) n'y figure volontairement pas : plus aucun dossier ne peut l'atteindre. "nouveau" retiré
// le 2026-08-19 pour la même raison (voir VARIANTE_PAR_CODE_ACCECIT ci-dessus) : plus aucune
// inscription ne peut aujourd'hui s'y arrêter, et les derniers dossiers résiduels ont été
// basculés vers en_attente_pieces.
const CODES_STATUTS_FILTRES_ACCUEIL = [
  'en_attente_pieces',
  'test_planifie',
  // Permet à l'accueil d'isoler d'un coup les dossiers en attente de replanification après un
  // test invalidé, sans devoir les repérer dans la liste complète (voir Validation.jsx,
  // STATUTS_REPLANIFIABLES, pour l'action "Replanifier" elle-même). "invalide" remplace
  // "verdict_negatif" (workflow v3, verdict_negatif retiré du parcours actif).
  'test_non_realise',
  'invalide',
  // Ajoutés pour couvrir les deux verdicts positifs (voir 9778d03) : sans ces deux entrées, les
  // dossiers validés (embauche directe ou envoi en formation) restaient visibles dans la liste
  // mais impossibles à isoler par filtre sur cette page, contrairement au back-office recruteur.
  'valide_envoi_formation',
  'valide_pret_embauche',
];

// Tableau de bord Accueil (CLAUDE.md, besoins Accueil/Coordination : "vue centralisée des
// dossiers en attente") — liste les dossiers de l'entité courante, filtrables par statut. Une
// seule action par ligne, "Étudier le dossier" (Validation.jsx : pièces + export ZIP +
// transitions + notes + informations d'inscription complètes, tous statuts) — fusion de l'ancien
// Back-office recruteur (/recruteur/dossiers, supprimé) dans cette page, seule différence relevée
// à l'audit entre les deux tableaux (mêmes colonnes, mêmes filtres, même route API
// GET /api/dossiers, mêmes rôles ROLES_CONSULTATION_DOSSIERS côté back).
// Les actions "Pièces"/"Relances"/"Replanifier", auparavant directement sur cette ligne,
// vivent désormais sur la fiche dossier elle-même (audit 2026-08-19, colonne Actions surchargée
// sur tablette — jusqu'à 4 boutons par ligne) : voir Validation.jsx, qui reste le seul et même
// écran de destination, pour ne pas éclater la fiche dossier en plusieurs pages divergentes selon
// l'entrée utilisée.
export default function TableauDeBordAccueil() {
  const { utilisateur, chargement: chargementSession } = useSession();
  const navigate = useNavigate();

  const [statuts, setStatuts] = useState([]);
  // Filtres persistés dans l'URL (query params) plutôt qu'en state React local (CLAUDE.md, retour
  // arrière navigateur depuis une fiche dossier : le filtre actif ne doit pas se perdre) — voir
  // useParametreURL.js. null = tous les statuts (comportement par défaut inchangé).
  const [statutFiltre, setStatutFiltre] = useParametreURL('statut', null);
  const [dossiers, setDossiers] = useState([]);
  const [chargementDossiers, setChargementDossiers] = useState(true);
  const [erreur, setErreur] = useState(null);

  // Recherche nom/prénom + plage de date, combinées au statutFiltre ci-dessus — filtrage
  // entièrement client (voir filtrerDossiers.js), la liste `dossiers` étant déjà intégralement en
  // mémoire.
  const [recherche, setRecherche] = useParametreURL('q', '');
  const [dateDebutFiltre, setDateDebutFiltre] = useParametreURL('date_debut', '');
  const [dateFinFiltre, setDateFinFiltre] = useParametreURL('date_fin', '');

  // Filtre "Entité" (Hôtellerie/Tertiaire) — même patron que Backoffice.jsx (recruteur) : deux
  // boutons indépendamment activables, jamais d'option "Toutes" dédiée (ferait doublon avec le
  // bouton "Tous" déjà porté par FiltresStatut ci-dessous), Set vide = aucune restriction.
  // Filtrage entièrement client (dossier.postesHotel/postesBureau déjà présents sur chaque
  // dossier renvoyé par GET /api/dossiers, voir filtrerDossiers.js), même mécanisme que
  // recherche/dateDebutFiltre/dateFinFiltre ci-dessus.
  const [entitesFiltre, basculerEntiteFiltre] = useEnsembleURL('entites');

  useEffect(() => {
    listerStatuts()
      .then(setStatuts)
      .catch(() => {
        // Filtres non critiques : la liste des dossiers ci-dessous reste consultable même si
        // ce second appel échoue, donc pas de message d'erreur bloquant pour si peu.
      });
  }, []);

  // Un seul chargement, tous statuts confondus (statutFiltre n'est plus un paramètre de requête,
  // voir son commentaire de déclaration) : le filtrage par statut se fait désormais entièrement
  // client, comme recherche/dateDebutFiltre/dateFinFiltre/entitesFiltre ci-dessous — nécessaire
  // pour calculer le compteur de CHAQUE bouton de statut (dossiersFiltresSansStatut ci-dessous) à
  // partir de la même liste en mémoire, plutôt que de ne connaître que le statut actuellement
  // sélectionné.
  useEffect(() => {
    let annule = false;
    setChargementDossiers(true);
    setErreur(null);
    listerDossiers()
      .then((valeur) => {
        if (!annule) setDossiers(valeur);
      })
      .catch((erreur) => {
        if (!annule) setErreur(erreur.response?.data?.erreur ?? 'Impossible de récupérer les dossiers.');
      })
      .finally(() => {
        if (!annule) setChargementDossiers(false);
      });
    return () => {
      annule = true;
    };
  }, []);

  // Recherche/dates uniquement (pas encore l'entité ni le statut) : base commune aux compteurs
  // "Hôtellerie"/"Tertiaire" ci-dessous, qui doivent chacun ignorer l'état courant du filtre
  // entité (Set) pour répondre à la question "combien de dossiers dans CETTE entité si je clique
  // ce bouton", indépendamment de l'autre bouton entité déjà actif ou non.
  const dossiersRechercheDate = useMemo(
    () => filtrerDossiers(dossiers, { recherche, dateDebutFiltre, dateFinFiltre, libellePoste, entitesFiltre: new Set() }),
    [dossiers, recherche, dateDebutFiltre, dateFinFiltre],
  );

  // Recherche/dates/entité (pas encore le statut) : c'est cette liste, group par statut_code, qui
  // donne le compteur de CHAQUE bouton de statut (y compris "Tous") — le nombre de résultats qu'on
  // obtiendrait en cliquant ce bouton compte tenu des autres filtres actifs.
  const dossiersFiltresSansStatut = useMemo(
    () => filtrerDossiers(dossiers, { recherche, dateDebutFiltre, dateFinFiltre, libellePoste, entitesFiltre }),
    [dossiers, recherche, dateDebutFiltre, dateFinFiltre, entitesFiltre],
  );

  const dossiersFiltres = useMemo(
    () =>
      statutFiltre
        ? dossiersFiltresSansStatut.filter((dossier) => dossier.statut_code === statutFiltre)
        : dossiersFiltresSansStatut,
    [dossiersFiltresSansStatut, statutFiltre],
  );

  const compteursParStatut = useMemo(() => {
    const compte = {};
    dossiersFiltresSansStatut.forEach((dossier) => {
      compte[dossier.statut_code] = (compte[dossier.statut_code] ?? 0) + 1;
    });
    return compte;
  }, [dossiersFiltresSansStatut]);

  // Compteur des boutons "Hôtellerie"/"Tertiaire" : recherche/dates/statut appliqués, entité
  // ignorée (voir dossiersRechercheDate ci-dessus) — chaque bouton compte comme si LUI SEUL était
  // sélectionné, pour rester cohérent avec le comportement de clic (Set, indépendamment activable).
  // Volontairement PAS mutuellement exclusifs (audit 2026-08-18, point de vigilance "double
  // comptage") : un dossier avec à la fois un poste Hôtellerie et un poste Tertiaire (candidat
  // intéressé par les deux familles, cas permis par BlocDisponibilites.jsx) compte dans les deux
  // boutons plutôt que d'être arbitrairement rattaché à une seule "entité principale" — le
  // masquer d'un des deux filtres cacherait un candidat réellement pertinent au recruteur qui
  // consulte CE filtre. Ce choix implique Tous < Hôtellerie + Tertiaire si un tel dossier existe
  // un jour (aucun actuellement) : ce n'est pas un bug, "Tous" (filtrerDossiers.js) reste exact
  // car calculé comme le nombre de dossiers DISTINCTS ayant au moins un poste, pas comme la somme
  // de ces deux compteurs.
  const compteurHotel = useMemo(
    () =>
      dossiersRechercheDate.filter(
        (dossier) => (!statutFiltre || dossier.statut_code === statutFiltre) && (dossier.postesHotel ?? []).length > 0,
      ).length,
    [dossiersRechercheDate, statutFiltre],
  );
  const compteurBureau = useMemo(
    () =>
      dossiersRechercheDate.filter(
        (dossier) => (!statutFiltre || dossier.statut_code === statutFiltre) && (dossier.postesBureau ?? []).length > 0,
      ).length,
    [dossiersRechercheDate, statutFiltre],
  );

  const statutsFiltres = useMemo(
    () => statuts.filter((statut) => CODES_STATUTS_FILTRES_ACCUEIL.includes(statut.code)),
    [statuts],
  );

  if (chargementSession) {
    return (
      <PageBackOffice>
        <p>Chargement de la session…</p>
      </PageBackOffice>
    );
  }

  // Le back refuserait de toute façon (401/403) sans session valide ou rôle autorisé : mieux
  // vaut le dire tout de suite (même principe que CaptureTablette.jsx).
  if (!utilisateur) {
    return (
      <PageBackOffice>
        <p role="alert">
          Vous devez être connecté pour accéder au tableau de bord. <Link to="/connexion">Se connecter</Link>
        </p>
      </PageBackOffice>
    );
  }

  return (
    <PageBackOffice>
      <div className="tableau-bord-accueil">
        <header className="tableau-bord-accueil__entete">
          <h1>Dossiers candidats</h1>
          {/* Bouton "Planification des tests" retiré (refonte navigation, 2026-08-17) : couvert
              par le lien "Suivi des tests" de la barre de navigation commune, voir
              BarreNavigation.jsx (montée dans PageBackOffice.jsx). */}
          <EnTeteBackOffice />
        </header>

        <FiltresRechercheDossiers
          recherche={recherche}
          onChangerRecherche={setRecherche}
          dateDebutFiltre={dateDebutFiltre}
          onChangerDateDebutFiltre={setDateDebutFiltre}
          dateFinFiltre={dateFinFiltre}
          onChangerDateFinFiltre={setDateFinFiltre}
        />
        <FiltresStatut
          statuts={statutsFiltres}
          statutFiltre={statutFiltre}
          onChangerStatutFiltre={setStatutFiltre}
          compteurTous={dossiersFiltresSansStatut.length}
          compteurs={compteursParStatut}
          filtresSupplementaires={
            <div className="tableau-bord-accueil__filtre-entite" role="group" aria-label="Filtrer par entité">
              <button
                type="button"
                className={entitesFiltre.has('hotel') ? 'actif' : ''}
                aria-pressed={entitesFiltre.has('hotel')}
                onClick={() => basculerEntiteFiltre('hotel')}
              >
                Hôtellerie <strong>({compteurHotel})</strong>
              </button>
              <button
                type="button"
                className={entitesFiltre.has('bureau') ? 'actif' : ''}
                aria-pressed={entitesFiltre.has('bureau')}
                onClick={() => basculerEntiteFiltre('bureau')}
              >
                Tertiaire <strong>({compteurBureau})</strong>
              </button>
            </div>
          }
        />

        {chargementDossiers && <p>Chargement des dossiers…</p>}
        {erreur && <p role="alert">{erreur}</p>}

        {!chargementDossiers && !erreur && (
          <DossierList
            dossiers={dossiersFiltres}
            varianteStatut={varianteStatut}
            libellePoste={libellePoste}
            actions={[
              {
                libelle: 'Étudier le dossier',
                onSelectionner: (dossier) => navigate(`/recruteur/dossiers/${dossier.id}/validation`),
                // Style back-office accent (cadre séparé, dégradé brun/doré, largeur fixe forçant
                // le retour à la ligne "Étudier / le / dossier") conservé tel quel malgré le
                // retrait de Pièces/Relances/Replanifier (voir DossierList.css,
                // .dossier-list__action--accent) : mise en forme déjà validée avant la
                // simplification de la colonne Actions, pas de raison d'en changer maintenant que
                // ce bouton y est seul. `alignerADroite` retiré (audit 2026-08-19) : poussait le
                // bouton à l'extrême droite de la cellule, utile pour le distinguer des autres
                // actions quand elles existaient encore — seul restant, il est maintenant centré
                // via .dossier-list__actions (voir DossierList.css).
                accent: true,
              },
            ]}
          />
        )}
      </div>
    </PageBackOffice>
  );
}
