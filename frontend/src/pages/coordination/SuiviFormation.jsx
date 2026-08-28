import { useEffect, useMemo, useState } from 'react';
import { useSession } from '../../core/auth/useSession';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import StatutBadge from '../../core/workflow/StatutBadge';
import FiltresStatut from '../../core/dossier/FiltresStatut';
import FiltrePlageDate from '../../core/filtres/FiltrePlageDate';
import { normaliserTexte } from '../../core/filtres/normaliserTexte';
import { useParametreURL } from '../../core/filtres/useParametreURL';
import { listerSuiviFormation } from '../../services/dossierService';
import { appliquerTransition } from '../../services/transitionService';
import { useRafraichissementAuto } from '../../core/dossier/useRafraichissementAuto';
import './SuiviFormation.css';

// Suivi de formation (audit 2026-08-28, révise une décision antérieure — "Validé - envoyé en
// formation"/"Validé - prêt à l'embauche" étaient posés comme deux statuts terminaux
// indépendants, la suite se faisant dans SmartOF, hors périmètre app) : liste des dossiers ayant
// atteint "Validé - envoyé en formation", avec retour manuel du résultat de formation (saisi à la
// main par l'agent depuis un support externe, papier ou autre — pas d'intégration SmartOF ici).
//
// Une SEULE page partagée par les 4 rôles (Accueil/Coordination, Formateur, Inspecteur, Admin —
// voir BarreNavigation.jsx), pas dupliquée par rôle comme Evaluation.jsx : même patron que
// Planification.jsx ("Suivi des tests"), qui différencie déjà en interne Coordination
// (lecture/actions groupées) de Formateur/Inspecteur (lecture seule sur certains blocs) via un
// simple test sur roleCode, plutôt que deux pages quasi identiques. Ici : Accueil/Coordination
// voit la liste en LECTURE SEULE (aucun bouton), Formateur/Inspecteur/Admin ont les 2 boutons
// d'action. La vraie barrière reste côté serveur (transition_roles, voir workflowEngine.js) —
// masquer les boutons ici n'est qu'un confort d'affichage, pas la sécurité elle-même.
//
// Statuts affichables (point 1, audit 2026-08-28) — même mapping variante que les 6 autres pages
// qui portent VARIANTE_PAR_CODE_ACCECIT (TableauDeBordAccueil.jsx et al.), dupliqué plutôt que
// partagé (voir CLAUDE.md conventions du projet). "En attente" reste le libellé affiché pour
// valide_envoi_formation SUR CETTE PAGE (comportement par défaut avant ce changement), distinct de
// son libellé officiel "Validé - envoyé en formation" utilisé ailleurs dans l'app (badge de
// statut, lui, garde toujours le libellé officiel — voir StatutBadge ci-dessous, jamais "En
// attente").
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
function varianteStatut(code) {
  return VARIANTE_PAR_CODE_ACCECIT[code] ?? 'neutre';
}

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

// Commentaire auto-généré (jamais tapé par l'agent, voir demande explicite "sans commentaire
// obligatoire") — même patron que marquerNonRealise (ListeEvaluationsAFaire.jsx) : le serveur
// (workflowEngine.appliquerTransition) exige quand même un commentaire non vide à l'insertion
// dans historique_statuts, contrainte générique du moteur, non contournable transition par
// transition — ce texte la satisfait sans jamais afficher de champ de saisie côté agent.
const CODE_ACTION_FORMATION_VALIDEE = 'valider_pret_embauche';
const CODE_ACTION_FORMATION_NON_VALIDEE = 'invalider_formation';

// Libellés des postes — même mapping que Planification.jsx (Suivi des tests)/TableauDeBordAccueil.jsx,
// dupliqué plutôt que partagé (voir CLAUDE.md conventions du projet).
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

