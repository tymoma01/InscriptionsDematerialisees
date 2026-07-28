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
// verdict négatif (workflow.config.json ACCECIT : les deux origines partagent ce même codeAction,
// vers test_planifie) — voir ModalePlanificationTest.jsx, qui ne connaît lui-même aucun statut ni
// codeAction en dur, c'est cette page qui décide depuis quelle action elle l'ouvre. Le moteur de
// transitions (workflowEngine.appliquerTransition) résout la bonne ligne transitions_statut à
// partir du statut réel du dossier, jamais choisie ici.
const CODE_ACTION_REPLANIFIER_TEST = 'replanifier_test';

// Statuts depuis lesquels le bouton "Replanifier" est proposé (voir Modularité, CLAUDE.md : reste
// propre à cette page/entité, pas au moteur générique DossierList).
const STATUTS_REPLANIFIABLES = ['test_non_realise', 'verdict_negatif'];

// Mapping purement visuel, propre à cette page (pas au moteur générique DossierList/StatutBadge,
// voir Modularité CLAUDE.md) — donnée de test locale au même titre que
// formulaireConfig.accecit.js le temps que `statuts` porte une polarité succès/échec/attente en
// base : un code absent de ce mapping (autre entité, nouveau statut) retombe simplement sur un
// badge neutre plutôt que d'échouer.
const VARIANTE_PAR_CODE_ACCECIT = {
  en_attente_pieces: 'attente',
  en_attente_verification: 'attente',
  valide: 'succes',
  rejete: 'echec',
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
  // l'accueil d'isoler d'un coup les dossiers en attente de replanification après un verdict
  // négatif, sans devoir les repérer dans la liste complète.
  'verdict_negatif',
];

// Tableau de bord Accueil (CLAUDE.md, besoins Accueil/Coordination : "vue centralisée des
// dossiers en attente") — liste les dossiers de l'entité courante, filtrables par statut. Deux
// actions par ligne : reprendre la prise de pièces (VerificationPieces) et consulter/enregistrer
// une relance (Relances, historique des relances — voir HistoriqueRelances.jsx), toutes deux
// déjà câblées dans App.jsx.
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
      .catch(() => {
        if (!annule) setErreur('Impossible de récupérer les dossiers.');
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
      .catch(() => setErreur('Impossible de récupérer les dossiers.'));
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
