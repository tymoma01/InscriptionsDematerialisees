import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import StatutBadge from '../../core/workflow/StatutBadge';
import FiltresStatut from '../../core/dossier/FiltresStatut';
import { listerDemandesRh } from '../../services/dpaeService';
import { useRafraichissementAuto } from '../../core/dossier/useRafraichissementAuto';
import { STATUTS_DPAE, STATUT_INITIAL, libelleStatutDpae, varianteStatutDpae } from '../../core/dpae/statutsDpae';
import {
  ActionTelechargementPdfDpae,
  CaseDemandeDpae,
  CaseToutCocherDpae,
  usePeutTelechargerPdfDpae,
  useSelectionDemandesDpae,
} from '../../core/dpae/TelechargementPdfDpae';
import PastilleUrgenceDpae from '../../core/dpae/PastilleUrgenceDpae';
import { formaterJour, libelleTypeDemande } from '../../core/dpae/affichageDpae';
import {
  BarreRechercheDpae,
  EnTeteColonneDpae,
  SitesDemandeDpae,
  useFiltresListeDpae,
} from '../../core/dpae/FiltresListeDpae';
import IndicateurDefilementHorizontal from '../../core/backOffice/IndicateurDefilementHorizontal';
import './TraitementDpae.css';

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// Filtre statut (demande utilisateur : "un filtre entre les demandes à traiter et celles qui le
// sont") — remplace l'ancien bouton unique bascule "file à traiter"/"historique complet" par le
// composant générique déjà utilisé partout ailleurs dans le projet pour ce même patron (statut de
// dossier, rôle/statut de compte sur Comptes utilisateurs — voir FiltresStatut.jsx). Chaque code
// correspond exactement à un statut réel de `demandes_dpae` (dpae.routes.js accepte n'importe quel
// `?statut=`, pas seulement le statut initial et 'tous' — aucun changement backend nécessaire ici).
// Libellés et couleurs : source unique core/dpae/statutsDpae.js, mêmes couleurs que
// les badges du tableau ci-dessous.
const STATUTS_FILTRABLES = STATUTS_DPAE.map(({ code, libellePluriel, variante }) => ({ code, libelle: libellePluriel, variante }));

