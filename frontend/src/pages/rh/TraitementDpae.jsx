import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import StatutBadge from '../../core/workflow/StatutBadge';
import FiltresStatut from '../../core/dossier/FiltresStatut';
import { listerDemandesRh } from '../../services/dpaeService';
import { useRafraichissementAuto } from '../../core/dossier/useRafraichissementAuto';
import { STATUTS_DPAE, libelleStatutDpae, varianteStatutDpae } from '../../core/dpae/statutsDpae';
import './TraitementDpae.css';

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const LIBELLE_PAR_TYPE = {
  nouvelle_embauche: 'Nouvelle embauche',
  prolongation: 'Prolongation',
  ajout_retrait_jours: 'Ajout/retrait de jours',
  passage_cdi: 'Passage CDI',
  changement_horaires_affectation: 'Changement horaires/affectation',
};

// Filtre statut (demande utilisateur : "un filtre entre les demandes à traiter et celles qui le
// sont") — remplace l'ancien bouton unique bascule "file à traiter"/"historique complet" par le
// composant générique déjà utilisé partout ailleurs dans le projet pour ce même patron (statut de
// dossier, rôle/statut de compte sur Comptes utilisateurs — voir FiltresStatut.jsx). Chaque code
// correspond exactement à un statut réel de `demandes_dpae` (dpae.routes.js accepte n'importe quel
// `?statut=`, pas seulement 'envoyee'/'tous' — aucun changement backend nécessaire ici).
// Libellés et couleurs : source unique core/dpae/statutsDpae.js (2026-09-30), mêmes couleurs que
// les badges du tableau ci-dessous.
const STATUTS_FILTRABLES = STATUTS_DPAE.map(({ code, libellePluriel, variante }) => ({ code, libelle: libellePluriel, variante }));

// File RH du module Demandes DPAE (2026-09-28) — par défaut, uniquement les demandes 'envoyee'
// (file à traiter, voir dpae.routes.js GET / sans ?statut) ; le filtre "Tous" (statutFiltre nul)
// revoit l'historique complet (?statut=tous).
export default function TraitementDpae() {
  const [demandes, setDemandes] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);
  const [statutFiltre, setStatutFiltre] = useState('envoyee');
  // Compteurs des pastilles (2026-09-30) : calculés sur TOUTES les demandes de l'entité (même
  // route, ?statut=tous), chargées à part — la liste affichée et son filtrage restent inchangés.
  const [toutesDemandes, setToutesDemandes] = useState(null);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

        {!chargement && demandes.length > 0 && (
          <table className="page-traitement-dpae__table">
            <thead>
              <tr>
                <th>Reçue le</th>
                <th>Type</th>
                <th>Salarié</th>
                <th>Demandeur</th>
                <th>Statut</th>
                <th></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {demandes.map((demande) => (
                <tr key={demande.id}>
                  <td>{FORMAT_DATE.format(new Date(demande.date_creation))}</td>
                  <td>{LIBELLE_PAR_TYPE[demande.type_demande] ?? demande.type_demande}</td>
                  <td>
                    {demande.salarie_prenom} {demande.salarie_nom}
                  </td>
                  <td>
                    {demande.demandeur_prenom} {demande.demandeur_nom}
                  </td>
                  <td>
                    <StatutBadge libelle={libelleStatutDpae(demande.statut)} variante={varianteStatutDpae(demande.statut)} />
                  </td>
                  <td>
                    <Link to={`/rh/dpae/${demande.id}`}>Voir la demande</Link>
                  </td>
                  <td>
                    {/* "En un clic accéder à la fiche du candidat" (demande utilisateur) — voir le
                        commentaire équivalent de DetailDemandeDpae.jsx pour le détail de
                        dossier_id (absent si le salarié n'est pas un candidat connu du système). */}
                    {demande.dossier_id && <Link to={`/recruteur/dossiers/${demande.dossier_id}/validation`}>Fiche candidat</Link>}
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
