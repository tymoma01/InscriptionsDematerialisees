import { useEffect, useState } from 'react';
import { listerFormateurs } from '../../services/formateurService';
import { listerLieux } from '../../services/lieuService';
import { listerRendezvous, creerRendezvousAvecTransitions } from '../../services/rendezvousService';
import { dateDuJourParis } from './dateDuJourParis';
import './ModaleReplanificationGroupee.css';

const HEURES_DISPONIBLES = Array.from({ length: 24 }, (_, heure) => String(heure).padStart(2, '0'));
const MINUTES_DISPONIBLES = ['00', '15', '30', '45'];

const FORMAT_DATE_HEURE = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

// Même codeAction que le bouton "Replanifier" individuel (Tests.jsx, ModalePlanificationTest.jsx)
// — le moteur de transitions (workflowEngine.appliquerTransition) résout lui-même la bonne ligne
// transitions_statut à partir du statut RÉEL de chaque dossier, jamais choisi ici (voir Modularité,
// CLAUDE.md) : un dossier sélectionné qui ne serait plus dans un statut replanifiable au moment de
// la soumission échoue simplement sur SA ligne (voir soumettre plus bas), sans bloquer les autres.
const CODE_ACTION_REPLANIFIER_TEST = 'replanifier_test';

function pad(nombre) {
  return String(nombre).padStart(2, '0');
}

