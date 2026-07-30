import { useEffect, useState } from 'react';
import { obtenirQuestionnaire, enregistrerEvaluation } from '../../services/evaluationService';
import './GrilleEvaluation.css';

// Échelle de notation d'une question 'grille_qcu' (voir backend evaluationEngine.js,
// ACQUIS_AUTORISEES) — pas une donnée de configuration par entité comme les questions
// elles-mêmes : c'est la forme même de ce type de question, pas un vocabulaire métier.
const ACQUIS = [
  { code: 'acquis', libelle: 'Acquis' },
  { code: 'non_acquis', libelle: 'Non acquis' },
  { code: 'a_ameliorer', libelle: 'A améliorer' },
];

// Libellés des postes hôtel pour le sélecteur affiché quand un dossier a coché plusieurs postes
// (voir postesAmbigus plus bas) — mêmes codes/libellés que BlocDisponibilites.jsx (POSTES_HOTEL),
// dupliqués ici plutôt que partagés : quelques lignes de données, même choix déjà fait pour
// VARIANTE_PAR_CODE_ACCECIT (TableauDeBordAccueil.jsx/Backoffice.jsx).
const POSTE_HOTEL_LIBELLES = {
  femme_valet_chambre: 'Femme/Valet de chambre',
  cafetier: 'Cafétier(ère)',
  equipier: 'Équipier(ère)',
  gouvernant: 'Gouvernant(e)',
};

// Orientation du candidat en cas de verdict positif (workflow v3, voir backend evaluationEngine.js,
// ORIENTATIONS_AUTORISEES) — sans objet si le résultat global est "Invalidé", jamais affichée
// dans ce cas (voir orientationVisible plus bas).
const ORIENTATIONS = [
  { code: 'envoi_formation', libelle: 'Envoi en formation' },
  { code: 'pret_embauche', libelle: "Prêt à l'embauche" },
];

