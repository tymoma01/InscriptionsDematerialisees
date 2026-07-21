import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import DossierList from '../../core/dossier/DossierList';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import { useSession } from '../../core/auth/useSession';
import { listerDossiers, listerStatuts } from '../../services/dossierService';
import './Backoffice.css';

// Mapping purement visuel, propre à cette page (pas au moteur générique DossierList/StatutBadge,
// voir Modularité CLAUDE.md) — même donnée de test locale que TableauDeBordAccueil.jsx, le temps
// que `statuts` porte une polarité succès/échec/attente en base.
const VARIANTE_PAR_CODE_ACCECIT = {
  en_attente_pieces: 'attente',
  en_attente_verification: 'attente',
  valide: 'succes',
  rejete: 'echec',
};
function varianteStatut(code) {
  return VARIANTE_PAR_CODE_ACCECIT[code] ?? 'neutre';
}

// Back-office recruteur (CLAUDE.md, section Rôles : "back-office complet, validation des profils,
// décision finale (validé/refusé)") — liste des dossiers de l'entité courante, filtrables par
// statut, même moteur générique que le tableau de bord Accueil (DossierList/dossierService).
// "Étudier le dossier" renvoie vers l'écran de décision (Validation.jsx), qui affiche les pièces
// justificatives et les actions de la machine à états disponibles pour ce rôle.
export default function Backoffice() {
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
    return <p>Chargement de la session…</p>;
  }

  // Le back refuserait de toute façon (401/403) sans session valide ou rôle autorisé : mieux
  // vaut le dire tout de suite (même principe que TableauDeBordAccueil.jsx).
  if (!utilisateur) {
    return (
      <p role="alert">
        Vous devez être connecté pour accéder au back-office. <Link to="/connexion">Se connecter</Link>
      </p>
    );
  }

  return (
    <main className="backoffice-recruteur">
      <header className="backoffice-recruteur__entete">
        <h1>Back-office recruteur</h1>
        <EnTeteBackOffice />
      </header>

      <nav className="backoffice-recruteur__filtres" aria-label="Filtrer par statut">
        <button
          type="button"
          className={statutFiltre === null ? 'actif' : ''}
          onClick={() => setStatutFiltre(null)}
        >
          Tous
        </button>
        {statuts.map((statut) => (
          <button
            key={statut.code}
            type="button"
            className={statutFiltre === statut.code ? 'actif' : ''}
            onClick={() => setStatutFiltre(statut.code)}
          >
            {statut.libelle}
          </button>
        ))}
      </nav>

      {chargementDossiers && <p>Chargement des dossiers…</p>}
      {erreur && <p role="alert">{erreur}</p>}

      {!chargementDossiers && !erreur && (
        <DossierList
          dossiers={dossiers}
          varianteStatut={varianteStatut}
          actions={[
            {
              libelle: 'Étudier le dossier',
              onSelectionner: (dossier) => navigate(`/recruteur/dossiers/${dossier.id}/validation`),
            },
          ]}
        />
      )}
    </main>
  );
}