// Recherche élargie (nom/prénom, n° de dossier, poste(s) déclaré(s), nom du formateur, libellé du
// statut) — même patron que Planification.jsx (rechercheCorrespond), dupliqué plutôt que partagé
// (voir CLAUDE.md conventions du projet, et son commentaire d'en-tête : la forme d'un dossier
// diffère de celle d'un rendez-vous). rechercheEstNumeroDossier/rechercheEstNumerique : une saisie
// numérique courte ("108") vise UNIQUEMENT le n° de dossier en égalité stricte, jamais une simple
// inclusion — même correctif que filtrerDossiers.js/Planification.jsx (audit 2026-08-19).
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
  const { utilisateur, chargement: chargementSession } = useSession();
  const [dossiers, setDossiers] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);
  const [enCoursId, setEnCoursId] = useState(null);
  const [erreurAction, setErreurAction] = useState(null);
  const [rafraichir, setRafraichir] = useState(0);

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
  const [dateDebutFiltre, setDateDebutFiltre] = useParametreURL('date_debut', '');
  const [dateFinFiltre, setDateFinFiltre] = useParametreURL('date_fin', '');

  const accesComplet = ['formateur', 'inspecteur', 'admin'].includes(utilisateur?.roleCode);

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
    return dossiers.filter((dossier) => {
      if (debut || fin) {
        if (!dossier.date_entree_statut) return false;
        const date = new Date(dossier.date_entree_statut);
        if (debut && date < debut) return false;
        if (fin && date > fin) return false;
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
  }, [dossiers, recherche, dateDebutFiltre, dateFinFiltre]);

  const compteursParStatut = useMemo(() => {
    const compteurs = {};
    for (const dossier of dossiersRechercheDate) {
      compteurs[dossier.statut_code] = (compteurs[dossier.statut_code] ?? 0) + 1;
    }
    return compteurs;
  }, [dossiersRechercheDate]);

  const dossiersFiltres = useMemo(() => {
    if (!statutFiltre) return dossiersRechercheDate;
    return dossiersRechercheDate.filter((dossier) => dossier.statut_code === statutFiltre);
  }, [dossiersRechercheDate, statutFiltre]);

  const enregistrerResultat = async (dossier, codeAction, commentaire) => {
    setEnCoursId(dossier.id);
    setErreurAction(null);
    try {
      await appliquerTransition(dossier.id, { codeAction, commentaire });
      setRafraichir((compteur) => compteur + 1);
    } catch (erreur) {
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
        {erreurAction && <p role="alert">{erreurAction}</p>}

        {!chargement && !erreur && (
          <>
            <FiltresStatut
              statuts={STATUTS_FILTRABLES}
              statutFiltre={statutFiltre}
              onChangerStatutFiltre={setStatutFiltre}
              compteurTous={dossiersRechercheDate.length}
              compteurs={compteursParStatut}
            />

            <div className="page-suivi-formation__filtres">
              <label className="page-suivi-formation__filtre-recherche">
                <span>Rechercher</span>
                <input
                  type="search"
                  value={recherche}
                  onChange={(evenement) => setRecherche(evenement.target.value)}
                  placeholder="Nom, prénom, N° dossier, poste, formateur ou statut"
                />
              </label>

              {/* Même composant que Dossiers candidats/Suivi des tests (FiltrePlageDate.jsx) —
                  filtre ici sur la date d'envoi en formation (date_entree_statut), pas la date de
                  dernière mise à jour du dossier. */}
              <FiltrePlageDate
                dateDebutFiltre={dateDebutFiltre}
                onChangerDateDebutFiltre={setDateDebutFiltre}
                dateFinFiltre={dateFinFiltre}
                onChangerDateFinFiltre={setDateFinFiltre}
              />
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
                <StatutBadge libelle={dossier.statut_libelle} variante={varianteStatut(dossier.statut_code)} />

                {accesComplet && dossier.statut_code === 'valide_envoi_formation' && (
                  <div className="page-suivi-formation__actions">
                    <button
                      type="button"
                      disabled={enCoursId === dossier.id}
                      onClick={() => enregistrerResultat(dossier, CODE_ACTION_FORMATION_VALIDEE, 'Formation validée.')}
                    >
                      {enCoursId === dossier.id ? 'Enregistrement...' : 'Formation validée'}
                    </button>
                    <button
                      type="button"
                      className="page-suivi-formation__bouton-secondaire"
                      disabled={enCoursId === dossier.id}
                      onClick={() =>
                        enregistrerResultat(dossier, CODE_ACTION_FORMATION_NON_VALIDEE, 'Formation non validée.')
                      }
                    >
                      {enCoursId === dossier.id ? 'Enregistrement...' : 'Formation non validée'}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageBackOffice>
  );
}
