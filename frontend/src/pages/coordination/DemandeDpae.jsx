import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import RechercheCandidatSalarie from '../../core/dossier/RechercheCandidatSalarie';
import { useSession } from '../../core/auth/useSession';
import { peut } from '../../core/auth/permissions';
import { creerDemande, listerNotesDemande, modifierDemande, obtenirDemande } from '../../services/dpaeService';
import {
  JOURS_SEMAINE,
  affecterSitesSemaine,
  donneesFormulaireDepuisDemande,
  donneesInitiales,
  joursPrivesDeSite,
  validerFormulaire,
} from '../../core/dpae/formulaireDemandeDpae';
import { STATUTS_NOTE_MODIFICATION_OBLIGATOIRE } from '../../core/dpae/statutsDpae';
import { libelleNombreJours, nombreJoursCalendaires } from '../../core/dpae/joursCalendaires';
import SelecteurSitesJour from './SelecteurSitesJour';
import SelecteurSitesAffectation from './SelecteurSitesAffectation';
import './DemandeDpae.css';

// Types de demande — mêmes valeurs que demandeBodySchema (backend/src/api/routes/dpae.routes.js,
// z.enum), dupliquées ici plutôt que partagées (convention du projet, voir CLAUDE.md).
const TYPES_DEMANDE = [
  { code: 'nouvelle_embauche', libelle: 'Nouvelle embauche' },
  { code: 'prolongation', libelle: 'Prolongation' },
  { code: 'ajout_retrait_jours', libelle: 'Ajout/retrait de jours' },
  { code: 'passage_cdi', libelle: 'Passage CDI' },
  { code: 'changement_horaires_affectation', libelle: 'Changement horaires/affectation' },
];

// Postes hôtel — mêmes codes/libellés que BlocDisponibilites.jsx (POSTES_HOTEL), dupliqués ici
// plutôt que partagés (même convention). Réutilise le catalogue déjà en place plutôt que d'en
// inventer un nouveau (voir postesConstantes.js côté back).
const POSTES_HOTEL = [
  { code: 'femme_valet_chambre', libelle: 'Femme/Valet de chambre' },
  { code: 'cafetier', libelle: 'Cafetier' },
  { code: 'equipier', libelle: 'Équipier' },
  { code: 'gouvernant', libelle: 'Gouvernant(e)' },
  { code: 'autre', libelle: 'Autre' },
];

