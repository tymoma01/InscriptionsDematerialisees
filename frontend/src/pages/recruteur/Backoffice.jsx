import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import DossierList from '../../core/dossier/DossierList';
import FiltresStatut from '../../core/dossier/FiltresStatut';
import FiltresRechercheDossiers from '../../core/dossier/FiltresRechercheDossiers';
import { filtrerDossiers } from '../../core/dossier/filtrerDossiers';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import { useSession } from '../../core/auth/useSession';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import { listerDossiers, listerStatuts } from '../../services/dossierService';
import './Backoffice.css';

// Mapping purement visuel, propre à cette page (pas au moteur générique DossierList/StatutBadge,
// voir Modularité CLAUDE.md) — même donnée de test locale que TableauDeBordAccueil.jsx, le temps
// que `statuts` porte une polarité succès/échec/attente en base.
// Une variante distincte par statut (voir styles/variables.css, --statut-*) plutôt que les 4
// polarités génériques seules — même mapping que TableauDeBordAccueil.jsx (dupliqué plutôt que
// partagé : quelques lignes de données, pas de quoi justifier un module commun, voir CLAUDE.md
// conventions du projet).
const VARIANTE_PAR_CODE_ACCECIT = {
  nouveau: 'neutre',
  en_attente_pieces: 'attente',
  en_attente_verification: 'attente', // workflow hérité, plus jamais atteint
  test_planifie: 'bleu',
  test_non_realise: 'alerte',
  en_attente_verdict: 'violet',
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

// Sous-ensemble des statuts proposés comme filtres sur cette page (recruteur : dossiers du test
// jusqu'à la décision finale) — propre à cette page, pas au moteur générique FiltresStatut.jsx qui
// reste piloté entièrement par la prop `statuts` qu'on lui passe. "En attente de vérification"
// (workflow hérité, plus jamais atteint) n'y figure volontairement pas.
const CODES_STATUTS_FILTRES_RECRUTEUR = [
  'test_planifie',
  'en_attente_verdict',
  // en_attente_validation_recruteur/valide : workflow v3, temporaires (2 dossiers encore en cours
  // via l'ancien circuit, voir migrerWorkflowAccecitV3.js) — à retirer une fois ces dossiers clos.
  'en_attente_validation_recruteur',
  'valide',
  'rejete',
  'valide_envoi_formation',
  'valide_pret_embauche',
];

// Back-office recruteur (CLAUDE.md, section Rôles : "back-office complet") — liste des dossiers
// de l'entité courante, filtrables par statut, même moteur générique que le tableau de bord
// Accueil (DossierList/dossierService).
// "Étudier le dossier" renvoie vers Validation.jsx : depuis le workflow v3, la décision finale
// (validé/refusé, orientation formation/embauche) est prise directement par le formateur à
// l'issue du test — cette page reste une vue de consultation (pièces, historique, notes) pour le
// recruteur, plus un écran de décision (sauf pour les 2 derniers dossiers de l'ancien circuit,
// voir migrerWorkflowAccecitV3.js).
export default function Backoffice() {
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

  const dossiersFiltres = useMemo(
    () => filtrerDossiers(dossiers, { recherche, dateDebutFiltre, dateFinFiltre }),
    [dossiers, recherche, dateDebutFiltre, dateFinFiltre],
  );

  const statutsFiltres = useMemo(
    () => statuts.filter((statut) => CODES_STATUTS_FILTRES_RECRUTEUR.includes(statut.code)),
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
  // vaut le dire tout de suite (même principe que TableauDeBordAccueil.jsx).
  if (!utilisateur) {
    return (
      <PageBackOffice>
        <p role="alert">
          Vous devez être connecté pour accéder au back-office. <Link to="/connexion">Se connecter</Link>
        </p>
      </PageBackOffice>
    );
  }

  return (
    <PageBackOffice>
      <div className="backoffice-recruteur">
        <header className="backoffice-recruteur__entete">
          <h1>Back-office recruteur</h1>
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
              {
                libelle: 'Étudier le dossier',
                onSelectionner: (dossier) => navigate(`/recruteur/dossiers/${dossier.id}/validation`),
              },
            ]}
          />
        )}
      </div>
    </PageBackOffice>
  );
}
