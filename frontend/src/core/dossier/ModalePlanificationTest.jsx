import { useEffect, useRef, useState } from 'react';
import { listerFormateurs } from '../../services/formateurService';
import { listerLieux } from '../../services/lieuService';
import { creerRendezvousAvecTransitions, listerRendezvousTest } from '../../services/rendezvousService';
import CalendrierDisponibiliteFormateur from '../pieceJustificative/CalendrierDisponibiliteFormateur';
import { dateDuJourParis } from './dateDuJourParis';
import './ModalePlanificationTest.css';

const FORMAT_DATE_HEURE = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

// L'input natif type="datetime-local" s'est révélé peu fiable au tactile pour sa partie
// heure/minute (segment difficile à cibler précisément) — remplacé par un input type="date"
// combiné à deux <select> classiques pour l'heure et les minutes : un select est un composant
// natif que l'agent peut ouvrir et faire défiler au doigt. Minutes par pas de 15 : granularité
// suffisante pour planifier un test, une liste des 60 valeurs serait inutilement longue à faire
// défiler sur tablette.
const HEURES_DISPONIBLES = Array.from({ length: 24 }, (_, heure) => String(heure).padStart(2, '0'));
const MINUTES_DISPONIBLES = ['00', '15', '30', '45'];

// Alignée sur CAPACITE_MAX_FORMATEUR_PAR_CRENEAU côté back (rendezvousService.js) : un formateur
// peut évaluer jusqu'à 2 candidats sur le même créneau exact, pas seulement 1.
const CAPACITE_MAX_FORMATEUR_PAR_CRENEAU = 2;

// Groupes du sélecteur de personne — mêmes codes que backend rbac.js (ROLES.FORMATEUR/
// ROLES.INSPECTEUR), littéraux en dur plutôt qu'une constante partagée (le projet n'exporte
// aujourd'hui aucun équivalent front de ROLES, même choix déjà fait par Connexion.jsx/
// BoutonNouvelleInscription.jsx pour leurs propres comparaisons de rôle).
const GROUPES_ROLE = [
  { code: 'formateur', libelle: 'Formateurs' },
  { code: 'inspecteur', libelle: 'Inspecteurs' },
];