// File RH du module Demandes DPAE — par défaut, uniquement les demandes au statut initial
// (STATUT_INITIAL, file à traiter, voir dpae.routes.js GET / sans ?statut) ; le filtre "Tous" (statutFiltre nul)
// revoit l'historique complet (?statut=tous).
export default function TraitementDpae() {
  const [demandes, setDemandes] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);
  const [statutFiltre, setStatutFiltre] = useState(STATUT_INITIAL);
  // Compteurs des pastilles : calculés sur TOUTES les demandes de l'entité (même
  // route, ?statut=tous), chargées à part — la liste affichée et son filtrage restent inchangés.
  const [toutesDemandes, setToutesDemandes] = useState(null);
  // Téléchargement PDF : cases à cocher et action groupée (ZIP), voir
  // core/dpae/TelechargementPdfDpae.jsx. « Tout cocher » ne porte que sur le filtre affiché.
  const peutTelechargerPdf = usePeutTelechargerPdfDpae();

  // Ordre d'affichage : tri par défaut commun avec le Suivi des demandes DPAE (groupes de statut ;
  // échéance croissante et retards en tête pour « À traiter »/« En attente » ; plus récentes
  // d'abord pour « Validée »/« Rejetée » — voir trierParDefaut, core/dpae/listeDemandesDpae.js).
  // Une seule pastille sélectionnée : la règle de son groupe. Un tri de colonne le remplace.
  // Recherche et filtres par colonne (core/dpae/FiltresListeDpae.jsx, partagés avec le Suivi des
  // demandes DPAE), combinés aux pastilles de statut ci-dessus. Les cases à cocher et le
  // téléchargement PDF ne portent que sur les demandes visibles après filtrage.
  const etatFiltres = useFiltresListeDpae(demandes);
  const demandesAffichees = etatFiltres.demandesVisibles;
  const selectionDemandes = useSelectionDemandesDpae(demandesAffichees);

  const chargerCompteurs = () =>
    listerDemandesRh('tous')
      .then(setToutesDemandes)
      .catch(() => {});

  const compteurs = useMemo(() => {
    if (!toutesDemandes) return undefined;
    const parStatut = {};
    for (const demande of toutesDemandes) parStatut[demande.statut] = (parStatut[demande.statut] ?? 0) + 1;
    return parStatut;
  }, [toutesDemandes]);

  const charger = (statut) => {
    setChargement(true);
    return listerDemandesRh(statut ?? 'tous')
      .then(setDemandes)
      .catch(() => setErreur('Impossible de récupérer les demandes.'))
      .finally(() => setChargement(false));
  };

  useEffect(() => {
    charger(statutFiltre);
    chargerCompteurs();
     
  }, [statutFiltre]);

  useRafraichissementAuto(() => {
    listerDemandesRh(statutFiltre ?? 'tous')
      .then(setDemandes)
      .catch(() => {});
    chargerCompteurs();
  });

  return (
    <PageBackOffice>
      <div className="page-traitement-dpae">
        <header className="page-traitement-dpae__entete">
          <h1>Demandes DPAE</h1>
          <EnTeteBackOffice />
        </header>

        <FiltresStatut
          statuts={STATUTS_FILTRABLES}
          statutFiltre={statutFiltre}
          onChangerStatutFiltre={setStatutFiltre}
          ariaLabel="Filtrer par statut de demande"
          compteurTous={toutesDemandes?.length}
          compteurs={compteurs}
        />

        {chargement && <p>Chargement…</p>}
        {erreur && <p role="alert">{erreur}</p>}
        {!chargement && !erreur && demandes.length === 0 && <p>Aucune demande pour ce filtre.</p>}

        {!chargement && demandes.length > 0 && <BarreRechercheDpae etat={etatFiltres} />}

        {!chargement && demandes.length > 0 && peutTelechargerPdf && <ActionTelechargementPdfDpae selectionDemandes={selectionDemandes} />}

        {!chargement && demandes.length > 0 && (
          <IndicateurDefilementHorizontal className="filtres-liste-dpae__defilement">
            <table className="page-traitement-dpae__table">
              <thead>
                <tr>
                  {peutTelechargerPdf && (
                    <th className="telechargement-pdf-dpae__colonne-case">
                      <CaseToutCocherDpae selectionDemandes={selectionDemandes} />
                    </th>
                  )}
                  {/* Titres cliquables : tri et filtre de la colonne (core/dpae/FiltresListeDpae.jsx). */}
                  <EnTeteColonneDpae etat={etatFiltres} cle="date_demande" libelle="Reçue le" />
                  <EnTeteColonneDpae etat={etatFiltres} cle="type_demande" libelle="Type" className="filtres-liste-dpae__colonne-type" />
                  <EnTeteColonneDpae etat={etatFiltres} cle="salarie" libelle="Salarié" />
                  <EnTeteColonneDpae etat={etatFiltres} cle="premier_jour" libelle="Premier jour" />
                  <EnTeteColonneDpae
                    etat={etatFiltres}
                    cle="sites"
                    libelle="Site(s) d’affectation"
                    className="filtres-liste-dpae__colonne-sites"
                  />
                  <EnTeteColonneDpae etat={etatFiltres} cle="demandeur" libelle="Demandeur" />
                  <EnTeteColonneDpae etat={etatFiltres} cle="statut" libelle="Statut" />
                  {/* Liens « Voir la demande » et « Fiche candidat » réunis dans une seule cellule,
                      l'un sous l'autre : la place libérée va au salarié et au demandeur. */}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {demandesAffichees.length === 0 && (
                  <tr>
                    <td colSpan={peutTelechargerPdf ? 9 : 8} className="filtres-liste-dpae__aucune">
                      Aucune demande ne correspond à la recherche ou aux filtres.
                    </td>
                  </tr>
                )}
                {demandesAffichees.map((demande) => (
                  <tr key={demande.id}>
                    {peutTelechargerPdf && (
                      <td className="telechargement-pdf-dpae__colonne-case">
                        <CaseDemandeDpae selectionDemandes={selectionDemandes} demande={demande} />
                      </td>
                    )}
                    <td>{FORMAT_DATE.format(new Date(demande.date_creation))}</td>
                    {/* Coupure possible après « / » (« Changement horaires/ affectation ») : colonne étroite. */}
                    <td className="filtres-liste-dpae__colonne-type">{libelleTypeDemande(demande).replaceAll('/', '/\u200B')}</td>
                    <td className="filtres-liste-dpae__nom filtres-liste-dpae__nom--salarie">
                      {demande.salarie_prenom} {demande.salarie_nom}
                    </td>
                    <td>{formaterJour(demande.date_debut)}</td>
                    <td className="filtres-liste-dpae__colonne-sites">
                      <SitesDemandeDpae demande={demande} />
                    </td>
                    <td className="filtres-liste-dpae__nom filtres-liste-dpae__nom--demandeur">
                      {demande.demandeur_prenom} {demande.demandeur_nom}
                    </td>
                    <td>
                      {/* Statut et pastille d'urgence (« À traiter »/« En attente » seulement) toujours
                          côte à côte (core/dpae/PastilleUrgenceDpae.jsx). */}
                      <div className="filtres-liste-dpae__statut">
                        <StatutBadge libelle={libelleStatutDpae(demande.statut)} variante={varianteStatutDpae(demande.statut)} />
                        <PastilleUrgenceDpae demande={demande} />
                      </div>
                    </td>
                    <td>
                      <div className="page-traitement-dpae__liens">
                        <Link to={`/rh/dpae/${demande.id}`}>Voir la demande</Link>
                        {/* "En un clic accéder à la fiche du candidat" (demande utilisateur) — voir le
                            commentaire équivalent de DetailDemandeDpae.jsx pour le détail de
                            dossier_id (absent si le salarié n'est pas un candidat connu du système). */}
                        {demande.dossier_id && <Link to={`/recruteur/dossiers/${demande.dossier_id}/validation`}>Fiche candidat</Link>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </IndicateurDefilementHorizontal>
        )}
      </div>
    </PageBackOffice>
  );
}
