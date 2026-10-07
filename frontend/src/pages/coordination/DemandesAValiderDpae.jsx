import { useEffect, useState } from 'react';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import { listerDemandesAValider } from '../../services/dpaeService';
import { useRafraichissementAuto } from '../../core/dossier/useRafraichissementAuto';
import { BarreRechercheDpae, useFiltresListeDpae } from '../../core/dpae/FiltresListeDpae';
import TableauDemandesDpae from '../../core/dpae/TableauDemandesDpae';
import './SuiviDemandesDpae.css';

// Page « Demandes à valider » (Planning et Admin) — GET /api/dpae/a-valider : les demandes des
// inspecteurs que le Planning doit transmettre à la RH ou renvoyer, « À valider par le Planning »
// puis « Renvoyée à l'inspecteur » (tri par défaut de trierParDefaut : groupes de statut, puis
// premier jour le plus proche d'abord, pastilles d'urgence comprises). Clic sur une ligne : fiche de
// la demande, où se trouvent les actions. Même tableau que le Suivi des demandes DPAE.
export default function DemandesAValiderDpae() {
  const [demandes, setDemandes] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);
  const etatFiltres = useFiltresListeDpae(demandes);

  useEffect(() => {
    let annule = false;
    listerDemandesAValider()
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
  }, []);

  useRafraichissementAuto(() => {
    listerDemandesAValider()
      .then(setDemandes)
      .catch(() => {});
  });

  return (
    <PageBackOffice>
      <div className="page-suivi-dpae">
        <header className="page-suivi-dpae__entete">
          <h1>Demandes à valider</h1>
          <EnTeteBackOffice />
        </header>

        {chargement && <p>Chargement…</p>}
        {erreur && <p role="alert">{erreur}</p>}
        {!chargement && !erreur && demandes.length === 0 && <p>Aucune demande à valider pour le moment.</p>}

        {!chargement && demandes.length > 0 && <BarreRechercheDpae etat={etatFiltres} />}
        {!chargement && demandes.length > 0 && <TableauDemandesDpae etatFiltres={etatFiltres} />}
      </div>
    </PageBackOffice>
  );
}
