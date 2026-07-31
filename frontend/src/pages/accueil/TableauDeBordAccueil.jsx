import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import DossierList from '../../core/dossier/DossierList';
import FiltresStatut from '../../core/dossier/FiltresStatut';
import FiltresRechercheDossiers from '../../core/dossier/FiltresRechercheDossiers';
import { filtrerDossiers } from '../../core/dossier/filtrerDossiers';
import ModalePlanificationTest from '../../core/dossier/ModalePlanificationTest';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import { useSession } from '../../core/auth/useSession';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import { listerDossiers, listerStatuts } from '../../services/dossierService';
import './TableauDeBordAccueil.css';

// Code de la transition qui replanifie un test après un désistement (test_non_realise) ou un
// test invalidé (workflow v3 : les deux origines partagent ce même codeAction, vers
// test_planifie, voir workflow.config.json ACCECIT) — voir ModalePlanificationTest.jsx, qui ne
// connaît lui-même aucun statut ni codeAction en dur, c'est cette page qui décide depuis quelle
// action elle l'ouvre. Le moteur de transitions (workflowEngine.appliquerTransition) résout la
// bonne ligne transitions_statut à partir du statut réel du dossier, jamais choisie ici.
const CODE_ACTION_REPLANIFIER_TEST = 'replanifier_test';

// Statuts depuis lesquels le bouton "Replanifier" est proposé (voir Modularité, CLAUDE.md : reste
// propre à cette page/entité, pas au moteur générique DossierList). "invalide" remplace
// "verdict_negatif" (workflow v3, verdict_negatif retiré du parcours actif). "test_planifie"
// ajouté (workflow v4, retrait de en_attente_verdict, responsable de projet, 2026-07-31) : la
// replanification doit rester possible à tout moment tant que le dossier est encore test_planifie
// (pas de restriction de délai) — le codeAction replanifier_test porte alors une transition vers
// ce même statut (voir workflow.config.json), pas un changement d'état à proprement parler.
const STATUTS_REPLANIFIABLES = ['test_planifie', 'test_non_realise', 'invalide'];

// Statuts pour lesquels le bouton "Relances" a un sens concret pour l'agent Accueil — au-delà
// (dossier transmis au recruteur, verdict rendu, décision finale prise), la relance sort de son
// périmètre d'action, même logique de restriction que STATUTS_REPLANIFIABLES ci-dessus. Liste
// explicite plutôt que des conditions if/else dispersées dans le JSX : un seul endroit à modifier
// si le périmètre change, cohérent avec les autres listes de cette page (CODES_STATUTS_FILTRES_
// ACCUEIL, STATUTS_REPLANIFIABLES). "Pièces", lui, reste affiché pour tous les statuts sans
// exception (consultation des pièces déjà capturées toujours possible, même hors périmètre) —
// pas de `visible` sur cette action.
// "nouveau" volontairement absent : les inscriptions se font en agence, un dossier encore à ce
// statut signifie que l'agent n'a pas encore scanné les pièces (session interrompue ou en
// attente) — la reprise se fait via "Pièces", pas "Relances".
// "invalide" ajouté (workflow v3) : même logique que test_non_realise, une relance a un sens tant
// qu'une replanification est possible sur ce dossier.
const STATUTS_RELANCES_AUTORISEES = ['en_attente_pieces', 'test_planifie', 'test_non_realise', 'invalide'];

// Mapping purement visuel, propre à cette page (pas au moteur générique DossierList/StatutBadge,
// voir Modularité CLAUDE.md) — donnée de test locale au même titre que
// formulaireConfig.accecit.js le temps que `statuts` porte une polarité succès/échec/attente en
// base : un code absent de ce mapping (autre entité, nouveau statut) retombe simplement sur un
// badge neutre plutôt que d'échouer.
// Une variante distincte par statut (voir styles/variables.css, --statut-*) plutôt que les 4
// polarités génériques seules : avec seulement neutre/attente/succes/echec, la plupart des 10
// statuts ACCECIT retombaient sur "neutre" (gris) faute d'entrée dans ce mapping, rendant des
// statuts pourtant très différents indiscernables au premier coup d'œil sur la liste.
const VARIANTE_PAR_CODE_ACCECIT = {
  nouveau: 'neutre',
  en_attente_pieces: 'attente',
  en_attente_verification: 'attente', // workflow hérité, plus jamais atteint (voir CODES_STATUTS_FILTRES_ACCUEIL)
  test_planifie: 'bleu',
  test_non_realise: 'alerte',
  invalide: 'echec',
  en_attente_validation_recruteur: 'dore', // workflow v3, temporaire (voir migrerWorkflowAccecitV3.js)
  valide: 'succes', // workflow v3, temporaire (voir migrerWorkflowAccecitV3.js)
  rejete: 'echec-fort',
  valide_envoi_formation: 'vert-clair',
  valide_pret_embauche: 'succes',
};
function varianteStatut(code) {
  return VARIANTE_PAR_CODE_ACCECIT[code] ?? 'neutre';
}