// Clé interne d'une réponse, unique par (question, item) — item absent pour une question
// 'texte_libre' (une seule réponse par question, pas par item), voir clesReponses plus bas.
function cleReponse(questionCode, itemCode) {
  return `${questionCode}:${itemCode ?? ''}`;
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

// Grille d'évaluation dynamique selon le poste réellement recherché par le candidat (voir
// Modularité, CLAUDE.md) : ne connaît aucune question en dur — charge le questionnaire résolu
// côté serveur pour ce poste (GET /api/evaluations/questionnaire, repli générique si le poste n'a
// pas de questionnaire dédié) et construit son rendu selon le type de chaque question
// (grille_qcu / choix_multiple / texte_libre), comme FormulaireInscription compose ses blocs
// actifs plutôt que de les connaître.
//
// rendezvous reçu en prop ({ id, dossier_id, candidat_prenom, candidat_nom, postesBureau,
// postesHotel }, voir ListeEvaluationsAFaire.jsx / backend evaluationEngine.listerRendezvousAEvaluer)
// — ce composant ne connaît pas le routage, même patron que CaptureTablette.jsx.
export default function GrilleEvaluation({ rendezvous, onTermine, onAnnuler }) {
  // Plusieurs postes hôtel cochés sur un même dossier : le formulaire d'inscription le permet
  // (case à cocher indépendante par poste, voir BlocDisponibilites.jsx) — sans façon fiable de
  // deviner lequel des questionnaires dédiés s'applique, c'est le formateur qui choisit avant de
  // charger la grille (décision actée avec la responsable de projet), plutôt qu'une hypothèse
  // fausse sur l'intention du candidat.
  const postesHotel = rendezvous.postesHotel ?? [];
  const postesAmbigus = postesHotel.length > 1;
  const posteResolutionAutomatique = postesHotel.length === 1 ? postesHotel[0] : undefined;

  const [posteChoisi, setPosteChoisi] = useState('');
  const posteCode = postesAmbigus ? posteChoisi || undefined : posteResolutionAutomatique;

  const [questions, setQuestions] = useState(null);
  const [chargement, setChargement] = useState(!postesAmbigus);
  const [erreur, setErreur] = useState(null);

  const [reponses, setReponses] = useState({});
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

  const orientationVisible = resultatGlobal === 'valide';

  const gererChangementResultat = (valeur) => {
    setResultatGlobal(valeur);
    if (valeur !== 'valide') setOrientation('');
  };

  // Ne se déclenche qu'une fois le poste connu : soit immédiatement (un seul poste hôtel, ou
  // aucun — repli générique), soit après le choix du formateur (postesAmbigus).
  useEffect(() => {
    if (postesAmbigus && !posteCode) return undefined;

    let annule = false;
    setChargement(true);
    setErreur(null);
    obtenirQuestionnaire({ rendezvousId: rendezvous.id, posteCode })
      .then((valeur) => {
        if (annule) return;
        setQuestions(valeur);
        setReponses(valeursParDefaut(valeur));
      })
      .catch((erreur) => {
        if (!annule) setErreur(erreur.response?.data?.erreur ?? 'Impossible de récupérer le questionnaire.');
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, [rendezvous.id, posteCode]);

  const gererEnvoi = async (evenement) => {
    evenement.preventDefault();
    if (!resultatGlobal) return;
    if (!commentaire.trim()) return;
    if (orientationVisible && !orientation) return;
    if (
      questions.some(
        (question) =>
          question.type_question === 'grille_qcu' &&
          question.items.some((item) => !reponses[cleReponse(question.code, item.code)]),
      )
    ) {
      return;
    }
    if (
      questions.some(
        (question) =>
          question.type_question === 'texte_libre' && question.obligatoire && !reponses[cleReponse(question.code)]?.trim(),
      )
    ) {
      return;
    }

    setEnvoiEnCours(true);
    setErreurEnvoi(null);

    const reponsesEnvoyees = questions.flatMap((question) => {
      if (question.type_question === 'texte_libre') {
        return [{ questionCode: question.code, valeur: reponses[cleReponse(question.code)] }];
      }
      return question.items.map((item) => ({
        questionCode: question.code,
        questionItemCode: item.code,
        valeur: reponses[cleReponse(question.code, item.code)],
      }));
    });

    try {
      // Le serveur fait avancer le statut du dossier dans la même transaction que l'enregistrement
      // de l'évaluation (voir backend evaluationEngine.enregistrerEvaluation) — pas de second appel
      // front à part pour la transition, workflow v3.
      await enregistrerEvaluation({
        rendezvousId: rendezvous.id,
        resultatGlobal,
        orientation: orientationVisible ? orientation : undefined,
        posteCode,
        commentaire,
        reponses: reponsesEnvoyees,
      });
    } catch (erreur) {
      setEnvoiEnCours(false);
      setErreurEnvoi(
        erreur.response
          ? (erreur.response.data?.erreur ?? "Le serveur n'a pas pu enregistrer l'évaluation. Merci de réessayer.")
          : 'Connexion au serveur impossible. Vérifiez le réseau et réessayez.',
      );
      return;
    }

    setEnvoiEnCours(false);
    onTermine();
  };

  if (postesAmbigus && !posteCode) {
    return (
      <div className="grille-evaluation">
        <h2>
          Évaluation — {rendezvous.candidat_prenom} {rendezvous.candidat_nom}
        </h2>
        <p>
          Plusieurs postes ont été demandés par ce candidat — choisissez celui sur lequel porte cette évaluation :
        </p>
        <div className="grille-evaluation__choix">
          {postesHotel.map((code) => (
            <button key={code} type="button" onClick={() => setPosteChoisi(code)}>
              {POSTE_HOTEL_LIBELLES[code] ?? code}
            </button>
          ))}
        </div>
        <div className="grille-evaluation__actions">
          <button type="button" onClick={onAnnuler}>
            Annuler
          </button>
        </div>
      </div>
    );
  }

  if (erreur) {
    return <p role="alert">{erreur}</p>;
  }
  // Vérifie `questions` (pas seulement `chargement`) : juste après le choix du poste dans le
  // sélecteur ci-dessus, un rendu intermédiaire est possible avant que l'effet n'ait eu le temps
  // de repasser `chargement` à true (posteCode change, mais l'effet ne s'exécute qu'après ce
  // rendu) — sans cette garde, le formulaire plus bas accéderait à `questions` encore `null`.
  if (chargement || !questions) {
    return <p>Chargement de la grille…</p>;
  }

  // Un texte_libre obligatoire vide bloque déjà la soumission via l'attribut `required` natif du
  // textarea (même principe que le champ Commentaire), revérifié ici pour désactiver le bouton en
  // amont plutôt que de dépendre uniquement de la validation native du navigateur.
  const texteLibreIncomplet = questions.some(
    (question) =>
      question.type_question === 'texte_libre' && question.obligatoire && !reponses[cleReponse(question.code)]?.trim(),
  );

  // Une question grille_qcu n'a pas d'état "répondu mais vide" légitime (contrairement à
  // texte_libre) : les 3 valeurs de l'échelle ACQUIS sont toutes des jugements réels, aucune ne
  // représente "pas encore répondu" — chaque item doit donc recevoir une réponse avant soumission,
  // quel que soit question.obligatoire (qui ne pilote que l'affichage de l'astérisque ci-dessous).
  // Le back revaliderait de toute façon : ACQUIS_AUTORISEES (evaluationEngine.js) ne contient
  // aucune valeur "non répondu", un item resté vide serait rejeté avec un message générique à
  // l'enregistrement — ce contrôle évite juste à l'agent de le découvrir seulement à l'envoi.
  const questionsGrilleIncompletes = questions.filter(
    (question) =>
      question.type_question === 'grille_qcu' &&
      question.items.some((item) => !reponses[cleReponse(question.code, item.code)]),
  );
  const grilleQcuIncomplete = questionsGrilleIncompletes.length > 0;

  return (
    <form className="grille-evaluation" onSubmit={gererEnvoi}>
      <h2>
        Évaluation — {rendezvous.candidat_prenom} {rendezvous.candidat_nom}
      </h2>

      {questions.length === 0 && (
        <p className="grille-evaluation__vide">Aucune question configurée pour ce questionnaire.</p>
      )}

      {questions.map((question) => (
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
                  {ACQUIS.map((v) => (
                    <label key={v.code}>
                      <input
                        type="radio"
                        name={`${question.code}-${item.code}-${v.code}`}
                        checked={reponses[cleReponse(question.code, item.code)] === v.code}
                        onChange={() =>
                          setReponses((precedent) => ({ ...precedent, [cleReponse(question.code, item.code)]: v.code }))
                        }
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
                    checked={reponses[cleReponse(question.code, item.code)] === 'coche'}
                    onChange={(evenement) =>
                      setReponses((precedent) => ({
                        ...precedent,
                        [cleReponse(question.code, item.code)]: evenement.target.checked ? 'coche' : 'non_coche',
                      }))
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
              value={reponses[cleReponse(question.code)] ?? ''}
              onChange={(evenement) =>
                setReponses((precedent) => ({ ...precedent, [cleReponse(question.code)]: evenement.target.value }))
              }
              required={question.obligatoire}
            />
          )}
        </fieldset>
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
          {questionsGrilleIncompletes.map((question) => question.libelle).join(', ')}.
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
            questions.length === 0 ||
            (orientationVisible && !orientation) ||
            grilleQcuIncomplete ||
            texteLibreIncomplet
          }
        >
          {envoiEnCours ? 'Enregistrement...' : "Enregistrer l'évaluation"}
        </button>
      </div>
    </form>
  );
}
