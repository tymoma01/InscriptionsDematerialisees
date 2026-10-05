import { useNavigate } from 'react-router-dom';
import StatutBadge from '../workflow/StatutBadge';
import IndicateurDefilementHorizontal from '../backOffice/IndicateurDefilementHorizontal';
import { libelleStatutDpae, varianteStatutDpae } from './statutsDpae';
import { CaseDemandeDpae, CaseToutCocherDpae } from './TelechargementPdfDpae';
import PastilleUrgenceDpae from './PastilleUrgenceDpae';
import { formaterJour, libelleTypeContrat } from './affichageDpae';
import { EnTeteColonneDpae, SitesDemandeDpae } from './FiltresListeDpae';
import './TableauDemandesDpae.css';

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

// Tableau des demandes DPAE — extrait de « Suivi des demandes DPAE » (2026-10-02) pour être
// RÉUTILISÉ tel quel par la section « Demandes concernées » du Tableau de bord DPAE : mêmes colonnes
// (date de la demande, salarié, sites condensés, contrat, premier jour, demandeur, statut et
// pastille d'urgence), mêmes titres cliquables (tri et filtres, FiltresListeDpae.jsx), même tri par
// défaut, clic sur une ligne -> fiche de la demande.
// etatFiltres : useFiltresListeDpae(demandes) de l'appelant (recherche, filtres, tri, demandes
// visibles). selectionDemandes (facultatif) : cases à cocher pour le téléchargement PDF ; sans elle,
// aucune colonne de cases.
export default function TableauDemandesDpae({ etatFiltres, selectionDemandes = null }) {
  const navigate = useNavigate();
  const avecCases = Boolean(selectionDemandes);
  const demandesAffichees = etatFiltres.demandesVisibles;
  const ouvrirFiche = (demandeId) => navigate(`/rh/dpae/${demandeId}`);

  return (
    <IndicateurDefilementHorizontal className="filtres-liste-dpae__defilement">
      <table className="tableau-demandes-dpae__table">
        <thead>
          <tr>
            {avecCases && (
              <th className="telechargement-pdf-dpae__colonne-case">
                <CaseToutCocherDpae selectionDemandes={selectionDemandes} />
              </th>
            )}
            {/* Titres cliquables : tri et filtre de la colonne (core/dpae/FiltresListeDpae.jsx). */}
            <EnTeteColonneDpae etat={etatFiltres} cle="date_demande" libelle="Date de la demande" />
            <EnTeteColonneDpae etat={etatFiltres} cle="salarie" libelle="Salarié" />
            <EnTeteColonneDpae
              etat={etatFiltres}
              cle="sites"
              libelle="Site(s) d’affectation"
              className="filtres-liste-dpae__colonne-sites"
            />
            <EnTeteColonneDpae etat={etatFiltres} cle="type_contrat" libelle="Type de contrat" />
            <EnTeteColonneDpae etat={etatFiltres} cle="premier_jour" libelle="Premier jour" />
            <EnTeteColonneDpae etat={etatFiltres} cle="demandeur" libelle="Demandeur" />
            <EnTeteColonneDpae etat={etatFiltres} cle="statut" libelle="Statut" />
          </tr>
        </thead>
        <tbody>
          {demandesAffichees.length === 0 && (
            <tr>
              <td colSpan={avecCases ? 8 : 7} className="filtres-liste-dpae__aucune">
                Aucune demande ne correspond à la recherche ou aux filtres.
              </td>
            </tr>
          )}
          {demandesAffichees.map((demande) => (
            <tr
              key={demande.id}
              className="tableau-demandes-dpae__ligne"
              tabIndex={0}
              onClick={() => ouvrirFiche(demande.id)}
              onKeyDown={(evenement) => {
                if (evenement.key === 'Enter' && evenement.target === evenement.currentTarget) ouvrirFiche(demande.id);
              }}
              aria-label={`Ouvrir la demande de ${demande.salarie_nom} ${demande.salarie_prenom}`}
            >
              {avecCases && (
                <td className="telechargement-pdf-dpae__colonne-case">
                  <CaseDemandeDpae selectionDemandes={selectionDemandes} demande={demande} />
                </td>
              )}
              <td>{FORMAT_DATE.format(new Date(demande.date_creation))}</td>
              <td className="filtres-liste-dpae__nom filtres-liste-dpae__nom--salarie">
                {demande.salarie_nom} {demande.salarie_prenom}
              </td>
              <td className="filtres-liste-dpae__colonne-sites">
                <SitesDemandeDpae demande={demande} />
              </td>
              <td>{libelleTypeContrat(demande)}</td>
              <td>{formaterJour(demande.date_debut)}</td>
              <td className="filtres-liste-dpae__nom filtres-liste-dpae__nom--demandeur">
                {demande.demandeur_prenom} {demande.demandeur_nom}
              </td>
              <td>
                {/* Statut et pastille d'urgence (« À traiter »/« En attente » seulement) toujours
                    côte à côte (core/dpae/PastilleUrgenceDpae.jsx). */}
                <div className="filtres-liste-dpae__statut">
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
    </IndicateurDefilementHorizontal>
  );
}