// Formulaire "Nouvelle demande DPAE" (module Demandes DPAE, 2026-09-28) — reprend les sections de
// la maquette d'origine (voir le plan) avec le style de l'outil (PageBackOffice/EnTeteBackOffice,
// mêmes classes .bloc-formulaire que le formulaire d'inscription candidat, voir
// styles/blocFormulaire.css). Pas de brouillon : un seul bouton, « Envoyer au Planning » pour un rôle
// dont les demandes passent d'abord par le Planning (dpaeCreationSoumiseAuPlanning), « Envoyer à la
// RH » pour les autres, désactivé tant que le formulaire n'est pas complet — même esprit que la maquette (voir demandeDpaeService.js,
// pas de statut brouillon côté back).
//
// "Jours concernés" (ajout/retrait de jours) : simple liste de dates ajoutées/retirées une à une,
// plutôt que la grille tactile de la maquette — même donnée finale (un tableau de dates), pour un
// premier jet plus simple à développer/tester (voir le plan, section Simplifications).
//
// Note sur la modification (mode modification) : facultative, obligatoire pour une demande « Renvoyée à
// l'inspecteur » ou « En attente » (les 3 dernières notes de la demande s'affichent alors en lecture
// seule au-dessus du champ : la raison du renvoi ou de la mise en attente s'y trouve).
// Elle est enregistrée avec la modification, dans la même transaction côté serveur.
//
// Mode modification (route /coordination/dpae/:demandeId/modifier) : le MÊME formulaire, prérempli
// avec la demande existante (donneesFormulaireDepuisDemande) ; « Enregistrer les modifications »
// envoie la demande complète et la version lue (PUT /api/dpae/:id), « Annuler » revient à la fiche.
const LONGUEUR_MAX_NOTE = 1000;
const NOMBRE_NOTES_AFFICHEES = 3;
const FORMAT_DATE_NOTE = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function FormulaireDemandeDpae({ demande, onRecharger }) {
  const modification = Boolean(demande);
  const [noteModification, setNoteModification] = useState('');
  const noteObligatoire = modification && STATUTS_NOTE_MODIFICATION_OBLIGATOIRE.includes(demande.statut);
  // Dernières notes de la demande (plus récentes d'abord), seulement quand la note est obligatoire.
  const [dernieresNotes, setDernieresNotes] = useState([]);
  const [erreurNotes, setErreurNotes] = useState(false);
  useEffect(() => {
    if (!noteObligatoire) return;
    listerNotesDemande(demande.id)
      .then((notes) => setDernieresNotes(notes.slice(0, NOMBRE_NOTES_AFFICHEES)))
      .catch(() => setErreurNotes(true));
  }, [noteObligatoire, demande?.id]);
  const navigate = useNavigate();
  const { utilisateur } = useSession();
  const libelleEnvoi = peut(utilisateur, 'dpaeCreationSoumiseAuPlanning') ? 'Envoyer au Planning' : 'Envoyer à la RH';
  // Enregistrement sans aucun changement : rien n'a été écrit, on reste sur le formulaire.
  const [information, setInformation] = useState(null);
  const [donnees, setDonnees] = useState(() => (demande ? donneesFormulaireDepuisDemande(demande) : donneesInitiales()));
  // Vrai quand le serveur a refusé l'enregistrement (409) : la demande a changé depuis son
  // chargement. La saisie reste à l'écran ; recharger la remplace par la version à jour.
  const [conflit, setConflit] = useState(false);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [erreur, setErreur] = useState(null);
  // Bloc « Site(s) d'affectation » : replié à l'ouverture du formulaire, déplié automatiquement si
  // l'on tente d'envoyer sans site (voir envoyer) — d'où un état tenu ici, pas dans le sélecteur.
  const [sitesOuverts, setSitesOuverts] = useState(false);
  // Champs obligatoires : pas de `required` HTML (il empêcherait d'afficher le message dédié sous le
  // champ). À la première tentative d'envoi, tous les champs en erreur sont signalés (validerFormulaire,
  // mêmes messages que le serveur), le formulaire défile vers le premier, et les erreurs suivent ensuite
  // la saisie. `semaineSignalee` : après le retrait d'un site, les jours privés de site sont signalés
  // tout de suite, sans attendre l'envoi.
  const [tentativeEnvoi, setTentativeEnvoi] = useState(false);
  const [semaineSignalee, setSemaineSignalee] = useState(false);
  const refsChamps = useRef({});
  // Sites connus (nom et initiales) pour la liste « site par jour » : sites actifs chargés par le
  // sélecteur, plus ceux déjà liés à la demande modifiée (un site désactivé depuis reste affiché).
  const [sitesChargees, setSitesChargees] = useState([]);

  const definir = (champ, valeur) => setDonnees((precedent) => ({ ...precedent, [champ]: valeur }));

  // `candidat` nul : soit une nouvelle saisie libre efface la sélection au fil de la frappe (voir
  // onChanger ci-dessous), soit l'agent clique "Retirer" (RechercheCandidatSalarie.jsx) — dans les
  // deux cas, nom ET prénom doivent repartir vides pour une ressaisie propre, pas seulement
  // candidatId (bug signalé : "Retirer" ne vidait pas les champs, donnant l'impression de ne rien
  // faire alors que seule la mention "Candidat existant sélectionné" disparaissait).
  const selectionnerCandidat = (candidat) => {
    if (!candidat) {
      setDonnees((precedent) => ({ ...precedent, candidatId: null, salarieNom: '', salariePrenom: '' }));
      return;
    }
    setDonnees((precedent) => ({
      ...precedent,
      candidatId: candidat.id,
      salarieNom: candidat.nom,
      salariePrenom: candidat.prenom,
    }));
  };

  const definirJourSemaine = (index, champs) => {
    setDonnees((precedent) => ({
      ...precedent,
      semaineType: precedent.semaineType.map((jour, indexJour) => (indexJour === index ? { ...jour, ...champs } : jour)),
    }));
  };

  // Bascule Travail/Repos : un jour de repos n'a pas de site ; avec un seul site, un jour travaillé le
  // reçoit aussitôt.
  const basculerJour = (index, statut) => {
    setDonnees((precedent) => ({
      ...precedent,
      semaineType: affecterSitesSemaine(
        precedent.semaineType.map((jour, indexJour) => (indexJour === index ? { ...jour, statut } : jour)),
        precedent.sitesAffectationIds,
      ),
    }));
  };

  const ajouterJourConcerne = () => definir('joursConcernes', [...donnees.joursConcernes, { date: '' }]);
  const definirJourConcerne = (index, date) =>
    definir(
      'joursConcernes',
      donnees.joursConcernes.map((jour, indexJour) => (indexJour === index ? { date } : jour)),
    );
  const retirerJourConcerne = (index) =>
    definir(
      'joursConcernes',
      donnees.joursConcernes.filter((_, indexJour) => indexJour !== index),
    );

  // Sélection de sites : les jours de la semaine type sont réaffectés (un seul site : attribué à tous les
  // jours travaillés ; un site retiré : les jours qui l'utilisaient sont vidés et signalés).
  const changerSites = (ids) => {
    const ancienne = donnees.semaineType;
    const nouvelle = affecterSitesSemaine(ancienne, ids);
    if (joursPrivesDeSite(ancienne, nouvelle, ids).length > 0) setSemaineSignalee(true);
    setDonnees((precedent) => ({ ...precedent, sitesAffectationIds: ids, semaineType: nouvelle }));
  };

  const sitesConnus = useMemo(() => {
    const parId = new Map((demande?.sites_affectation ?? []).map((site) => [site.id, site]));
    for (const site of sitesChargees) parId.set(site.id, site);
    return parId;
  }, [demande, sitesChargees]);
  const sitesSelectionnes = donnees.sitesAffectationIds.map((id) => sitesConnus.get(id)).filter(Boolean);
  const plusieursSites = donnees.sitesAffectationIds.length > 1;

  const erreurs = useMemo(() => validerFormulaire(donnees), [donnees]);
  const messageErreur = (champ) => {
    const visible = tentativeEnvoi || (semaineSignalee && champ.startsWith('semaine:'));
    return visible ? erreurs.find((erreur) => erreur.champ === champ)?.message : undefined;
  };
  const refChamp = (champ) => (element) => {
    refsChamps.current[champ] = element;
  };
  const erreurChamp = (champ) => {
    const message = messageErreur(champ);
    return (
      message && (
        <p role="alert" className="page-demande-dpae__erreur-champ">
          {message}
        </p>
      )
    );
  };

  const nombreJours = nombreJoursCalendaires(donnees.dateDebut, donnees.dateFin);
  const estAjoutRetraitJours = donnees.typeDemande === 'ajout_retrait_jours';
  // CDD de remplacement : seul cas où "Nom du salarié remplacé" est obligatoire
  // — même règle côté serveur (dpae.routes.js, demandeBodySchema). Dans tous les autres cas (CDI,
  // CDD de surcroît d'activité), la valeur éventuellement saisie n'est pas envoyée (voir envoyer).
  const estCddRemplacement = donnees.typeContrat === 'cdd' && donnees.motifCdd === 'remplacement_absent';

  // Les champs contrôlés par validerFormulaire (sites, contrat, poste, dates, site par jour…) sont
  // traités à part : pour que l'agent puisse TENTER d'envoyer sans les avoir renseignés et voir le
  // message dédié (voir envoyer), le bouton « Envoyer » ne dépend que des AUTRES champs obligatoires.
  // L'envoi lui-même reste bloqué tant que l'un d'eux manque (et refusé côté serveur de toute façon).
  const formulaireCompletHorsSites =
    donnees.typeDemande &&
    donnees.salarieNom.trim() &&
    donnees.salariePrenom.trim() &&
    (!estCddRemplacement || donnees.salarieRemplaceNom.trim()) &&
    donnees.verifBesoinHotel &&
    donnees.verifTousJoursInclus &&
    donnees.verifNonPlanification &&
    (!noteObligatoire || noteModification.trim());

  const envoyer = async (evenement) => {
    evenement.preventDefault();
    if (!formulaireCompletHorsSites || envoiEnCours) return;
    setTentativeEnvoi(true);
    if (erreurs.length > 0) {
      // Bloc Sites déplié et défilement vers le premier champ en erreur (ordre du formulaire) — aucune
      // requête n'est envoyée.
      if (erreurs.some((erreur) => erreur.champ === 'sites')) setSitesOuverts(true);
      refsChamps.current[erreurs[0].champ]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    setEnvoiEnCours(true);
    setErreur(null);
    setInformation(null);
    setConflit(false);
    try {
      const { candidatId, heuresParMois, heureDebutCommune, heureFinCommune, ...reste } = donnees;

      // Semaine type envoyée telle quelle si horaires différents par jour, sinon les heures
      // communes sont recopiées sur chaque jour "travail" — le back reçoit toujours la même forme
      // (un tableau de 7 entrées), sans avoir à connaître cette bascule d'interface.
      const semaineHoraires = donnees.horairesDifferentsParJour
        ? donnees.semaineType
        : donnees.semaineType.map((jour) =>
            jour.statut === 'travail' ? { ...jour, heureDebut: heureDebutCommune, heureFin: heureFinCommune } : jour,
          );
      // Site par jour : un jour de repos n'en a pas, un seul site est attribué à tous les jours travaillés.
      const semaineType = affecterSitesSemaine(semaineHoraires, donnees.sitesAffectationIds);
      // CDI : motif, dernier jour et champs du CDD ne sont pas envoyés (champs masqués).
      const estCdd = donnees.typeContrat === 'cdd';
      const corps = {
        ...reste,
        candidatId: candidatId || undefined,
        motifCdd: estCdd ? reste.motifCdd : undefined,
        dateFin: estCdd ? reste.dateFin : undefined,
        dateFinAbsence: estCdd ? reste.dateFinAbsence : undefined,
        raisonSurcroit: estCdd ? reste.raisonSurcroit : undefined,
        salarieRemplaceNom: estCddRemplacement ? reste.salarieRemplaceNom : undefined,
        heuresParMois: heuresParMois ? Number(heuresParMois) : undefined,
        semaineType,
        joursConcernes: donnees.joursConcernes.filter((jour) => jour.date),
      };
      if (modification) {
        const resultat = await modifierDemande(demande.id, { ...corps, version: demande.version, noteModification: noteModification.trim() || undefined });
        if (resultat.aucuneModification) {
          setInformation(resultat.message ?? 'Aucune modification');
          return;
        }
        // Version inchangée : seule la note a été enregistrée (aucun changement de la demande).
        const confirmation = resultat.version === demande.version ? 'La note a été enregistrée.' : 'Les modifications de la demande ont été enregistrées.';
        navigate(`/rh/dpae/${demande.id}`, { state: { confirmation } });
      } else {
        await creerDemande(corps);
        navigate('/coordination/dpae/suivi');
      }
    } catch (erreurRequete) {
      setConflit(erreurRequete.response?.status === 409);
      setErreur(erreurRequete.response?.data?.erreur ?? (modification ? "Impossible d'enregistrer les modifications." : "Impossible d'envoyer la demande."));
    } finally {
      setEnvoiEnCours(false);
    }
  };

  return (
    <PageBackOffice>
      <div className="page-demande-dpae">
        <header className="page-demande-dpae__entete">
          <h1>{modification ? `Modifier la demande DPAE n° ${demande.id}` : 'Nouvelle demande DPAE'}</h1>
          <EnTeteBackOffice />
        </header>

        <form onSubmit={envoyer}>
          <fieldset className="bloc-formulaire">
            <legend>Informations de saisie</legend>
            <label>
              <span>
                Il s&rsquo;agit de… <span className="champ-obligatoire">*</span>
              </span>
              <select value={donnees.typeDemande} onChange={(e) => definir('typeDemande', e.target.value)} required>
                <option value="">Choisir…</option>
                {TYPES_DEMANDE.map((type) => (
                  <option key={type.code} value={type.code}>
                    {type.libelle}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>

          <fieldset className="bloc-formulaire">
            <legend>Données du salarié</legend>
            <label>
              <span>
                Nom <span className="champ-obligatoire">*</span>
              </span>
              <RechercheCandidatSalarie
                valeur={donnees.salarieNom}
                onChanger={(valeur) => {
                  definir('salarieNom', valeur);
                  if (donnees.candidatId) definir('candidatId', null);
                }}
                onSelectionnerCandidat={selectionnerCandidat}
                candidatId={donnees.candidatId}
              />
            </label>
            <label>
              <span>
                Prénom <span className="champ-obligatoire">*</span>
              </span>
              <input
                type="text"
                value={donnees.salariePrenom}
                onChange={(e) => definir('salariePrenom', e.target.value)}
                required
              />
            </label>
            <label>
              <span>Téléphone</span>
              <input type="tel" value={donnees.salarieTelephone} onChange={(e) => definir('salarieTelephone', e.target.value)} />
            </label>

            <div ref={refChamp('salarieDejaEmploye')}>
              <fieldset>
                <legend>
                  A déjà travaillé chez nous ? <span className="champ-obligatoire">*</span>
                </legend>
                <label className="champ-inline">
                  <input
                    type="radio"
                    name="salarieDejaEmploye"
                    checked={donnees.salarieDejaEmploye === true}
                    onChange={() => definir('salarieDejaEmploye', true)}
                  />
                  Oui
                </label>
                <label className="champ-inline">
                  <input
                    type="radio"
                    name="salarieDejaEmploye"
                    checked={donnees.salarieDejaEmploye === false}
                    onChange={() => definir('salarieDejaEmploye', false)}
                  />
                  Non
                </label>
              </fieldset>
              {erreurChamp('salarieDejaEmploye')}
            </div>

            {/* Site(s) d'affectation : sélection d'un ou plusieurs sites du référentiel,
                au moins un obligatoire (envoi bloqué sinon, voir envoyer) — contrôlé aussi côté
                serveur (dpae.routes.js, sitesAffectationIds). Remplace le champ texte libre. Bloc
                replié par défaut, déplié automatiquement sur une tentative d'envoi sans site. */}
            <div ref={refChamp('sites')}>
              <SelecteurSitesAffectation
                selection={donnees.sitesAffectationIds}
                onChangerSelection={changerSites}
                ouvert={sitesOuverts}
                onChangerOuvert={setSitesOuverts}
                onSitesCharges={setSitesChargees}
              />
              {erreurChamp('sites')}
            </div>
          </fieldset>

          <fieldset className="bloc-formulaire">
            <legend>Paramètres du contrat</legend>
            <div ref={refChamp('typeContrat')}>
            <fieldset>
              <legend>
                Type de contrat <span className="champ-obligatoire">*</span>
              </legend>
              <label className="champ-inline">
                <input
                  type="radio"
                  name="typeContrat"
                  checked={donnees.typeContrat === 'cdd'}
                  onChange={() => definir('typeContrat', 'cdd')}
                />
                CDD
              </label>
              <label className="champ-inline">
                <input
                  type="radio"
                  name="typeContrat"
                  checked={donnees.typeContrat === 'cdi'}
                  onChange={() => definir('typeContrat', 'cdi')}
                />
                CDI
              </label>
            </fieldset>
            {erreurChamp('typeContrat')}
            </div>

            {donnees.typeContrat === 'cdd' && (
              <>
                <div ref={refChamp('motifCdd')}>
                <fieldset>
                  <legend>
                    Raison du CDD <span className="champ-obligatoire">*</span>
                  </legend>
                  <label className="champ-inline">
                    <input
                      type="radio"
                      name="motifCdd"
                      checked={donnees.motifCdd === 'remplacement_absent'}
                      onChange={() => definir('motifCdd', 'remplacement_absent')}
                    />
                    Remplacer salarié absent
                  </label>
                  <label className="champ-inline">
                    <input
                      type="radio"
                      name="motifCdd"
                      checked={donnees.motifCdd === 'surcroit_activite'}
                      onChange={() => definir('motifCdd', 'surcroit_activite')}
                    />
                    Surcroît d&rsquo;activité
                  </label>
                </fieldset>
                {erreurChamp('motifCdd')}
                </div>

                {donnees.motifCdd === 'remplacement_absent' && (
                  <>
                    {/* Obligatoire dans ce cas précis (CDD de remplacement, voir estCddRemplacement) —
                        ce champ n'est d'ailleurs affiché que dans ce cas. */}
                    <label>
                      <span>
                        Nom du salarié remplacé <span className="champ-obligatoire">*</span>
                      </span>
                      <input
                        type="text"
                        value={donnees.salarieRemplaceNom}
                        onChange={(e) => definir('salarieRemplaceNom', e.target.value)}
                        required
                      />
                    </label>
                    <label>
                      <span>Date de fin d&rsquo;absence</span>
                      <input
                        type="date"
                        value={donnees.dateFinAbsence}
                        onChange={(e) => definir('dateFinAbsence', e.target.value)}
                      />
                    </label>
                  </>
                )}

                {donnees.motifCdd === 'surcroit_activite' && (
                  <label>
                    <span>Raison du surcroît</span>
                    <textarea
                      rows={2}
                      value={donnees.raisonSurcroit}
                      onChange={(e) => definir('raisonSurcroit', e.target.value)}
                    />
                  </label>
                )}
              </>
            )}

            <label>
              <span>Entité</span>
              <select value={donnees.division} onChange={(e) => definir('division', e.target.value)}>
                <option value="">Choisir…</option>
                <option value="hotellerie">Hôtellerie</option>
                <option value="tertiaire">Tertiaire</option>
                <option value="autre">Autre</option>
              </select>
            </label>
            {donnees.division === 'autre' && (
              <label>
                <span>Préciser l&rsquo;entité</span>
                <input type="text" value={donnees.divisionAutre} onChange={(e) => definir('divisionAutre', e.target.value)} />
              </label>
            )}

            <div ref={refChamp('poste')}>
              <label>
                <span>
                  Poste <span className="champ-obligatoire">*</span>
                </span>
                <select value={donnees.poste} onChange={(e) => definir('poste', e.target.value)}>
                  <option value="">Choisir…</option>
                  {POSTES_HOTEL.map((poste) => (
                    <option key={poste.code} value={poste.code}>
                      {poste.libelle}
                    </option>
                  ))}
                </select>
              </label>
              {erreurChamp('poste')}
            </div>
            {donnees.poste === 'autre' && (
              <label>
                <span>Préciser le poste</span>
                <input type="text" value={donnees.posteAutre} onChange={(e) => definir('posteAutre', e.target.value)} />
              </label>
            )}

            <div ref={refChamp('dateDebut')}>
              <label>
                <span>
                  Premier jour <span className="champ-obligatoire">*</span>
                </span>
                <input type="date" value={donnees.dateDebut} onChange={(e) => definir('dateDebut', e.target.value)} />
              </label>
              {erreurChamp('dateDebut')}
            </div>
            {/* Dernier jour : CDD seulement (masqué, et non envoyé, pour un CDI). */}
            {donnees.typeContrat === 'cdd' && (
              <>
                <div ref={refChamp('dateFin')}>
                  <label>
                    <span>
                      Dernier jour <span className="champ-obligatoire">*</span>
                    </span>
                    <input type="date" value={donnees.dateFin} onChange={(e) => definir('dateFin', e.target.value)} />
                  </label>
                  {erreurChamp('dateFin')}
                </div>
                {/* Calculé, jamais saisi ni stocké : jours calendaires, premier et dernier jour inclus. */}
                <label>
                  <span>Nombre total de jours calendaires</span>
                  <input type="text" readOnly value={nombreJours === null ? '' : libelleNombreJours(nombreJours)} />
                </label>
              </>
            )}
            <label>
              <span>Heure d&rsquo;arrivée jour 1</span>
              <input type="time" value={donnees.heureArriveeJ1} onChange={(e) => definir('heureArriveeJ1', e.target.value)} />
            </label>
            <label>
              <span>Heures/mois</span>
              <input
                type="number"
                min="0"
                step="0.5"
                value={donnees.heuresParMois}
                onChange={(e) => definir('heuresParMois', e.target.value)}
              />
            </label>

            <fieldset>
              <legend>Les jours ou horaires changent-ils ?</legend>
              <label className="champ-inline">
                <input
                  type="radio"
                  name="modificationsDemandees"
                  checked={donnees.modificationsDemandees === false}
                  onChange={() => definir('modificationsDemandees', false)}
                />
                Non
              </label>
              <label className="champ-inline">
                <input
                  type="radio"
                  name="modificationsDemandees"
                  checked={donnees.modificationsDemandees === true}
                  onChange={() => definir('modificationsDemandees', true)}
                />
                Oui
              </label>
            </fieldset>
          </fieldset>

          {donnees.modificationsDemandees && (
            <fieldset className="bloc-formulaire">
              <legend>Modifications</legend>
              <label className="champ-inline">
                <input
                  type="checkbox"
                  checked={donnees.modificationHoraires}
                  onChange={(e) => definir('modificationHoraires', e.target.checked)}
                />
                Horaires
              </label>
              <label className="champ-inline">
                <input
                  type="checkbox"
                  checked={donnees.modificationJoursRepos}
                  onChange={(e) => definir('modificationJoursRepos', e.target.checked)}
                />
                Jours de repos
              </label>
              <label className="champ-inline">
                <input
                  type="checkbox"
                  checked={donnees.modificationAffectation}
                  onChange={(e) => definir('modificationAffectation', e.target.checked)}
                />
                Hôtel ou poste
              </label>
              {donnees.modificationAffectation && (
                <label>
                  <span>Nouvelle affectation</span>
                  <input
                    type="text"
                    value={donnees.nouvelleAffectation}
                    onChange={(e) => definir('nouvelleAffectation', e.target.value)}
                  />
                </label>
              )}
            </fieldset>
          )}

          {estAjoutRetraitJours && (
            <fieldset className="bloc-formulaire">
              <legend>Gestion des jours</legend>
              <fieldset>
                <legend>Ajouter ou retirer des jours ?</legend>
                <label className="champ-inline">
                  <input
                    type="radio"
                    name="typeChangementJours"
                    checked={donnees.typeChangementJours === 'ajouter'}
                    onChange={() => definir('typeChangementJours', 'ajouter')}
                  />
                  Ajouter des jours
                </label>
                <label className="champ-inline">
                  <input
                    type="radio"
                    name="typeChangementJours"
                    checked={donnees.typeChangementJours === 'retirer'}
                    onChange={() => definir('typeChangementJours', 'retirer')}
                  />
                  Retirer des jours
                </label>
              </fieldset>

              <div className="page-demande-dpae__jours-concernes">
                <span>Jours concernés</span>
                {donnees.joursConcernes.map((jour, index) => (
                  <div key={index} className="page-demande-dpae__jour-ligne">
                    <input type="date" value={jour.date} onChange={(e) => definirJourConcerne(index, e.target.value)} />
                    <button type="button" onClick={() => retirerJourConcerne(index)}>
                      Retirer
                    </button>
                  </div>
                ))}
                <button type="button" onClick={ajouterJourConcerne}>
                  + Ajouter un jour
                </button>
              </div>

              <label>
                <span>Raison du changement</span>
                <textarea
                  rows={2}
                  value={donnees.raisonChangementJours}
                  onChange={(e) => definir('raisonChangementJours', e.target.value)}
                />
              </label>

              <fieldset>
                <legend>Même raison que le contrat ?</legend>
                {[
                  ['oui', 'Oui'],
                  ['non', 'Non'],
                  ['ne_sais_pas', 'Je ne sais pas'],
                ].map(([code, libelle]) => (
                  <label key={code} className="champ-inline">
                    <input
                      type="radio"
                      name="raisonIdentiqueContrat"
                      checked={donnees.raisonIdentiqueContrat === code}
                      onChange={() => definir('raisonIdentiqueContrat', code)}
                    />
                    {libelle}
                  </label>
                ))}
              </fieldset>
            </fieldset>
          )}

          <fieldset className="bloc-formulaire">
            <legend>Semaine type</legend>
            <label className="champ-inline">
              <input
                type="checkbox"
                checked={donnees.horairesDifferentsParJour}
                onChange={(e) => definir('horairesDifferentsParJour', e.target.checked)}
              />
              Horaires différents selon les jours
            </label>

            {!donnees.horairesDifferentsParJour && (
              <div className="page-demande-dpae__horaires-communs">
                <label>
                  <span>Début de journée</span>
                  <input
                    type="time"
                    value={donnees.heureDebutCommune}
                    onChange={(e) => definir('heureDebutCommune', e.target.value)}
                  />
                </label>
                <label>
                  <span>Fin de journée</span>
                  <input
                    type="time"
                    value={donnees.heureFinCommune}
                    onChange={(e) => definir('heureFinCommune', e.target.value)}
                  />
                </label>
              </div>
            )}

            {/* Grille de jours en grand format, tactile (demande utilisateur : "les jours en gros
                ... intuitif", même esprit que la maquette d'origine — un jour = une carte qu'on
                bascule Travail/Repos d'un tap, plutôt qu'un tableau HTML classique). Chaque carte
                porte son propre couple horaire quand "Horaires différents selon les jours" est
                cochée, sinon les deux champs communs juste au-dessus s'appliquent à tous les jours
                "Travail" (voir la recopie faite dans envoyer() à l'envoi). */}
            <div className="page-demande-dpae__semaine-type">
              {donnees.semaineType.map((jour, index) => {
                const libelle = JOURS_SEMAINE.find((j) => j.code === jour.jour)?.libelle;
                const enTravail = jour.statut === 'travail';
                return (
                  // <div>, pas <button> : un <input type="time"> ne peut pas vivre dans un
                  // <button> (contenu interactif interdit par la spec HTML) — seule la bascule
                  // Travail/Repos ci-dessous est un vrai <button>, les champs d'heure restent des
                  // frères, pas des enfants du bouton.
                  <div key={jour.jour} className={`page-demande-dpae__carte-jour${enTravail ? ' page-demande-dpae__carte-jour--travail' : ''}`}>
                    <button
                      type="button"
                      className="page-demande-dpae__carte-jour-bascule"
                      onClick={() => basculerJour(index, enTravail ? 'repos' : 'travail')}
                    >
                      <span className="page-demande-dpae__carte-jour-nom">{libelle}</span>
                      <span className="page-demande-dpae__carte-jour-statut">{enTravail ? 'Travail' : 'Repos'}</span>
                    </button>
                    {enTravail && plusieursSites && (
                      <div className="page-demande-dpae__carte-jour-site" ref={refChamp(`semaine:${jour.jour}`)}>
                        <SelecteurSitesJour
                          sites={sitesSelectionnes}
                          selection={jour.siteIds ?? []}
                          onChanger={(ids) => definirJourSemaine(index, { siteIds: ids.length > 0 ? ids : undefined })}
                          libelleJour={libelle.toLowerCase()}
                          invalide={Boolean(messageErreur(`semaine:${jour.jour}`))}
                        />
                        {erreurChamp(`semaine:${jour.jour}`)}
                      </div>
                    )}
                    {enTravail && donnees.horairesDifferentsParJour && (
                      <div className="page-demande-dpae__carte-jour-horaires">
                        <input
                          type="time"
                          value={jour.heureDebut}
                          onChange={(e) => definirJourSemaine(index, { heureDebut: e.target.value })}
                        />
                        <input
                          type="time"
                          value={jour.heureFin}
                          onChange={(e) => definirJourSemaine(index, { heureFin: e.target.value })}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="bloc-formulaire">
            <legend>Validation avant envoi</legend>
            <label>
              <span>Autre chose à signaler ?</span>
              <textarea
                rows={2}
                value={donnees.autreChoseSignaler}
                onChange={(e) => definir('autreChoseSignaler', e.target.value)}
              />
            </label>

            <label className="champ-inline">
              <input
                type="checkbox"
                checked={donnees.verifBesoinHotel}
                onChange={(e) => definir('verifBesoinHotel', e.target.checked)}
                required
              />
              J&rsquo;ai vérifié le besoin auprès de l&rsquo;hôtel <span className="champ-obligatoire">*</span>
            </label>
            <label className="champ-inline">
              <input
                type="checkbox"
                checked={donnees.verifTousJoursInclus}
                onChange={(e) => definir('verifTousJoursInclus', e.target.checked)}
                required
              />
              Je confirme que tous les jours sont inclus dans cette demande <span className="champ-obligatoire">*</span>
            </label>
            <label className="champ-inline">
              <input
                type="checkbox"
                checked={donnees.verifNonPlanification}
                onChange={(e) => definir('verifNonPlanification', e.target.checked)}
                required
              />
              Je m&rsquo;engage à ne pas planifier avant validation RH <span className="champ-obligatoire">*</span>
            </label>

            {erreur && <p role="alert">{erreur}</p>}
            {information && <p role="status">{information}</p>}
            {conflit && (
              <p>
                Votre saisie est conservée à l&rsquo;écran, mais elle ne peut pas être enregistrée telle quelle.{' '}
                <button type="button" onClick={onRecharger}>
                  Recharger la demande à jour
                </button>{' '}
                (remplace votre saisie par la version actuelle).
              </p>
            )}

            {modification && (
              <div className="page-demande-dpae__note-modification">
                {noteObligatoire && (
                  <div className="page-demande-dpae__dernieres-notes">
                    <strong>Dernières notes de la demande</strong>
                    {erreurNotes && <p role="alert">Impossible de récupérer les notes de cette demande.</p>}
                    {!erreurNotes && dernieresNotes.length === 0 && <p>Aucune note enregistrée pour cette demande.</p>}
                    {dernieresNotes.map((note) => (
                      <div key={note.id} className="page-demande-dpae__note">
                        <p>{note.contenu}</p>
                        <span>
                          {note.auteur_prenom} {note.auteur_nom} _ {FORMAT_DATE_NOTE.format(new Date(note.date_creation))}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <label>
                  <span>
                    Note sur la modification{noteObligatoire && <> <span className="champ-obligatoire">*</span></>}
                  </span>
                  <textarea
                    rows={3}
                    value={noteModification}
                    onChange={(e) => setNoteModification(e.target.value)}
                    maxLength={LONGUEUR_MAX_NOTE}
                    required={noteObligatoire}
                  />
                </label>
              </div>
            )}

            <div className="page-demande-dpae__actions">
              {modification && (
                <button type="button" onClick={() => navigate(`/rh/dpae/${demande.id}`)} disabled={envoiEnCours}>
                  Annuler
                </button>
              )}
              <button type="submit" disabled={!formulaireCompletHorsSites || envoiEnCours}>
                {modification
                  ? envoiEnCours
                    ? 'Enregistrement…'
                    : 'Enregistrer les modifications'
                  : envoiEnCours
                    ? 'Envoi…'
                    : libelleEnvoi}
              </button>
            </div>
          </fieldset>
        </form>
      </div>
    </PageBackOffice>
  );
}

// Chargement de la demande à modifier, puis le même formulaire prérempli. `key` = id + version : une
// demande rechargée (après un 409) réinitialise le formulaire avec ses valeurs à jour.
function ModificationDemandeDpae({ demandeId }) {
  const [demande, setDemande] = useState(null);
  const [erreur, setErreur] = useState(null);

  const charger = () => {
    setErreur(null);
    return obtenirDemande(demandeId)
      .then(setDemande)
      .catch(() => setErreur('Impossible de récupérer cette demande.'));
  };

  useEffect(() => {
    charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demandeId]);

  if (erreur || !demande) {
    return (
      <PageBackOffice>
        {erreur ? <p role="alert">{erreur}</p> : <p>Chargement…</p>}
      </PageBackOffice>
    );
  }
  return <FormulaireDemandeDpae key={`${demande.id}-${demande.version}`} demande={demande} onRecharger={charger} />;
}

// Page « Nouvelle demande DPAE » (sans identifiant dans l'adresse) ou « Modifier la demande »
// (/coordination/dpae/:demandeId/modifier) — un seul composant de formulaire pour les deux.
export default function DemandeDpae() {
  const { demandeId } = useParams();
  return demandeId ? <ModificationDemandeDpae demandeId={demandeId} /> : <FormulaireDemandeDpae />;
}