// Date locale (fuseau du navigateur, supposé Europe/Paris — même hypothèse que le reste de ce
// module, voir ModalePlanificationTest.jsx) au format 'AAAA-MM-JJ' attendu par <input type="date">.
function dateInputLocale(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Arrondit à la minute disponible la plus proche parmi MINUTES_DISPONIBLES (pas de contrôle
// natif pour les minutes, voir ModalePlanificationTest.jsx) — un rendez-vous existant créé hors
// de ce pas de 15 minutes (ex. migration de données) retombe sur la valeur la plus proche plutôt
// que de ne rien présélectionner du tout.
function minuteDisponiblePlusProche(minute) {
  return MINUTES_DISPONIBLES.reduce((plusProche, valeur) =>
    Math.abs(Number(valeur) - minute) < Math.abs(Number(plusProche) - minute) ? valeur : plusProche,
  );
}

// Construit la ligne de formulaire initiale d'un dossier — préremplie depuis son dernier
// rendez-vous connu (voir listerRendezvous, déjà trié actif-puis-plus-récent côté back, voir
// rendezvousRepository.listerRendezvousParDossier) quand il existe, sinon laissée vide (l'agent
// saisit manuellement, comme une planification initiale). Contrairement au formulaire individuel
// (ModalePlanificationTest.jsx), qui ne préremplit QUE la note depuis le rendez-vous actif : ici
// poste/formateur/date-heure sont aussi préremplis (demande explicite), utile en masse pour ne
// pas ressaisir depuis zéro chaque candidat déjà passé par un premier rendez-vous.
function construireLigneInitiale(dossier, rendezvousDuDossier, formateursDisponibles) {
  const postesDisponibles = [...(dossier.postesBureau ?? []), ...(dossier.postesHotel ?? [])];
  // Premier rendez-vous de type 'test' de la liste = le plus pertinent (actif en premier, sinon le
  // plus récemment planifié — voir le tri du back, identique à GestionRendezvous.jsx
  // dernierSeulement).
  const dernier = rendezvousDuDossier.find((rdv) => rdv.type_rdv === 'test') ?? null;

  const groupePardefaut = postesBureauSeuls(dossier) ? 'inspecteur' : 'formateur';
  let formateurId = '';
  if (dernier?.formateur_id && formateursDisponibles.some((f) => f.id === dernier.formateur_id)) {
    formateurId = String(dernier.formateur_id);
  } else {
    const duGroupe = formateursDisponibles.filter((f) => f.role_code === groupePardefaut);
    if (duGroupe.length > 0) formateurId = String(duGroupe[0].id);
  }

  let dateTest = '';
  let heureTest = '';
  let minuteTest = '';
  if (dernier?.date_heure) {
    const date = new Date(dernier.date_heure);
    dateTest = dateInputLocale(date);
    heureTest = pad(date.getHours());
    minuteTest = minuteDisponiblePlusProche(date.getMinutes());
  }

  const postesRendezvous = Array.isArray(dernier?.postes_selectionnes) ? dernier.postes_selectionnes : [];
  const postesCoches = new Set(postesRendezvous.length > 0 ? postesRendezvous : postesDisponibles);

  return {
    dossierId: dossier.id,
    postesDisponibles,
    formateurId,
    lieuId: dernier?.lieu_id ? String(dernier.lieu_id) : '',
    dateTest,
    heureTest,
    minuteTest,
    postesCoches,
    notePlanification: dernier?.note_planification ?? '',
    // État de soumission propre à cette ligne (voir soumettre) — null tant que le formulaire n'a
    // jamais été validé, 'en_cours'/'succes'/'echec' ensuite.
    statutEnvoi: null,
    erreurEnvoi: null,
  };
}

function postesBureauSeuls(dossier) {
  return (dossier.postesBureau ?? []).length > 0 && (dossier.postesHotel ?? []).length === 0;
}

// Modale de replanification groupée (barre d'actions groupées, "Dossiers candidats", audit
// 2026-08-24) — une ligne de formulaire par dossier sélectionné, mêmes champs que le formulaire
// individuel (ModalePlanificationTest.jsx : poste, formateur, date/heure, note), sans son
// calendrier de disponibilité ni sa gestion de lieu à la volée (création/édition/suppression) :
// hors de propos ici, où l'agent traite plusieurs candidats à la fois plutôt qu'un seul avec tout
// le temps d'ajuster un lieu précis. Le lieu reste un champ obligatoire (comme côté back, voir
// creationRendezvousSchema) via un simple sélecteur sur les lieux déjà configurés.
//
// Un seul bouton de validation soumet TOUTES les lignes, chacune comme un appel indépendant à
// creerRendezvousAvecTransitions (même endpoint que la replanification individuelle,
// neutraliserRendezvousActifsDossier inclus côté back, voir rendezvousService.js) — l'échec d'une
// ligne (ex. créneau déjà pris, dossier plus dans un statut replanifiable) n'empêche jamais les
// autres de s'enregistrer, voir soumettre.
export default function ModaleReplanificationGroupee({ dossiers, dossiersExclus = [], libellePoste, onFermer, onTermine }) {
  const [formateurs, setFormateurs] = useState([]);
  const [lieux, setLieux] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreurChargement, setErreurChargement] = useState(null);
  const [lignes, setLignes] = useState([]);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);

  // dossiers figé pour toute la durée d'ouverture de la modale (voir TableauDeBordAccueil.jsx,
  // remontée à chaque nouvelle ouverture via key) — chargé une seule fois au montage. dossiers
  // déjà filtré par l'appelant (dossiersEligiblesReplanification, TableauDeBordAccueil.jsx) : ce
  // composant ne connaît lui-même aucun code de statut (voir Modularité, CLAUDE.md). dossiers vide
  // (sélection entièrement exclue) : aucun besoin d'aller chercher formateurs/lieux pour ne rien
  // planifier.
  useEffect(() => {
    if (dossiers.length === 0) {
      setChargement(false);
      return undefined;
    }
    let annule = false;
    Promise.all([listerFormateurs(), listerLieux(), Promise.all(dossiers.map((dossier) => listerRendezvous(dossier.id).catch(() => [])))])
      .then(([formateursValeur, lieuxValeur, rendezvousParDossier]) => {
        if (annule) return;
        setFormateurs(formateursValeur);
        setLieux(lieuxValeur);
        setLignes(
          dossiers.map((dossier, index) => construireLigneInitiale(dossier, rendezvousParDossier[index], formateursValeur)),
        );
      })
      .catch((erreur) => {
        if (!annule) {
          setErreurChargement(
            erreur.response?.data?.erreur ?? 'Impossible de récupérer les formateurs/lieux nécessaires à la replanification.',
          );
        }
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const modifierLigne = (dossierId, champs) => {
    setLignes((precedent) => precedent.map((ligne) => (ligne.dossierId === dossierId ? { ...ligne, ...champs } : ligne)));
  };

  const togglerPoste = (dossierId, code) => {
    setLignes((precedent) =>
      precedent.map((ligne) => {
        if (ligne.dossierId !== dossierId) return ligne;
        const suivant = new Set(ligne.postesCoches);
        if (suivant.has(code)) suivant.delete(code);
        else suivant.add(code);
        return { ...ligne, postesCoches: suivant };
      }),
    );
  };

  const ligneValide = (ligne) => ligne.dateTest && ligne.heureTest && ligne.minuteTest && ligne.formateurId && ligne.lieuId;
  const toutesLignesValides = lignes.length > 0 && lignes.every(ligneValide);

  // Séquentiel (pas Promise.all) : chaque ligne met à jour son propre statutEnvoi au fur et à
  // mesure (voir le rendu, spinner/coche par ligne) plutôt que tout basculer d'un coup à la fin —
  // et évite de soumettre en rafale N créations de rendez-vous simultanées vers le même
  // formateur/créneau si plusieurs lignes le partagent.
  const soumettre = async (evenement) => {
    evenement.preventDefault();
    if (envoiEnCours || !toutesLignesValides) return;
    setEnvoiEnCours(true);

    for (const ligne of lignes) {
      // Une ligne déjà réussie (nouvelle tentative après un échec partiel, voir le résumé
      // affiché) n'est jamais rejouée : la replanification a déjà eu lieu côté back pour ce
      // dossier, la relancer créerait un second rendez-vous en double.
      if (ligne.statutEnvoi === 'succes') continue;
      modifierLigne(ligne.dossierId, { statutEnvoi: 'en_cours', erreurEnvoi: null });
      const formateurChoisi = formateurs.find((f) => String(f.id) === ligne.formateurId);
      const dateHeureIso = new Date(`${ligne.dateTest}T${ligne.heureTest}:${ligne.minuteTest}`).toISOString();
      try {
        // eslint-disable-next-line no-await-in-loop
        await creerRendezvousAvecTransitions(ligne.dossierId, {
          typeRdv: 'test',
          dateHeure: dateHeureIso,
          formateurId: Number(ligne.formateurId),
          lieuId: Number(ligne.lieuId),
          postesSelectionnes: [...ligne.postesCoches],
          notePlanification: ligne.notePlanification.trim() || undefined,
          transitions: [
            {
              codeAction: CODE_ACTION_REPLANIFIER_TEST,
              commentaire: `Test replanifié (action groupée) le ${FORMAT_DATE_HEURE.format(new Date(dateHeureIso))} avec ${formateurChoisi?.prenom ?? ''} ${formateurChoisi?.nom ?? ''}.`,
            },
          ],
        });
        modifierLigne(ligne.dossierId, { statutEnvoi: 'succes' });
      } catch (erreur) {
        modifierLigne(ligne.dossierId, {
          statutEnvoi: 'echec',
          erreurEnvoi: erreur.response
            ? (erreur.response.data?.erreur ?? "Le serveur n'a pas pu enregistrer cette replanification.")
            : 'Connexion au serveur impossible.',
        });
      }
    }

    setEnvoiEnCours(false);
  };

  const nombreReussites = lignes.filter((ligne) => ligne.statutEnvoi === 'succes').length;
  const soumissionTerminee = !envoiEnCours && lignes.length > 0 && lignes.every((ligne) => ligne.statutEnvoi === 'succes' || ligne.statutEnvoi === 'echec');
  const toutReussi = soumissionTerminee && nombreReussites === lignes.length;

  return (
    <div className="modale-replanification-groupee__fond">
      <div className="modale-replanification-groupee" role="dialog" aria-label="Replanifier des tests">
        <div className="modale-replanification-groupee__entete">
          <h2>
            Replanifier des tests <span>({dossiers.length} candidat{dossiers.length > 1 ? 's' : ''} éligible{dossiers.length > 1 ? 's' : ''})</span>
          </h2>
          <button type="button" onClick={onFermer} disabled={envoiEnCours}>
            Fermer
          </button>
        </div>

        {/* Dossiers écartés de la sélection initiale (statut courant hors STATUTS_REPLANIFIABLES_
            ACCECIT, voir TableauDeBordAccueil.jsx) — affiché avant le formulaire, que dossiers soit
            vide ou non : l'agent doit voir pourquoi la liste ci-dessous est plus courte que sa
            sélection de départ. */}
        {dossiersExclus.length > 0 && (
          <div className="modale-replanification-groupee__exclusion" role="status">
            <p>
              {dossiersExclus.length} dossier{dossiersExclus.length > 1 ? 's' : ''} exclu{dossiersExclus.length > 1 ? 's' : ''} de la
              replanification, aucun test planifié pour ce candidat.
            </p>
            <details>
              <summary>Voir le détail</summary>
              <ul>
                {dossiersExclus.map((dossier) => (
                  <li key={dossier.id}>
                    N°{dossier.id} - {dossier.candidat_nom} {dossier.candidat_prenom} ({dossier.statut_libelle})
                  </li>
                ))}
              </ul>
            </details>
          </div>
        )}

        {!chargement && !erreurChargement && dossiers.length === 0 && (
          <p role="alert">Aucun dossier sélectionné n&rsquo;est éligible à la replanification.</p>
        )}

        {chargement && dossiers.length > 0 && <p>Chargement des formateurs et lieux…</p>}
        {erreurChargement && <p role="alert">{erreurChargement}</p>}

        {!chargement && !erreurChargement && dossiers.length > 0 && (
          <form className="modale-replanification-groupee__formulaire" onSubmit={soumettre}>
            <ul className="modale-replanification-groupee__lignes">
              {lignes.map((ligne) => {
                const dossier = dossiers.find((d) => d.id === ligne.dossierId);
                return (
                  <li key={ligne.dossierId} className="modale-replanification-groupee__ligne">
                    <div className="modale-replanification-groupee__ligne-entete">
                      <span className="modale-replanification-groupee__ligne-titre">
                        N°{dossier.id} - {dossier.candidat_nom} {dossier.candidat_prenom}
                      </span>
                      {ligne.statutEnvoi === 'en_cours' && <span role="status">Enregistrement…</span>}
                      {ligne.statutEnvoi === 'succes' && (
                        <span role="status" className="modale-replanification-groupee__succes">
                          ✔ Replanifié
                        </span>
                      )}
                      {ligne.statutEnvoi === 'echec' && (
                        <span role="alert" className="modale-replanification-groupee__echec">
                          ✘ Échec
                        </span>
                      )}
                    </div>

                    {ligne.erreurEnvoi && <p role="alert">{ligne.erreurEnvoi}</p>}

                    <div className="modale-replanification-groupee__champs">
                      <label>
                        <span>
                          Formateur / Inspecteur <span className="champ-obligatoire">*</span>
                        </span>
                        <select
                          value={ligne.formateurId}
                          onChange={(evenement) => modifierLigne(ligne.dossierId, { formateurId: evenement.target.value })}
                          disabled={envoiEnCours}
                          required
                        >
                          <option value="">-</option>
                          {formateurs.map((formateur) => (
                            <option key={formateur.id} value={formateur.id}>
                              {formateur.prenom} {formateur.nom} ({formateur.role_code === 'inspecteur' ? 'Inspecteur' : 'Formateur'})
                            </option>
                          ))}
                        </select>
                      </label>

                      <label>
                        <span>
                          Date <span className="champ-obligatoire">*</span>
                        </span>
                        <input
                          type="date"
                          value={ligne.dateTest}
                          min={dateDuJourParis()}
                          onChange={(evenement) => modifierLigne(ligne.dossierId, { dateTest: evenement.target.value })}
                          disabled={envoiEnCours}
                          required
                        />
                      </label>

                      <label>
                        <span>
                          Heure <span className="champ-obligatoire">*</span>
                        </span>
                        <div className="modale-replanification-groupee__heure">
                          <select
                            aria-label="Heure"
                            value={ligne.heureTest}
                            onChange={(evenement) => modifierLigne(ligne.dossierId, { heureTest: evenement.target.value })}
                            disabled={envoiEnCours}
                            required
                          >
                            <option value="">--</option>
                            {HEURES_DISPONIBLES.map((heure) => (
                              <option key={heure} value={heure}>
                                {heure}
                              </option>
                            ))}
                          </select>
                          <span aria-hidden="true">:</span>
                          <select
                            aria-label="Minutes"
                            value={ligne.minuteTest}
                            onChange={(evenement) => modifierLigne(ligne.dossierId, { minuteTest: evenement.target.value })}
                            disabled={envoiEnCours}
                            required
                          >
                            <option value="">--</option>
                            {MINUTES_DISPONIBLES.map((minute) => (
                              <option key={minute} value={minute}>
                                {minute}
                              </option>
                            ))}
                          </select>
                        </div>
                      </label>

                      <label>
                        <span>
                          Lieu <span className="champ-obligatoire">*</span>
                        </span>
                        <select
                          value={ligne.lieuId}
                          onChange={(evenement) => modifierLigne(ligne.dossierId, { lieuId: evenement.target.value })}
                          disabled={envoiEnCours}
                          required
                        >
                          <option value="">-</option>
                          {lieux.map((lieu) => (
                            <option key={lieu.id} value={lieu.id}>
                              {lieu.adresse}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    {ligne.postesDisponibles.length > 1 && (
                      <fieldset className="modale-replanification-groupee__postes">
                        <legend>Poste(s) testé(s)</legend>
                        {ligne.postesDisponibles.map((code) => (
                          <label key={code}>
                            <input
                              type="checkbox"
                              checked={ligne.postesCoches.has(code)}
                              onChange={() => togglerPoste(ligne.dossierId, code)}
                              disabled={envoiEnCours}
                            />
                            {libellePoste ? libellePoste(code) : code}
                          </label>
                        ))}
                      </fieldset>
                    )}

                    <label className="modale-replanification-groupee__note">
                      <span>Note pour le formateur/inspecteur (optionnel)</span>
                      <textarea
                        value={ligne.notePlanification}
                        onChange={(evenement) => modifierLigne(ligne.dossierId, { notePlanification: evenement.target.value })}
                        rows={2}
                        maxLength={2000}
                        disabled={envoiEnCours}
                      />
                    </label>
                  </li>
                );
              })}
            </ul>

            {lieux.length === 0 && <p role="alert">Aucun lieu configuré pour cette entité — impossible de replanifier.</p>}
            {formateurs.length === 0 && <p role="alert">Aucun formateur ni inspecteur disponible pour cette entité.</p>}

            {soumissionTerminee && (
              <p role="status" className={toutReussi ? 'modale-replanification-groupee__resume-succes' : 'modale-replanification-groupee__resume-echec'}>
                {nombreReussites} / {lignes.length} replanification(s) enregistrée(s).
                {!toutReussi && ' Corrigez les lignes en échec puis validez de nouveau — les lignes déjà réussies ne seront pas repassées.'}
              </p>
            )}

            <div className="modale-replanification-groupee__actions">
              <button type="button" onClick={onFermer} disabled={envoiEnCours}>
                {toutReussi ? 'Fermer' : 'Annuler'}
              </button>
              {!toutReussi && (
                <button type="submit" disabled={envoiEnCours || !toutesLignesValides || lieux.length === 0 || formateurs.length === 0}>
                  {envoiEnCours ? 'Enregistrement...' : 'Confirmer les replanifications'}
                </button>
              )}
              {toutReussi && (
                <button type="button" onClick={onTermine}>
                  Terminé
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