// Panneau de planification d'un test : choix de la date/heure et du formateur, puis (1) création
// du rendez-vous, (2) avancement du statut du dossier via le moteur de transitions générique —
// une seule transaction côté back (voir rendezvousService.creerRendezvousAvecTransitions), pour
// que la création du rendez-vous et le changement de statut réussissent ou échouent ensemble
// (plus de rendez-vous "orphelin" possible, voir l'incident historique sur le dossier 62).
//
// Composant générique, extrait de CaptureTablette.jsx (première planification, depuis
// en_attente_pieces) pour être réutilisé par TableauDeBordAccueil.jsx (replanification, depuis
// test_non_realise ou invalide) : `codeAction` est reçu en prop plutôt que figé en
// constante interne — ce composant ne connaît aucun statut ni transition en dur (voir
// Modularité, CLAUDE.md), c'est à l'appelant de savoir depuis quelle action il ouvre ce panneau.
// Le moteur de transitions (workflowEngine.appliquerTransition) résout lui-même la bonne ligne
// transitions_statut à partir du statut courant réel du dossier : pas besoin ici de choisir entre
// plusieurs origines possibles pour un même codeAction (ex. "replanifier_test" existe en
// configuration à la fois depuis test_non_realise et invalide).
// postesBureau/postesHotel (Phase 1, informatif — voir evaluationEngine.resoudrePosteCode) : les
// postes déclarés au dossier (dossierService.obtenirDossier / listerDossiers), reçus en prop
// plutôt que résolus ici — ce composant ne fait aucun appel réseau pour les récupérer, comme
// dossierId/titre déjà transmis par l'appelant. libellePoste : même principe que le prop
// `varianteStatut` de DossierList.jsx — vocabulaire propre à ACCECIT (voir BlocDisponibilites.jsx),
// ce composant générique affiche le code brut si non fourni plutôt que d'échouer.
export default function ModalePlanificationTest({
  dossierId,
  codeAction,
  titre,
  postesBureau = [],
  postesHotel = [],
  libellePoste,
  onAnnuler,
  onReussite,
}) {
  const panneauRef = useRef(null);

  const [formateurs, setFormateurs] = useState([]);
  const [chargementFormateurs, setChargementFormateurs] = useState(true);
  const [erreurFormateurs, setErreurFormateurs] = useState(null);

  // Lieux de test configurés pour l'entité (table `lieux`, migration 044) — contrairement au
  // formateur, optionnel : un échec de chargement ou une liste vide ne doit pas empêcher de
  // planifier un test (voir plus bas, le formulaire entier n'est pas gated sur chargementLieux,
  // contrairement à chargementFormateurs).
  const [lieux, setLieux] = useState([]);
  const [chargementLieux, setChargementLieux] = useState(true);
  const [erreurLieux, setErreurLieux] = useState(null);
  const [lieuId, setLieuId] = useState('');

  // Ce panneau s'ouvre en bas de page (sous la liste de pièces ou la liste de dossiers selon
  // l'appelant, voir ModalePlanificationTest.css) : sans amener la vue jusqu'à lui, l'agent ne le
  // voit pas apparaître et doit défiler manuellement pour s'en apercevoir. `block: 'start'` cale
  // le haut du panneau (son titre) en haut de viewport plutôt que 'nearest'/'center', pour
  // toujours afficher l'en-tête même quand le panneau est plus haut que l'écran (tablette en
  // portrait) — cohérent quel que soit l'appelant, puisque géré ici une seule fois plutôt que
  // dupliqué dans CaptureTablette.jsx et TableauDeBordAccueil.jsx.
  //
  // Dépend de [dossierId, codeAction] plutôt que [] : sur TableauDeBordAccueil.jsx, le panneau
  // n'est pas démonté/remonté entre deux ouvertures si l'agent clique "Replanifier" sur un autre
  // dossier sans avoir fermé le panneau précédent (même position dans l'arbre React, seules les
  // props changent) — un tableau de dépendances vide ne réexécuterait alors le scroll qu'à la
  // toute première ouverture. En dépendant de l'identité de ce qui est planifié, l'effet se
  // redéclenche à chaque nouvelle cible, y compris sans démontage.
  //
  // `chargementFormateurs` est aussi une dépendance, et l'effet ne scrolle pas tant qu'il vaut
  // encore true : à l'ouverture initiale (avant que GET /formateurs ait répondu), le panneau
  // n'affiche que "Chargement des formateurs…", bien plus court qu'une fois le calendrier de
  // disponibilité affiché — scroller sur cette hauteur provisoire atterrit trop haut dans le
  // document (donc, une fois le panneau grandi, le titre se retrouve au-dessus du viewport et
  // l'agent voit le calendrier en premier). En attendant la fin du chargement, l'effet scrolle
  // sur la hauteur finale réelle du panneau. Lors d'un changement de dossier alors que les
  // formateurs sont déjà en cache (chargementFormateurs déjà à false, cas normal après la toute
  // première ouverture sur cette page), l'effet scrolle immédiatement comme avant.
  useEffect(() => {
    if (chargementFormateurs) return;
    panneauRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [dossierId, codeAction, chargementFormateurs]);

  const [dateTest, setDateTest] = useState('');
  const [heureTest, setHeureTest] = useState('');
  const [minuteTest, setMinuteTest] = useState('');
  // Groupe affiché avant le choix de la personne précise (voir GROUPES_ROLE ci-dessus) —
  // présélectionné selon le type de poste déclaré sur le dossier (Inspecteurs pour un dossier
  // bureau, Formateurs sinon/par défaut) plutôt que toujours le même groupe : évite à l'agent de
  // devoir cliquer "Inspecteurs" à chaque planification d'un test bureau.
  const [groupeRole, setGroupeRole] = useState(() => (postesBureau.length > 0 ? 'inspecteur' : 'formateur'));
  const [formateurId, setFormateurId] = useState('');
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [erreurEnvoi, setErreurEnvoi] = useState(null);

  // Créneaux du formateur sélectionné, pour le seul jour choisi (voir calendrier mensuel plus
  // bas pour la vue d'ensemble par mois) — sert uniquement au message d'alerte + désactivation du
  // bouton ci-dessous. Confort visuel seulement : compterRendezvousFormateurAuCreneau côté
  // serveur reste le garde-fou qui fait foi (409 ErreurCreneauPris à la création).
  const [creneauxJourSelectionne, setCreneauxJourSelectionne] = useState([]);

  // Postes déclarés du dossier, à plat (posteBureau et posteHotel ne sont jamais tous les deux
  // peuplés sur un même dossier, voir dossierService.js : typePoste est soit 'bureau' soit
  // 'hotel') — recalculé à chaque rendu plutôt que mémoïsé, tableau trop court pour que ça compte.
  const postesDisponibles = [...postesBureau, ...postesHotel];

  // Tous pré-cochés à l'ouverture (comportement demandé) — Set plutôt qu'un tableau, pratique
  // pour cocher/décocher sans reconstruire toute la liste à chaque clic.
  const [postesCoches, setPostesCoches] = useState(() => new Set(postesDisponibles));

  // Réinitialise la sélection quand le dossier change (voir l'effet de scroll ci-dessus pour la
  // même raison : sur TableauDeBordAccueil.jsx, ce panneau n'est pas démonté/remonté entre deux
  // ouvertures sur des dossiers différents, il faut donc un effet plutôt qu'un état initial calculé
  // une seule fois). Clé sur les codes eux-mêmes (JSON.stringify), pas seulement dossierId : couvre
  // aussi le cas où la liste de postes déclarés changerait pour un même dossier entre deux ouvertures.
  useEffect(() => {
    setPostesCoches(new Set(postesDisponibles));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dossierId, JSON.stringify(postesDisponibles)]);

  // Même raison que l'effet ci-dessus (pas de démontage entre deux dossiers sur
  // TableauDeBordAccueil) : re-présélectionne le bon groupe (Inspecteurs/Formateurs) si l'agent
  // ouvre ce panneau pour un autre dossier sans l'avoir fermé.
  useEffect(() => {
    setGroupeRole(postesBureau.length > 0 ? 'inspecteur' : 'formateur');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dossierId, JSON.stringify(postesBureau)]);

  const togglerPoste = (code) => {
    setPostesCoches((precedent) => {
      const suivant = new Set(precedent);
      if (suivant.has(code)) suivant.delete(code);
      else suivant.add(code);
      return suivant;
    });
  };

  // Liste combinée formateurs + inspecteurs (voir GET /api/formateurs, role_code désormais inclus
  // dans chaque ligne) — la sélection de la personne précise, une fois filtrée par groupe, est
  // gérée par l'effet séparé ci-dessous plutôt qu'ici : ce fetch ne se relance jamais (dossier
  // changé ou pas, dépendances vides), alors que la personne présélectionnée doit se recalculer à
  // chaque changement de groupe/dossier.
  useEffect(() => {
    let annule = false;
    listerFormateurs()
      .then((valeur) => {
        if (annule) return;
        setFormateurs(valeur);
      })
      .catch((erreur) => {
        if (!annule) setErreurFormateurs(erreur.response?.data?.erreur ?? 'Impossible de récupérer la liste des formateurs.');
      })
      .finally(() => {
        if (!annule) setChargementFormateurs(false);
      });
    return () => {
      annule = true;
    };
  }, []);

  // Lieux disponibles (voir GET /api/lieux) — fetch indépendant de celui des formateurs
  // ci-dessus : un échec ici ne doit pas bloquer la planification (voir lieux plus bas, champ
  // optionnel), contrairement à erreurFormateurs qui empêche l'affichage du formulaire entier.
  useEffect(() => {
    let annule = false;
    listerLieux()
      .then((valeur) => {
        if (!annule) setLieux(valeur);
      })
      .catch((erreur) => {
        if (!annule) setErreurLieux(erreur.response?.data?.erreur ?? 'Impossible de récupérer la liste des lieux.');
      })
      .finally(() => {
        if (!annule) setChargementLieux(false);
      });
    return () => {
      annule = true;
    };
  }, []);

  // Liste filtrée sur le groupe actif — c'est elle qui alimente le <select> plus bas, jamais la
  // liste combinée brute.
  const formateursDuGroupe = formateurs.filter((formateur) => formateur.role_code === groupeRole);

  // Présélectionne la première personne du groupe actif, dès que la liste combinée est chargée ET
  // à chaque changement de groupe (clic sur l'onglet, ou représélection automatique à l'ouverture
  // sur un autre dossier, voir l'effet dossierId/postesBureau ci-dessus) — même principe que la
  // sélection initiale d'origine (premier de la liste), appliqué désormais au sous-groupe plutôt
  // qu'à la liste entière. '' si le groupe est vide (ex. aucun inspecteur configuré pour cette
  // entité) : le <select> reste alors vide et le bouton de soumission désactivé (voir plus bas,
  // même garde qu'avant).
  useEffect(() => {
    setFormateurId(formateursDuGroupe.length > 0 ? String(formateursDuGroupe[0].id) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupeRole, formateurs]);

  useEffect(() => {
    if (!formateurId || !dateTest) {
      setCreneauxJourSelectionne([]);
      return undefined;
    }
    let annule = false;
    // Bornes du seul jour choisi (dateFin exclusive) — calcul par arithmétique locale de Date
    // (pas de toISOString ici) pour ne jamais glisser sur le jour voisin selon le fuseau du
    // navigateur, cf. cleJourLocal dans CalendrierDisponibiliteFormateur.jsx.
    const [annee, mois, jour] = dateTest.split('-').map(Number);
    const lendemain = new Date(annee, mois - 1, jour + 1);
    const dateFin = `${lendemain.getFullYear()}-${String(lendemain.getMonth() + 1).padStart(2, '0')}-${String(lendemain.getDate()).padStart(2, '0')}`;

    listerRendezvousTest({ formateurId: Number(formateurId), dateDebut: dateTest, dateFin })
      .then((valeur) => {
        if (!annule) setCreneauxJourSelectionne(valeur);
      })
      .catch(() => {
        if (!annule) setCreneauxJourSelectionne([]);
      });
    return () => {
      annule = true;
    };
  }, [formateurId, dateTest]);

  // Même recombinaison que celle utilisée au submit (voir plus bas) : null tant que les trois
  // contrôles ne sont pas tous renseignés, pour ne pas comparer un créneau incomplet.
  const dateHeureChoisieIso = dateTest && heureTest && minuteTest
    ? new Date(`${dateTest}T${heureTest}:${minuteTest}`).toISOString()
    : null;

  const nombreDejaPresentsSurCreneau = dateHeureChoisieIso === null
    ? 0
    : creneauxJourSelectionne.filter((rendezvous) => new Date(rendezvous.date_heure).toISOString() === dateHeureChoisieIso).length;
  const creneauDejaPris = nombreDejaPresentsSurCreneau >= CAPACITE_MAX_FORMATEUR_PAR_CRENEAU;

  const soumettre = async (evenement) => {
    evenement.preventDefault();
    if (!dateTest || !heureTest || !minuteTest || !formateurId || envoiEnCours || creneauDejaPris) return;

    setEnvoiEnCours(true);
    setErreurEnvoi(null);

    const formateurChoisi = formateurs.find((f) => String(f.id) === formateurId);
    // Recombine les trois contrôles séparés (date + heure + minute) dans le même format que
    // produisait l'ancien input datetime-local ('aaaa-mm-jjTHH:mm'), pour ne rien changer côté
    // service/back (voir creerRendezvous, qui attend une chaîne convertible en Date).
    const dateHeureIso = dateHeureChoisieIso;

    // Une seule transition à appliquer : `codeAction` reçu en prop (voir en-tête de fichier) —
    // le moteur de transitions choisit lui-même la bonne ligne transitions_statut selon le statut
    // courant réel du dossier.
    const transitions = [
      {
        codeAction,
        commentaire: `Test planifié le ${FORMAT_DATE_HEURE.format(new Date(dateHeureIso))} avec ${formateurChoisi.prenom} ${formateurChoisi.nom}.`,
      },
    ];

    // Création du rendez-vous et changement de statut en une seule transaction côté back (voir
    // rendezvousService.creerRendezvousAvecTransitions) : soit les deux réussissent, soit aucun
    // des deux n'est enregistré — plus de rendez-vous "orphelin" possible si la transition échoue.
    try {
      await creerRendezvousAvecTransitions(dossierId, {
        typeRdv: 'test',
        dateHeure: dateHeureIso,
        formateurId: Number(formateurId),
        // '' (aucun lieu choisi, champ optionnel) -> undefined plutôt que NaN/0 : le back retombe
        // alors sur l'adresse par défaut ACCECIT (voir invitationTestService.js, LIEU_TEST_ACCECIT).
        lieuId: lieuId ? Number(lieuId) : undefined,
        postesSelectionnes: [...postesCoches],
        transitions,
      });
    } catch (erreur) {
      setEnvoiEnCours(false);
      setErreurEnvoi(
        erreur.response
          ? (erreur.response.data?.erreur ?? "Le serveur n'a pas pu enregistrer la planification. Merci de réessayer.")
          : 'Connexion au serveur impossible. Vérifiez le réseau et réessayez.',
      );
      return;
    }

    setEnvoiEnCours(false);
    onReussite({ dateHeure: dateHeureIso, formateurNom: `${formateurChoisi.prenom} ${formateurChoisi.nom}` });
  };

  return (
    <div ref={panneauRef} className="modale-planification-test" role="dialog" aria-label={titre}>
      <div className="modale-planification-test__entete">
        <h3>{titre}</h3>
        <button type="button" onClick={onAnnuler} disabled={envoiEnCours}>
          Fermer
        </button>
      </div>

      {chargementFormateurs && <p>Chargement des formateurs…</p>}
      {erreurFormateurs && <p role="alert">{erreurFormateurs}</p>}

      {!chargementFormateurs && !erreurFormateurs && formateurs.length === 0 && (
        <p role="alert">Aucun formateur ni inspecteur disponible pour cette entité — impossible de planifier un test.</p>
      )}

      {!chargementFormateurs && formateurs.length > 0 && (
        <form className="modale-planification-test__formulaire" onSubmit={soumettre}>
          {/* Choix du groupe avant la personne précise (voir GROUPES_ROLE) — deux onglets
              mutuellement exclusifs, pas de "Tous" (contrairement à FiltresStatut.jsx, pensé pour
              "Tous + N options" : ici un groupe doit toujours être actif, sinon aucune personne
              à proposer dans le <select> juste en dessous). Placé avant le <select> lui-même,
              qui ne liste que les personnes du groupe actif. */}
          <div className="modale-planification-test__groupes-role" role="group" aria-label="Groupe">
            {GROUPES_ROLE.map((groupe) => (
              <button
                key={groupe.code}
                type="button"
                className={groupeRole === groupe.code ? 'actif' : ''}
                onClick={() => setGroupeRole(groupe.code)}
              >
                {groupe.libelle}
              </button>
            ))}
          </div>

          {/* Texte du label regroupé dans un unique <span> (plutôt que texte + astérisque comme
              deux enfants directs du label) : le label est en display: flex/column pour
              empiler son contenu au-dessus du <select> imbriqué — un texte et un astérisque
              comme deux enfants directs se seraient sinon empilés l'un sous l'autre au lieu de
              rester sur la même ligne. Placé avant le calendrier et la date/heure : le formateur
              doit être connu avant d'afficher ses disponibilités. */}
          <label>
            <span>
              {groupeRole === 'inspecteur' ? 'Inspecteur' : 'Formateur'} <span className="champ-obligatoire">*</span>
            </span>
            {formateursDuGroupe.length === 0 ? (
              <p role="alert" className="modale-planification-test__groupe-vide">
                Aucun{groupeRole === 'inspecteur' ? ' inspecteur' : ' formateur'} disponible pour cette entité.
              </p>
            ) : (
              <select
                id="planification-formateur"
                value={formateurId}
                onChange={(evenement) => setFormateurId(evenement.target.value)}
                required
              >
                {formateursDuGroupe.map((formateur) => (
                  <option key={formateur.id} value={formateur.id}>
                    {formateur.prenom} {formateur.nom}
                  </option>
                ))}
              </select>
            )}
          </label>

          {/* Aide visuelle uniquement (voir commentaire de CalendrierDisponibiliteFormateur) : le
              clic sur un jour se contente de préremplir le input date ci-dessous, qui reste la
              seule source de vérité pour la date choisie. */}
          <CalendrierDisponibiliteFormateur
            formateurId={formateurId}
            dateSelectionnee={dateTest}
            onSelectionnerJour={setDateTest}
          />

          {/* fieldset plutôt qu'un simple label : trois contrôles distincts (date, heure,
              minute) partagent une seule légende. Le texte de la légende reste un bloc unique
              (pas de display: flex sur le fieldset/legend ici), donc l'astérisque reste sur la
              même ligne. */}
          <fieldset className="modale-planification-test__champ-date-heure">
            <legend>
              Date et heure du test <span className="champ-obligatoire">*</span>
            </legend>
            <div className="modale-planification-test__date-heure-controles">
              <input
                id="planification-date"
                type="date"
                value={dateTest}
                min={dateDuJourParis()}
                onChange={(evenement) => setDateTest(evenement.target.value)}
                required
              />
              <select
                id="planification-heure"
                aria-label="Heure"
                value={heureTest}
                onChange={(evenement) => setHeureTest(evenement.target.value)}
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
                id="planification-minute"
                aria-label="Minutes"
                value={minuteTest}
                onChange={(evenement) => setMinuteTest(evenement.target.value)}
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

            {/* Dans le même fieldset que la date/heure (aligné visuellement avec elle, décision
                produit) plutôt qu'un label séparé comme "Formateur" plus haut — même style de
                composition label/select que lui malgré ce placement différent. Optionnel
                (contrairement à date/heure/formateur) : un rendez-vous peut rester sans lieu
                précisé, voir soumettre() ci-dessus et invitationTestService.js côté back (repli
                sur LIEU_TEST_ACCECIT). Ni le chargement ni une éventuelle erreur ne bloquent le
                reste du formulaire — contrairement aux formateurs, la liste de lieux n'est pas
                indispensable pour planifier un test. */}
            <label className="modale-planification-test__champ-lieu">
              <span>Lieu</span>
              {chargementLieux ? (
                <p className="modale-planification-test__lieu-etat">Chargement des lieux…</p>
              ) : erreurLieux ? (
                <p role="alert" className="modale-planification-test__lieu-etat">
                  {erreurLieux}
                </p>
              ) : lieux.length === 0 ? (
                <p className="modale-planification-test__lieu-etat">Aucun lieu configuré pour cette entité.</p>
              ) : (
                <select id="planification-lieu" value={lieuId} onChange={(evenement) => setLieuId(evenement.target.value)}>
                  <option value="">—</option>
                  {lieux.map((lieu) => (
                    <option key={lieu.id} value={lieu.id}>
                      {lieu.libelle}
                    </option>
                  ))}
                </select>
              )}
            </label>
          </fieldset>

          {/* Phase 1 (informatif uniquement, voir CLAUDE.md/décision produit) : n'apparaît que si
              le dossier a plusieurs postes déclarés — avec un seul poste, rien à choisir, l'afficher
              serait un décochage sans effet utile. Toutes les cases restent pré-cochées par défaut
              (postesCoches initialisé à l'ensemble des postes déclarés) : l'agent décoche seulement
              ceux qui ne concernent pas ce test précis. */}
          {postesDisponibles.length > 1 && (
            <fieldset className="modale-planification-test__champ-postes">
              <legend>Poste(s) testé(s)</legend>
              {postesDisponibles.map((code) => (
                <label key={code} className="modale-planification-test__poste">
                  <input type="checkbox" checked={postesCoches.has(code)} onChange={() => togglerPoste(code)} />
                  {libellePoste ? libellePoste(code) : code}
                </label>
              ))}
            </fieldset>
          )}

          {creneauDejaPris && (
            <p role="alert">
              Ce formateur a déjà {CAPACITE_MAX_FORMATEUR_PAR_CRENEAU} candidats prévus à cet horaire (créneau
              complet). Choisissez un autre créneau.
            </p>
          )}

          {erreurEnvoi && <p role="alert">{erreurEnvoi}</p>}

          <div className="modale-planification-test__formulaire-actions">
            <button type="button" onClick={onAnnuler} disabled={envoiEnCours}>
              Annuler
            </button>
            <button
              type="submit"
              disabled={envoiEnCours || !dateTest || !heureTest || !minuteTest || !formateurId || creneauDejaPris}
            >
              {envoiEnCours ? 'Enregistrement...' : 'Confirmer la planification'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
