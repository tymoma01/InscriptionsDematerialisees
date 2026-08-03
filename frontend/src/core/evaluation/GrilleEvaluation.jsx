import { useEffect, useState } from 'react';
import { obtenirQuestionnaire, enregistrerEvaluation } from '../../services/evaluationService';
import NotesDossier from '../dossier/NotesDossier';
import ChecklistInspection from './ChecklistInspection';
import './GrilleEvaluation.css';

// Échelle de notation d'une question 'grille_qcu' (voir backend evaluationEngine.js,
// ACQUIS_AUTORISEES) — pas une donnée de configuration par entité comme les questions
// elles-mêmes : c'est la forme même de ce type de question, pas un vocabulaire métier.
const ACQUIS = [
  { code: 'acquis', libelle: 'Acquis' },
  { code: 'non_acquis', libelle: 'Non acquis' },
  { code: 'a_ameliorer', libelle: 'A améliorer' },
];

// Échelle affichée à un Inspecteur (postes bureau, questions savoir_etre/savoir_faire — voir
// seedQuestionnairesEvaluation.js) à la place de ACQUIS ci-dessus — mêmes codes que backend
// evaluationEngine.js (ACQUIS_AUTORISEES, union avec l'échelle hôtel). Rôle qui affiche laquelle
// des deux échelles, pas le poste du dossier (scope Inspecteur procédural, voir rbac.js) : plus
// simple et cohérent avec le seul signal déjà utilisé pour masquer Orientation (estInspecteur).
const NIVEAUX_BUREAU = [
  { code: 'aucune_connaissance', libelle: 'Aucune connaissance' },
  { code: 'a_ameliorer', libelle: 'A améliorer' },
  { code: 'excellent', libelle: 'Excellent' },
];

// Libellés des postes hôtel/bureau pour le sélecteur affiché quand un dossier a coché plusieurs
// postes (voir postesAmbigus plus bas) — mêmes codes/libellés que BlocDisponibilites.jsx
// (POSTES_HOTEL/POSTES_BUREAU), dupliqués ici plutôt que partagés : quelques lignes de données,
// même choix déjà fait pour VARIANTE_PAR_CODE_ACCECIT (TableauDeBordAccueil.jsx/Backoffice.jsx).
const POSTE_HOTEL_LIBELLES = {
  femme_valet_chambre: 'Femme/Valet de chambre',
  cafetier: 'Cafétier(ère)',
  equipier: 'Équipier(ère)',
  gouvernant: 'Gouvernant(e)',
};
const POSTE_BUREAU_LIBELLES = {
  nettoyage: 'Nettoyage',
  vitrerie: 'Vitrerie',
  machiniste: 'Machiniste',
  chef_equipe: "Chef d'équipe",
  autres: 'Autres',
};

function libellePoste(posteCode) {
  if (!posteCode) return 'Générique';
  return POSTE_HOTEL_LIBELLES[posteCode] ?? POSTE_BUREAU_LIBELLES[posteCode] ?? posteCode;
}

// Orientation du candidat en cas de verdict positif (workflow v3, voir backend evaluationEngine.js,
// ORIENTATIONS_AUTORISEES) — sans objet si le résultat global est "Invalidé", jamais affichée
// dans ce cas (voir orientationVisible plus bas).
const ORIENTATIONS = [
  { code: 'envoi_formation', libelle: 'Envoi en formation' },
  { code: 'pret_embauche', libelle: "Prêt à l'embauche" },
];

// Clé interne d'une réponse, unique par (question, item) DANS UN BLOC — item absent pour une
// question 'texte_libre' (une seule réponse par question, pas par item). Ne contient volontairement
// pas le poste : chaque bloc a son propre objet `reponses` (voir blocsQuestionnaire plus bas), pas
// un espace de clés partagé entre postes — questions_evaluation n'étant unique que par
// (questionnaire_id, code) côté back (migration 037), deux postes différents peuvent réutiliser le
// même questionCode, et les fusionner créerait des collisions silencieuses.
function cleReponse(questionCode, itemCode) {
  return `${questionCode}:${itemCode ?? ''}`;
}

