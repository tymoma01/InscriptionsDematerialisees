import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import StatutBadge from '../../core/workflow/StatutBadge';
import { listerMesDemandes } from '../../services/dpaeService';
import { useRafraichissementAuto } from '../../core/dossier/useRafraichissementAuto';
import './SuiviDemandesDpae.css';

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

// Mêmes 3 statuts que la migration 066 (pas de brouillon, voir demandeDpaeService.js) — variante
// purement visuelle propre à cette page (même convention que Relances.jsx/VARIANTE_PAR_CODE_ACCECIT,
// dupliquée plutôt que partagée, voir CLAUDE.md conventions du projet).
const VARIANTE_PAR_STATUT = {
  envoyee: 'attente',
  validee: 'succes',
  rejetee: 'echec',
};
const LIBELLE_PAR_STATUT = {
  envoyee: 'Envoyée',
  validee: 'Validée',
  rejetee: 'Rejetée',
};

const LIBELLE_PAR_TYPE = {
  nouvelle_embauche: 'Nouvelle embauche',
  prolongation: 'Prolongation',
  ajout_retrait_jours: 'Ajout/retrait de jours',
  passage_cdi: 'Passage CDI',
  changement_horaires_affectation: 'Changement horaires/affectation',
};

// Onglet "Suivi des demandes" de la maquette d'origine — liste des demandes DPAE créées par
// l'agent connecté, tous statuts (voir dpae.routes.js, GET /mes-demandes). Rafraîchissement auto
// même patron que TableauDeBordAccueil.jsx (useRafraichissementAuto), pour voir une validation/un
// rejet RH sans recharger la page manuellement.
export default function SuiviDemandesDpae() {
  const [demandes, setDemandes] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);

  const charger = () => {
    setChargement(true);
    return listerMesDemandes()
      .then(setDemandes)
      .catch(() => setErreur('Impossible de récupérer vos demandes.'))
      .finally(() => setChargement(false));
  };

  useEffect(() => {
    charger();
  }, []);

  useRafraichissementAuto(() => {
    listerMesDemandes()
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
          <Link to="/coordination/dpae/nouvelle" className="page-suivi-dpae__nouvelle">
            + Nouvelle demande
          </Link>
        </div>

        {chargement && <p>Chargement…</p>}
        {erreur && <p role="alert">{erreur}</p>}

        {!chargement && !erreur && demandes.length === 0 && <p>Aucune demande envoyée pour le moment.</p>}

        {!chargement && demandes.length > 0 && (
          <table className="page-suivi-dpae__table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Salarié</th>
                <th>Statut</th>
                <th>Motif de rejet</th>
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
                    <StatutBadge
                      libelle={LIBELLE_PAR_STATUT[demande.statut] ?? demande.statut}
                      variante={VARIANTE_PAR_STATUT[demande.statut] ?? 'neutre'}
                    />
                  </td>
                  <td>{demande.statut === 'rejetee' ? demande.motif_rejet : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PageBackOffice>
  );
}
