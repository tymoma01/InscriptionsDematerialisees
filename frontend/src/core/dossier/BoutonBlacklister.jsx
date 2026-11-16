import { useEffect, useState } from 'react';
import { useSession } from '../auth/useSession';
import { peut } from '../auth/permissions';
import StatutBadge from '../workflow/StatutBadge';
import { CODE_STATUT_BLACKLISTE } from '../referentiels/statutsDossier';
import { obtenirDossier } from '../../services/dossierService';
import { blacklisterDossier, retirerBlacklistDossier, listerCategoriesBlacklist } from '../../services/transitionService';
import ModaleBlacklist from './ModaleBlacklist';
import './BoutonBlacklister.css';

const CODE_STATUT_EMBAUCHE = 'embauche';

// Ce que le profil voit pour ce dossier : 'blacklister' | 'retirer' | 'blackliste' (pastille seule) | null.
// Miroir de blacklistService (le serveur reste seul juge et renvoie un message explicite en cas de refus).
export function affichageBlacklistPourDossier(utilisateur, statutCode) {
  if (!statutCode) return null;
  if (statutCode === CODE_STATUT_BLACKLISTE) return peut(utilisateur, 'retirerBlacklist') ? 'retirer' : 'blackliste';
  if (statutCode === CODE_STATUT_EMBAUCHE) return peut(utilisateur, 'blacklisterEmbauche') ? 'blacklister' : null;
  return peut(utilisateur, 'blacklister') ? 'blacklister' : null;
}

// Composant UNIQUE de blacklistage, placé dans l'en-tête de tout écran de détail d'un candidat (voir
// BoutonBlacklister.test.jsx, garde-fou). Il charge lui-même le dossier et décide seul de son
// affichage d'après le rôle et le statut ; fenêtre de confirmation, motif, messages du serveur
// (affichés tels quels, fenêtre ouverte) et API sont partagés par tous les écrans.
//
// `avertissement` : texte ajouté à la fenêtre de blacklistage (ex. évaluation non enregistrée
// abandonnée). `apresChangement` : appelé après un succès (par défaut, rechargement de la page).
export default function BoutonBlacklister({ dossierId, avertissement, apresChangement = () => window.location.reload() }) {
  const { utilisateur } = useSession();
  const [dossier, setDossier] = useState(null);
  const [categories, setCategories] = useState([]);
  const [modale, setModale] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState(null);

  useEffect(() => {
    if (!dossierId) return undefined;
    let annule = false;
    obtenirDossier(dossierId)
      .then((valeur) => {
        if (!annule) setDossier(valeur);
      })
      .catch(() => {});
    return () => {
      annule = true;
    };
  }, [dossierId]);

  useEffect(() => {
    if (!dossierId || !peut(utilisateur, 'blacklister')) return undefined;
    let annule = false;
    listerCategoriesBlacklist(dossierId)
      .then((valeur) => {
        if (!annule) setCategories(valeur);
      })
      .catch(() => {});
    return () => {
      annule = true;
    };
  }, [dossierId, utilisateur]);

  const affichage = affichageBlacklistPourDossier(utilisateur, dossier?.statut_code);
  if (!affichage) return null;

  const confirmer = async ({ motifCode, commentaire }) => {
    setEnCours(true);
    setErreur(null);
    try {
      if (modale === 'retirer') await retirerBlacklistDossier(dossierId, { commentaire });
      else await blacklisterDossier(dossierId, { motifCode, commentaire });
      setModale(null);
      apresChangement();
    } catch (echec) {
      setErreur(
        echec.response
          ? (echec.response.data?.erreur ?? 'Action impossible. Merci de réessayer.')
          : 'Connexion au serveur impossible. Vérifiez le réseau et réessayez.',
      );
    } finally {
      setEnCours(false);
    }
  };

  return (
    <>
      <span className="bouton-blacklister">
        {(affichage === 'blackliste' || affichage === 'retirer') && <StatutBadge libelle="Refus définitif" variante="blackliste" />}
        {affichage === 'blacklister' && (
          <button type="button" className="bouton-blacklister__action" onClick={() => setModale('blacklister')}>
            Refus définitif
          </button>
        )}
        {affichage === 'retirer' && (
          <button
            type="button"
            className="bouton-blacklister__action bouton-blacklister__action--retrait"
            onClick={() => setModale('retirer')}
          >
            Lever le refus définitif
          </button>
        )}
      </span>
      {modale && dossier && (
        <ModaleBlacklist
          mode={modale}
          dossier={dossier}
          categories={categories}
          avertissement={modale === 'blacklister' ? avertissement : undefined}
          enCours={enCours}
          erreur={erreur}
          onAnnuler={() => {
            setModale(null);
            setErreur(null);
          }}
          onConfirmer={confirmer}
        />
      )}
    </>
  );
}
