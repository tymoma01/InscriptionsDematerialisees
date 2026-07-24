import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import DossierList from '../../core/dossier/DossierList';
import FiltresStatut from '../../core/dossier/FiltresStatut';
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
const VARIANTE_PAR_CODE_ACCECIT = {
  en_attente_pieces: 'attente',
  en_attente_verification: 'attente',
  valide: 'succes',
  rejete: 'echec',
};
function varianteStatut(code) {
  return VARIANTE_PAR_CODE_ACCECIT[code] ?? 'neutre';
}

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

        <FiltresStatut statuts={statuts} statutFiltre={statutFiltre} onChangerStatutFiltre={setStatutFiltre} />

        {chargementDossiers && <p>Chargement des dossiers…</p>}
        {erreur && <p role="alert">{erreur}</p>}

        {!chargementDossiers && !erreur && (
          <DossierList
            dossiers={dossiers}
            varianteStatut={varianteStatut}
            actions={[
              { libelle: 'Pièces', onSelectionner: (dossier) => navigate(`/accueil/dossiers/${dossier.id}/pieces`) },
              {
                libelle: 'Relances',
                onSelectionner: (dossier) => navigate(`/coordination/dossiers/${dossier.id}/relances`),
              },
            ]}
          />
        )}
      </div>
    </PageBackOffice>
  );
}