// Identifiant stable d'un bloc (poste), utilisé comme clé React et comme espace de nommage des
// inputs radio (voir leur `name` plus bas) — '__generique__' pour le repli sans poste dédié
// (dossier bureau, ou poste hôtel sans questionnaire dédié), posteCode ne pouvant pas servir de
// clé quand il vaut undefined.
function cleBloc(posteCode) {
  return posteCode ?? '__generique__';
}

// Valeurs par défaut pour un questionnaire fraîchement chargé. choix_multiple part à 'non_coche'
// (case réellement décochée à l'écran — un état "non coché" est une réponse légitime, pas un
// vide). grille_qcu part à null : contrairement à choix_multiple, aucune des 3 valeurs de
// l'échelle ACQUIS ne représente "pas encore répondu" — chacune est un vrai jugement du
// formateur, donc en présélectionner une (ex. ACQUIS[0], comme avant) permettait de soumettre une
// évaluation sans avoir réellement répondu à chaque critère. null ne correspond à aucun v.code
// dans le rendu des radios (voir plus bas) : les 3 options restent visuellement décochées tant
// que l'agent n'a pas cliqué. texte_libre part vide.
function valeursParDefaut(questions) {
  const valeurs = {};
  for (const question of questions) {
    if (question.type_question === 'texte_libre') {
      valeurs[cleReponse(question.code)] = '';
      continue;
    }
    const valeurDefaut = question.type_question === 'grille_qcu' ? null : 'non_coche';
    for (const item of question.items) {
      valeurs[cleReponse(question.code, item.code)] = valeurDefaut;
    }
  }
  return valeurs;
}

// Charge un bloc de questionnaire par poste (repli générique côté serveur si posteCode est
// undefined ou n'a pas de questionnaire dédié, voir backend evaluationEngine.listerQuestionnaire),
// en parallèle pour tous les postes fournis — c'est cet empilement qui construit
// `blocsQuestionnaire` (voir plus bas), un bloc = un poste = son propre questionnaire et ses
// propres réponses.
async function chargerBlocs(rendezvousId, postesCodes) {
  const resultats = await Promise.all(
    postesCodes.map((posteCode) =>
      obtenirQuestionnaire({ rendezvousId, posteCode }).then((questions) => ({
        posteCode,
        questions,
        reponses: valeursParDefaut(questions),
      })),
    ),
  );
  return resultats;
}

function blocGrilleIncomplete(bloc) {
  return bloc.questions.filter(
    (question) =>
      question.type_question === 'grille_qcu' &&
      question.items.some((item) => !bloc.reponses[cleReponse(question.code, item.code)]),
  );
}

function blocTexteLibreIncomplet(bloc) {
  return bloc.questions.some(
    (question) =>
      question.type_question === 'texte_libre' && question.obligatoire && !bloc.reponses[cleReponse(question.code)]?.trim(),
  );
}

// reponses envoyées au format attendu par un bloc du payload POST /api/evaluations (voir backend
// evaluationEngine.enregistrerEvaluation, `blocs: [{ posteCode, reponses }]`).
function construireReponsesBloc(bloc) {
  return bloc.questions.flatMap((question) => {
    if (question.type_question === 'texte_libre') {
      return [{ questionCode: question.code, valeur: bloc.reponses[cleReponse(question.code)] }];
    }
    return question.items.map((item) => ({
      questionCode: question.code,
      questionItemCode: item.code,
      valeur: bloc.reponses[cleReponse(question.code, item.code)],
    }));
  });
}

