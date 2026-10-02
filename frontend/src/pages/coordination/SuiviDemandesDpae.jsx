import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import StatutBadge from '../../core/workflow/StatutBadge';
import { useSession } from '../../core/auth/useSession';
import { useParametreURL } from '../../core/filtres/useParametreURL';
import { peut } from '../../core/auth/permissions';
import { listerSuiviDemandes } from '../../services/dpaeService';
import { useRafraichissementAuto } from '../../core/dossier/useRafraichissementAuto';
import { libelleStatutDpae, varianteStatutDpae } from '../../core/dpae/statutsDpae';
import {
  ActionTelechargementPdfDpae,
  CaseDemandeDpae,
  CaseToutCocherDpae,
  usePeutTelechargerPdfDpae,
  useSelectionDemandesDpae,
} from '../../core/dpae/TelechargementPdfDpae';
import PastilleUrgenceDpae from '../../core/dpae/PastilleUrgenceDpae';
import { formaterJour, libelleSites } from '../../core/dpae/affichageDpae';
import './SuiviDemandesDpae.css';

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

// Libellé et couleur des statuts : source unique core/dpae/statutsDpae.js.

// « Premier jour » et « Site(s) d'affectation » : core/dpae/affichageDpae.js (source unique,
// partagée avec la liste RH depuis le 2026-10-02).

// Page « Suivi des demandes DPAE » — alimentée par
// GET /api/dpae/suivi (remplace GET /mes-demandes, qui ne renvoyait que les demandes de
// l'utilisateur connecté : liste vide pour un Admin qui n'en avait créé aucune).
// - Admin et RH : filtre « Mes demandes / Toutes » (par défaut Toutes, persisté dans l'URL) ;
//   Planning aussi (depuis le 2026-09-30, voir permissions.js dpaeConsultationToutes).
// - Plus récentes d'abord (tri serveur). Clic sur une ligne (ou Entrée) : fiche de la demande.
// - « + Nouvelle demande » : seulement pour les rôles qui peuvent créer (Planning, Admin).
// Rafraîchissement auto (useRafraichissementAuto) pour voir une validation/un rejet RH sans
// recharger la page.
export default function SuiviDemandesDpae() {
  const navigate = useNavigate();
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
  const selectionDemandes = useSelectionDemandesDpae(demandes);

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

  const ouvrirFiche = (demandeId) => navigate(`/rh/dpae/${demandeId}`);

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

        {!chargement && demandes.length > 0 && peutTelechargerPdf && <ActionTelechargementPdfDpae selectionDemandes={selectionDemandes} />}

        {!chargement && demandes.length > 0 && (
          <table className="page-suivi-dpae__table">
            <thead>
              <tr>
                {peutTelechargerPdf && (
                  <th className="telechargement-pdf-dpae__colonne-case">
                    <CaseToutCocherDpae selectionDemandes={selectionDemandes} />
                  </th>
                )}
                <th>Date de la demande</th>
                <th>Salarié</th>
                <th>Site(s) d&rsquo;affectation</th>
                <th>Type de contrat</th>
                <th>Premier jour</th>
                <th>Demandeur</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {demandes.map((demande) => (
                <tr
                  key={demande.id}
                  className="page-suivi-dpae__ligne"
                  tabIndex={0}
                  onClick={() => ouvrirFiche(demande.id)}
                  onKeyDown={(evenement) => {
                    if (evenement.key === 'Enter') ouvrirFiche(demande.id);
                  }}
                  aria-label={`Ouvrir la demande de ${demande.salarie_nom} ${demande.salarie_prenom}`}
                >
                  {peutTelechargerPdf && (
                    <td className="telechargement-pdf-dpae__colonne-case">
                      <CaseDemandeDpae selectionDemandes={selectionDemandes} demande={demande} />
                    </td>
                  )}
                  <td>{FORMAT_DATE.format(new Date(demande.date_creation))}</td>
                  <td>
                    {demande.salarie_nom} {demande.salarie_prenom}
                  </td>
                  <td>{libelleSites(demande)}</td>
                  <td>{demande.type_contrat ? demande.type_contrat.toUpperCase() : '—'}</td>
                  <td>{formaterJour(demande.date_debut)}</td>
                  <td>
                    {demande.demandeur_prenom} {demande.demandeur_nom}
                  </td>
                  <td>
                    {/* Pastille d'urgence (2026-10-02) à côté du statut — « À traiter »/« En attente »
                        seulement (core/dpae/PastilleUrgenceDpae.jsx). */}
                    <div className="page-suivi-dpae__statut">
                      <StatutBadge
                        libelle={libelleStatutDpae(demande.statut)}
                        variante={varianteStatutDpae(demande.statut)}
                      />
                      <PastilleUrgenceDpae demande={demande} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PageBackOffice>
  );
}