// Sous-ensemble des statuts proposés comme filtres sur cette page (accueil : dossiers à traiter
// avant l'envoi en test) — propre à cette page, pas au moteur générique FiltresStatut.jsx qui
// reste piloté entièrement par la prop `statuts` qu'on lui passe. "En attente de vérification"
// (workflow hérité, plus jamais atteint) n'y figure volontairement pas.
const CODES_STATUTS_FILTRES_ACCUEIL = [
  'nouveau',
  'en_attente_pieces',
  'test_planifie',
  'test_non_realise',
  // Ajouté avec le bouton "Replanifier" (voir STATUTS_REPLANIFIABLES ci-dessous) : permet à
  // l'accueil d'isoler d'un coup les dossiers en attente de replanification après un test
  // invalidé, sans devoir les repérer dans la liste complète. "invalide" remplace
  // "verdict_negatif" (workflow v3, verdict_negatif retiré du parcours actif).
  'invalide',
];

// Tableau de bord Accueil (CLAUDE.md, besoins Accueil/Coordination : "vue centralisée des
// dossiers en attente") — liste les dossiers de l'entité courante, filtrables par statut. Jusqu'à
// trois actions par ligne : reprendre la prise de pièces (VerificationPieces, tous statuts),
// consulter/enregistrer une relance (Relances, historique des relances — voir
// HistoriqueRelances.jsx — restreint aux statuts où une relance a un sens, voir
// STATUTS_RELANCES_AUTORISEES), et replanifier un test (voir STATUTS_REPLANIFIABLES).
export default function TableauDeBordAccueil() {
  const { utilisateur, chargement: chargementSession } = useSession();
  const navigate = useNavigate();

  const [statuts, setStatuts] = useState([]);
  const [statutFiltre, setStatutFiltre] = useState(null); // null = tous les statuts
  const [dossiers, setDossiers] = useState([]);
  const [chargementDossiers, setChargementDossiers] = useState(true);
  const [erreur, setErreur] = useState(null);

  // Recherche nom/prénom + plage de date, combinées au statutFiltre déjà géré côté serveur
  // ci-dessus — filtrage entièrement client (voir filtrerDossiers.js), la liste `dossiers` étant
  // déjà intégralement en mémoire.
  const [recherche, setRecherche] = useState('');
  const [dateDebutFiltre, setDateDebutFiltre] = useState('');
  const [dateFinFiltre, setDateFinFiltre] = useState('');

  // Dossier sélectionné pour une replanification, ou null si le panneau est fermé — voir bouton
  // "Replanifier" plus bas et ModalePlanificationTest.jsx.
  const [dossierAReplanifier, setDossierAReplanifier] = useState(null);

  useEffect(() => {
    listerStatuts()
      .then(setStatuts)
      .catch(() => {
        // Filtres non critiques : la liste des dossiers ci-dessous reste consultable même si
        // ce second appel échoue, donc pas de message d'erreur bloquant pour si peu.
      });
  }, []);

  useEffect(() => {
    let annule = false;
    setChargementDossiers(true);
    setErreur(null);
    listerDossiers({ statut: statutFiltre })
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
  }, [statutFiltre]);

  // Rechargement manuel après une replanification réussie (voir plus bas) : le dossier a changé
  // de statut (→ test_planifie), il doit soit disparaître de la vue filtrée courante, soit voir
  // son badge de statut mis à jour — un simple retrait local serait incorrect si le filtre actif
  // est justement "Test planifié".
  const rechargerDossiers = () => {
    listerDossiers({ statut: statutFiltre })
      .then(setDossiers)
      .catch((erreur) => setErreur(erreur.response?.data?.erreur ?? 'Impossible de récupérer les dossiers.'));
  };

  const dossiersFiltres = useMemo(
    () => filtrerDossiers(dossiers, { recherche, dateDebutFiltre, dateFinFiltre }),
    [dossiers, recherche, dateDebutFiltre, dateFinFiltre],
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
          <Link to="/coordination/planification" className="tableau-bord-accueil__lien-planification">
            Planification des tests
          </Link>
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
        <FiltresStatut statuts={statutsFiltres} statutFiltre={statutFiltre} onChangerStatutFiltre={setStatutFiltre} />

        {chargementDossiers && <p>Chargement des dossiers…</p>}
        {erreur && <p role="alert">{erreur}</p>}

        {!chargementDossiers && !erreur && (
          <DossierList
            dossiers={dossiersFiltres}
            varianteStatut={varianteStatut}
            actions={[
              { libelle: 'Pièces', onSelectionner: (dossier) => navigate(`/accueil/dossiers/${dossier.id}/pieces`) },
              {
                libelle: 'Relances',
                onSelectionner: (dossier) => navigate(`/coordination/dossiers/${dossier.id}/relances`),
                visible: (dossier) => STATUTS_RELANCES_AUTORISEES.includes(dossier.statut_code),
              },
              {
                libelle: 'Replanifier',
                onSelectionner: (dossier) => setDossierAReplanifier(dossier),
                visible: (dossier) => STATUTS_REPLANIFIABLES.includes(dossier.statut_code),
              },
            ]}
          />
        )}

        {dossierAReplanifier && (
          <ModalePlanificationTest
            dossierId={dossierAReplanifier.id}
            codeAction={CODE_ACTION_REPLANIFIER_TEST}
            titre={`Replanifier un test — ${dossierAReplanifier.candidat_prenom} ${dossierAReplanifier.candidat_nom}`}
            onAnnuler={() => setDossierAReplanifier(null)}
            onReussite={() => {
              setDossierAReplanifier(null);
              rechargerDossiers();
            }}
          />
        )}
      </div>
    </PageBackOffice>
  );
}