// Grille d'évaluation dynamique selon le ou les postes réellement recherchés par le candidat (voir
// Modularité, CLAUDE.md) : ne connaît aucune question en dur — charge, pour chaque poste retenu,
// le questionnaire résolu côté serveur (GET /api/evaluations/questionnaire, repli générique si le
// poste n'a pas de questionnaire dédié) et empile un bloc par poste, chacun avec ses propres
// réponses (voir blocsQuestionnaire), comme FormulaireInscription compose ses blocs actifs plutôt
// que de les connaître. Un seul verdict global (résultat/orientation/commentaire) couvre
// l'ensemble des blocs à la soumission (voir gererEnvoi).
//
// rendezvous reçu en prop ({ id, dossier_id, candidat_prenom, candidat_nom, postesBureau,
// postesHotel }, voir ListeEvaluationsAFaire.jsx / backend evaluationEngine.listerRendezvousAEvaluer)
// — ce composant ne connaît pas le routage, même patron que CaptureTablette.jsx. roleCode reçu en
// prop pour la même raison (pas de useSession() propre à ce composant) — transmis par
// Evaluation.jsx, qui l'a déjà via sa propre useSession().
export default function GrilleEvaluation({ rendezvous, roleCode, onTermine, onAnnuler }) {
  // Scope Inspecteur procédural (voir rbac.js) : c'est le rôle connecté qui détermine l'échelle de
  // réponse affichée (NIVEAUX_BUREAU vs ACQUIS) et masque Orientation (le bureau n'a pas de notion
  // de formation) — jamais une caractéristique du dossier/poste, cohérent avec le fait qu'aucune
  // vérification technique de scope bureau n'existe côté serveur non plus.
  const estInspecteur = roleCode === 'inspecteur';

  // Plusieurs postes (hôtel OU bureau, jamais les deux à la fois sur un même dossier — typePoste
  // XOR, voir dossierService.js) cochés : le formulaire d'inscription le permet (case à cocher
  // indépendante par poste, voir BlocDisponibilites.jsx) — sans façon fiable de deviner lesquels
  // des questionnaires dédiés s'appliquent, c'est l'agent qui coche ceux sur lesquels porte
  // réellement ce test avant de charger les grilles (empilées, un bloc par poste coché), plutôt
  // qu'une hypothèse fausse sur l'intention du candidat. postesBureau ajouté ici (absent avant
  // l'ajout du questionnaire bureau) : sans lui, un dossier bureau résolvait toujours posteCode à
  // undefined, donc toujours le questionnaire générique de repli (poste_code=NULL), jamais les
  // questionnaires bureau dédiés (seedQuestionnairesEvaluation.js) — même mécanique de résolution
  // que côté hôtel, pas un cas particulier.
  const postesCandidats = [...(rendezvous.postesHotel ?? []), ...(rendezvous.postesBureau ?? [])];
  const postesAmbigus = postesCandidats.length > 1;
  const posteResolutionAutomatique = postesCandidats.length === 1 ? postesCandidats[0] : undefined;

  const [postesChoisis, setPostesChoisis] = useState([]);
  // null tant qu'aucun bloc n'a encore été chargé : sert de garde d'affichage (voir plus bas,
  // écran de sélection vs formulaire) sans avoir besoin d'un état booléen séparé.
  const [blocsQuestionnaire, setBlocsQuestionnaire] = useState(null);
  const [chargement, setChargement] = useState(!postesAmbigus);
  const [erreur, setErreur] = useState(null);

  // Pas de présélection (même principe que les items grille_qcu, voir valeursParDefaut) : rien
  // dans le vocabulaire 'valide'/'invalide' ne représente une absence de décision, donc démarrer
  // sur 'valide' par défaut permettait de soumettre une évaluation sans que le formateur ait
  // réellement tranché. '' ne correspond à aucun des deux radios ci-dessous (voir leur `checked`
  // plus bas) : ni l'un ni l'autre n'apparaît coché tant que l'agent n'a pas cliqué.
  const [resultatGlobal, setResultatGlobal] = useState('');
  const [orientation, setOrientation] = useState('');
  const [commentaire, setCommentaire] = useState('');
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [erreurEnvoi, setErreurEnvoi] = useState(null);

  // Masqué pour un Inspecteur : le bureau n'a pas de notion de formation, l'évaluation y reste
  // binaire (valide/invalide) sans champ supplémentaire à choisir — pas de remplacement, juste
  // absent (voir enregistrerEvaluation côté back, orientation reste NULL dans ce cas).
  const orientationVisible = resultatGlobal === 'valide' && !estInspecteur;

  const gererChangementResultat = (valeur) => {
    setResultatGlobal(valeur);
    if (valeur !== 'valide') setOrientation('');
  };

  const gererBasculePoste = (code) => {
    setPostesChoisis((precedent) => (precedent.includes(code) ? precedent.filter((c) => c !== code) : [...precedent, code]));
  };

  // Charge un bloc par poste coché — déclenché par le clic sur "Continuer" (voir écran de
  // sélection plus bas), pas automatiquement à chaque case cochée : éviter un rechargement complet
  // (et donc la perte des réponses déjà saisies dans les blocs déjà chargés) à chaque bascule.
  const gererValidationSelection = async () => {
    if (postesChoisis.length === 0) return;
    setChargement(true);
    setErreur(null);
    try {
      const blocs = await chargerBlocs(rendezvous.id, postesChoisis);
      setBlocsQuestionnaire(blocs);
    } catch (erreurChargement) {
      setErreur(erreurChargement.response?.data?.erreur ?? 'Impossible de récupérer le(s) questionnaire(s).');
    } finally {
      setChargement(false);
    }
  };

  // Cas non ambigu (un seul poste hôtel, ou aucun — repli générique) : chargement automatique d'un
  // unique bloc au montage, aucun écran de sélection à afficher (voir postesAmbigus plus bas).
  useEffect(() => {
    if (postesAmbigus) return undefined;

    let annule = false;
    setChargement(true);
    setErreur(null);
    chargerBlocs(rendezvous.id, [posteResolutionAutomatique])
      .then((blocs) => {
        if (!annule) setBlocsQuestionnaire(blocs);
      })
      .catch((erreurChargement) => {
        if (!annule) setErreur(erreurChargement.response?.data?.erreur ?? 'Impossible de récupérer le questionnaire.');
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, [rendezvous.id, postesAmbigus, posteResolutionAutomatique]);

  const gererChangementReponse = (indexBloc, cle, valeur) => {
    setBlocsQuestionnaire((precedent) =>
      precedent.map((bloc, index) => (index === indexBloc ? { ...bloc, reponses: { ...bloc.reponses, [cle]: valeur } } : bloc)),
    );
  };

  const gererEnvoi = async (evenement) => {
    evenement.preventDefault();
    if (!resultatGlobal) return;
    if (!commentaire.trim()) return;
    if (orientationVisible && !orientation) return;
    if (blocsQuestionnaire.some((bloc) => blocGrilleIncomplete(bloc).length > 0)) return;
    if (blocsQuestionnaire.some((bloc) => blocTexteLibreIncomplet(bloc))) return;

    setEnvoiEnCours(true);
    setErreurEnvoi(null);

    // Un bloc par poste empilé (voir blocsQuestionnaire) — reponses résolues/revalidées côté
    // serveur bloc par bloc, jamais fusionnées (voir backend evaluationEngine.enregistrerEvaluation
    // et le commentaire sur cleReponse ci-dessus).
    const blocsEnvoyes = blocsQuestionnaire.map((bloc) => ({
      posteCode: bloc.posteCode,
      reponses: construireReponsesBloc(bloc),
    }));

    try {
      // Le serveur fait avancer le statut du dossier dans la même transaction que l'enregistrement
      // de l'évaluation (voir backend evaluationEngine.enregistrerEvaluation) — pas de second appel
      // front à part pour la transition, workflow v3.
      await enregistrerEvaluation({
        rendezvousId: rendezvous.id,
        resultatGlobal,
        orientation: orientationVisible ? orientation : undefined,
        commentaire,
        blocs: blocsEnvoyes,
      });
    } catch (erreurEnvoiRequete) {
      setEnvoiEnCours(false);
      setErreurEnvoi(
        erreurEnvoiRequete.response
          ? (erreurEnvoiRequete.response.data?.erreur ?? "Le serveur n'a pas pu enregistrer l'évaluation. Merci de réessayer.")
          : 'Connexion au serveur impossible. Vérifiez le réseau et réessayez.',
      );
      return;
    }

    setEnvoiEnCours(false);
    onTermine();
  };

  if (postesAmbigus && blocsQuestionnaire === null) {
    return (
      // Fragment plutôt qu'un <div> unique englobant tout : NotesDossier reste un frère de
      // .grille-evaluation, jamais imbriqué dedans (même patron que le formulaire principal
      // plus bas) — sinon sa propre carte (bordure/ombre/fond, voir NotesDossier.css) se
      // retrouverait imbriquée dans celle-ci, agrandie du padding des deux cartes cumulées au
      // lieu de s'étendre en dessous sur toute la largeur, comme sur VerificationPieces.jsx/
      // Relances.jsx/Validation.jsx.
      <>
        <div className="grille-evaluation">
          <h2>
            Évaluation — {rendezvous.candidat_prenom} {rendezvous.candidat_nom}
          </h2>

          {/* Même aide-mémoire que sur la grille principale (voir plus bas), positionnée de la
              même façon — juste sous le titre, avant le reste de l'écran — pour rester visible dès
              cette étape de sélection de poste, avant même que la grille ne soit chargée. */}
          {estInspecteur && <ChecklistInspection />}

          <p>
            Plusieurs postes ont été demandés par ce candidat — cochez celui ou ceux sur lesquels porte cette évaluation :
          </p>
          <div className="grille-evaluation__choix">
            {postesCandidats.map((code) => (
              <label key={code}>
                <input type="checkbox" checked={postesChoisis.includes(code)} onChange={() => gererBasculePoste(code)} />
                {libellePoste(code)}
              </label>
            ))}
          </div>

          {erreur && <p role="alert">{erreur}</p>}

          <div className="grille-evaluation__actions">
            <button type="button" onClick={onAnnuler} disabled={chargement}>
              Annuler
            </button>
            <button type="button" onClick={gererValidationSelection} disabled={chargement || postesChoisis.length === 0}>
              {chargement ? 'Chargement...' : 'Continuer'}
            </button>
          </div>
        </div>

        {/* Notes de l'accueil/coordination sur ce dossier (ex. "à tester sur les postes de FDC et
            cafetier") — utiles au formateur dès ce choix de poste, pas seulement une fois la
            grille chargée. Composant générique réutilisé tel quel (lecture + ajout, voir son
            en-tête de fichier) : le formateur fait déjà partie de ROLES_NOTES_DOSSIER côté back
            (notes.routes.js), aucune variante lecture-seule à part. */}
        <NotesDossier dossierId={rendezvous.dossier_id} />
      </>
    );
  }

  if (erreur) {
    return <p role="alert">{erreur}</p>;
  }
  // Vérifie `blocsQuestionnaire` (pas seulement `chargement`) : juste après "Continuer" sur l'écran
  // de sélection ci-dessus, un rendu intermédiaire est possible avant que le chargement n'ait eu
  // le temps de repasser à true — sans cette garde, le formulaire plus bas accéderait à
  // `blocsQuestionnaire` encore `null`.
  if (chargement || !blocsQuestionnaire) {
    return <p>Chargement de la grille…</p>;
  }

  const plusieursBlocs = blocsQuestionnaire.length > 1;

  // Un texte_libre obligatoire vide bloque déjà la soumission via l'attribut `required` natif du
  // textarea (même principe que le champ Commentaire), revérifié ici pour désactiver le bouton en
  // amont plutôt que de dépendre uniquement de la validation native du navigateur.
  const texteLibreIncomplet = blocsQuestionnaire.some((bloc) => blocTexteLibreIncomplet(bloc));

  // Une question grille_qcu n'a pas d'état "répondu mais vide" légitime (contrairement à
  // texte_libre) : les 3 valeurs de l'échelle ACQUIS sont toutes des jugements réels, aucune ne
  // représente "pas encore répondu" — chaque item doit donc recevoir une réponse avant soumission,
  // quel que soit question.obligatoire (qui ne pilote que l'affichage de l'astérisque ci-dessous).
  // Le back revaliderait de toute façon, bloc par bloc (ACQUIS_AUTORISEES, evaluationEngine.js ne
  // contient aucune valeur "non répondu") — ce contrôle évite juste à l'agent de le découvrir
  // seulement à l'envoi.
  const blocsAvecGrilleIncomplete = blocsQuestionnaire
    .map((bloc) => ({ bloc, questionsIncompletes: blocGrilleIncomplete(bloc) }))
    .filter(({ questionsIncompletes }) => questionsIncompletes.length > 0);
  const grilleQcuIncomplete = blocsAvecGrilleIncomplete.length > 0;

  return (
    // Fragment plutôt qu'un <form> unique englobant tout : NotesDossier rend lui-même un <form>
    // pour l'ajout d'une note (voir son en-tête de fichier) — un <form> imbriqué dans un autre
    // n'est pas valide en HTML, il doit rester un frère du <form> d'évaluation, pas un enfant.
    <>
      <form className="grille-evaluation" onSubmit={gererEnvoi}>
        <h2>
          Évaluation — {rendezvous.candidat_prenom} {rendezvous.candidat_nom}
        </h2>

        {/* Aide-mémoire de l'inspecteur (avant/après test) — informative, jamais bloquante ni
            envoyée avec l'évaluation (voir ChecklistInspection.jsx). Remontée ici, juste sous le
            titre et avant la grille/le formulaire de verdict (demande explicite), plutôt que
            laissée en bas de page comme au départ. Pas de <form> imbriqué : ChecklistInspection
            ne rend elle-même aucun <form> (contrairement à NotesDossier plus bas, resté un frère
            du <form> pour cette raison), donc rien n'empêche de l'imbriquer directement ici. */}
        {estInspecteur && <ChecklistInspection />}

        {blocsQuestionnaire.map((bloc, indexBloc) => (
          <section key={cleBloc(bloc.posteCode)} className="grille-evaluation__bloc-poste">
            {/* Titre de bloc affiché seulement si plusieurs postes sont empilés : pour le cas
                courant (un seul poste, ou repli générique bureau), aucun changement visuel par
                rapport à l'écran mono-poste d'origine. */}
            {plusieursBlocs && <h3 className="grille-evaluation__bloc-poste-titre">{libellePoste(bloc.posteCode)}</h3>}

            {bloc.questions.length === 0 && (
              <p className="grille-evaluation__vide">Aucune question configurée pour ce questionnaire.</p>
            )}

            {bloc.questions.map((question) => (
              <fieldset key={question.code} className="grille-evaluation__question">
                <legend>
                  {question.libelle}
                  {question.obligatoire && <span className="champ-obligatoire"> *</span>}
                </legend>

                {question.type_question === 'grille_qcu' &&
                  question.items.map((item) => (
                    <fieldset key={item.code} className="grille-evaluation__critere">
                      <legend>{item.libelle}</legend>
                      <div className="grille-evaluation__choix">
                        {(estInspecteur ? NIVEAUX_BUREAU : ACQUIS).map((v) => (
                          <label key={v.code}>
                            <input
                              type="radio"
                              // Nom d'input préfixé par le bloc (cleBloc) : deux postes différents
                              // peuvent réutiliser le même questionCode/itemCode (questions_evaluation
                              // n'est unique que par questionnaire côté back, migration 037) — sans ce
                              // préfixe, deux radios de blocs distincts partageraient le même `name`
                              // et le navigateur les grouperait à tort comme mutuellement exclusifs.
                              name={`${cleBloc(bloc.posteCode)}-${question.code}-${item.code}-${v.code}`}
                              checked={bloc.reponses[cleReponse(question.code, item.code)] === v.code}
                              onChange={() => gererChangementReponse(indexBloc, cleReponse(question.code, item.code), v.code)}
                            />
                            {v.libelle}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ))}

                {question.type_question === 'choix_multiple' && (
                  <div className="grille-evaluation__choix">
                    {question.items.map((item) => (
                      <label key={item.code}>
                        <input
                          type="checkbox"
                          checked={bloc.reponses[cleReponse(question.code, item.code)] === 'coche'}
                          onChange={(evenement) =>
                            gererChangementReponse(
                              indexBloc,
                              cleReponse(question.code, item.code),
                              evenement.target.checked ? 'coche' : 'non_coche',
                            )
                          }
                        />
                        {item.libelle}
                      </label>
                    ))}
                  </div>
                )}

                {question.type_question === 'texte_libre' && (
                  <textarea
                    rows={2}
                    value={bloc.reponses[cleReponse(question.code)] ?? ''}
                    onChange={(evenement) => gererChangementReponse(indexBloc, cleReponse(question.code), evenement.target.value)}
                    required={question.obligatoire}
                  />
                )}
              </fieldset>
            ))}
          </section>
        ))}

        <fieldset className="grille-evaluation__resultat-global">
          <legend>
            Résultat du test <span className="champ-obligatoire">*</span>
          </legend>
          <div className="grille-evaluation__choix">
            <label>
              <input
                type="radio"
                name="resultat-global-valide"
                checked={resultatGlobal === 'valide'}
                onChange={() => gererChangementResultat('valide')}
              />
              Validé
            </label>
            <label>
              <input
                type="radio"
                name="resultat-global-invalide"
                checked={resultatGlobal === 'invalide'}
                onChange={() => gererChangementResultat('invalide')}
              />
              Invalidé
            </label>
          </div>
        </fieldset>

        {orientationVisible && (
          <fieldset className="grille-evaluation__orientation">
            <legend>
              Orientation <span className="champ-obligatoire">*</span>
            </legend>
            <div className="grille-evaluation__choix">
              {ORIENTATIONS.map((o) => (
                <label key={o.code}>
                  <input
                    type="radio"
                    name={`orientation-${o.code}`}
                    checked={orientation === o.code}
                    onChange={() => setOrientation(o.code)}
                  />
                  {o.libelle}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <label className="grille-evaluation__commentaire">
          <span>Commentaire (obligatoire)</span>
          <textarea value={commentaire} onChange={(evenement) => setCommentaire(evenement.target.value)} rows={3} required />
        </label>

        {!resultatGlobal && <p role="alert">Choisissez un résultat du test (Validé ou Invalidé) avant de soumettre.</p>}

        {grilleQcuIncomplete && (
          <p role="alert">
            Répondez à toutes les questions de la grille avant de soumettre :{' '}
            {blocsAvecGrilleIncomplete
              .map(({ bloc, questionsIncompletes }) => {
                const libellesQuestions = questionsIncompletes.map((question) => question.libelle).join(', ');
                return plusieursBlocs ? `${libellePoste(bloc.posteCode)} — ${libellesQuestions}` : libellesQuestions;
              })
              .join(' ; ')}
            .
          </p>
        )}

        {erreurEnvoi && <p role="alert">{erreurEnvoi}</p>}

        <div className="grille-evaluation__actions">
          <button type="button" onClick={onAnnuler} disabled={envoiEnCours}>
            Annuler
          </button>
          <button
            type="submit"
            disabled={
              envoiEnCours ||
              !resultatGlobal ||
              !commentaire.trim() ||
              blocsQuestionnaire.every((bloc) => bloc.questions.length === 0) ||
              (orientationVisible && !orientation) ||
              grilleQcuIncomplete ||
              texteLibreIncomplet
            }
          >
            {envoiEnCours ? 'Enregistrement...' : "Enregistrer l'évaluation"}
          </button>
        </div>
      </form>

      <NotesDossier dossierId={rendezvous.dossier_id} />
    </>
  );
}
