import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import { useSession } from '../../core/auth/useSession';
import { useParametreURL } from '../../core/filtres/useParametreURL';
import { peut } from '../../core/auth/permissions';
import { listerSuiviDemandes } from '../../services/dpaeService';
import { useRafraichissementAuto } from '../../core/dossier/useRafraichissementAuto';
import {
  ActionTelechargementPdfDpae,
  usePeutTelechargerPdfDpae,
  useSelectionDemandesDpae,
} from '../../core/dpae/TelechargementPdfDpae';
import { BarreRechercheDpae, useFiltresListeDpae } from '../../core/dpae/FiltresListeDpae';
import TableauDemandesDpae from '../../core/dpae/TableauDemandesDpae';
import './SuiviDemandesDpae.css';

// Tableau : core/dpae/TableauDemandesDpae.jsx (colonnes, pastilles, sites condensés, tri et filtres
// par colonne), partagé avec la section « Demandes concernées » du Tableau de bord DPAE.

// Page « Suivi des demandes DPAE » — alimentée par
// GET /api/dpae/suivi (remplace GET /mes-demandes, qui ne renvoyait que les demandes de
// l'utilisateur connecté : liste vide pour un Admin qui n'en avait créé aucune).
// - Admin et RH : filtre « Mes demandes / Toutes » (par défaut Toutes, persisté dans l'URL) ;
//   Planning aussi (depuis le 2026-09-30, voir permissions.js dpaeConsultationToutes).
// - Tri par défaut commun avec la liste RH (voir plus bas). Clic sur une ligne (ou Entrée) : fiche de la demande.
// - « + Nouvelle demande » : seulement pour les rôles qui peuvent créer (Planning, Admin).
// Rafraîchissement auto (useRafraichissementAuto) pour voir une validation/un rejet RH sans
// recharger la page.
export default function SuiviDemandesDpae() {
  const { utilisateur } = useSession();
  const [demandes, setDemandes] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);
  const [perimetre, setPerimetre] = useParametreURL('perimetre', 'toutes');

  const peutFiltrer = peut(utilisateur, 'dpaeConsultationToutes');
  const peutCreer = peut(utilisateur, 'dpaeCreation');
  // Téléchargement PDF : cases à cocher et action groupée (ZIP), voir
  // core/dpae/TelechargementPdfDpae.jsx.
  const peutTelechargerPdf = usePeutTelechargerPdfDpae();
  // Recherche et filtres par colonne (core/dpae/FiltresListeDpae.jsx, partagés avec la liste RH).
  // Ordre d'ouverture : tri par défaut commun aux deux listes (trierParDefaut,
  // core/dpae/listeDemandesDpae.js), quel que soit le périmètre « Toutes »/« Mes demandes ». Les cases à cocher et le
  // téléchargement PDF ne portent que sur les demandes visibles après filtrage.
  const etatFiltres = useFiltresListeDpae(demandes);
  const demandesAffichees = etatFiltres.demandesVisibles;
  const selectionDemandes = useSelectionDemandesDpae(demandesAffichees);

  useEffect(() => {
    let annule = false;
    setChargement(true);
    setErreur(null);
    listerSuiviDemandes(perimetre)
      .then((valeur) => {
        if (!annule) setDemandes(valeur);
      })
      .catch(() => {
        if (!annule) setErreur('Impossible de récupérer les demandes.');
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, [perimetre]);

  useRafraichissementAuto(() => {
    listerSuiviDemandes(perimetre)
      .then(setDemandes)
      .catch(() => {});
  });


  return (
    <PageBackOffice>
      <div className="page-suivi-dpae">
        <header className="page-suivi-dpae__entete">
          <h1>Suivi des demandes DPAE</h1>
          <EnTeteBackOffice />
        </header>

        <div className="page-suivi-dpae__actions">
          {peutFiltrer && (
            <div className="page-suivi-dpae__filtre" role="group" aria-label="Demandes affichées">
              <button type="button" className={perimetre === 'mes' ? 'actif' : ''} aria-pressed={perimetre === 'mes'} onClick={() => setPerimetre('mes')}>
                Mes demandes
              </button>
              <button
                type="button"
                className={perimetre !== 'mes' ? 'actif' : ''}
                aria-pressed={perimetre !== 'mes'}
                onClick={() => setPerimetre('toutes')}
              >
                Toutes
              </button>
            </div>
          )}
          {peutCreer && (
            <Link to="/coordination/dpae/nouvelle" className="page-suivi-dpae__nouvelle">
              + Nouvelle demande
            </Link>
          )}
        </div>

        {chargement && <p>Chargement…</p>}
        {erreur && <p role="alert">{erreur}</p>}
        {!chargement && !erreur && demandes.length === 0 && <p>Aucune demande DPAE pour le moment.</p>}

        {!chargement && demandes.length > 0 && <BarreRechercheDpae etat={etatFiltres} />}

        {!chargement && demandes.length > 0 && peutTelechargerPdf && <ActionTelechargementPdfDpae selectionDemandes={selectionDemandes} />}

        {!chargement && demandes.length > 0 && (
          <TableauDemandesDpae etatFiltres={etatFiltres} selectionDemandes={peutTelechargerPdf ? selectionDemandes : null} />
        )}
      </div>
    </PageBackOffice>
  );
}
