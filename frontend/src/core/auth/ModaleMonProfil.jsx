import { useEffect, useState } from 'react';
import { obtenirMonProfil, mettreAJourMonProfil } from '../../services/moiService';
import './ModaleMonProfil.css';

// Self-service "Mon profil" (audit 2026-08-28, formateur/inspecteur en premier usage, voir
// pages/formateur/Evaluation.jsx et pages/inspecteur/Evaluation.jsx) — Nom/Prénom/Email/Rôle en
// lecture seule (résolus côté serveur, jamais modifiables ici), même patron libellé/valeur que
// InformationsInscription.css (.informations-inscription__ligne) pour rester cohérent avec le
// reste de l'app. Téléphone et la préférence email planification partagent désormais UN SEUL
// bouton "Enregistrer" en bas de modale (audit 2026-08-28, ajustement visuel : plus de sauvegarde
// immédiate au clic sur la case, ni de bouton séparé pour le téléphone) — les deux valeurs
// courantes du formulaire sont envoyées ensemble à chaque clic, que l'un des deux champs ait
// changé ou non. Même patron de modale que ModaleRelanceGroupee.jsx (fond plein écran, carte
// centrée), dupliqué plutôt que partagé (voir CLAUDE.md, conventions du projet).
export default function ModaleMonProfil({ onFermer }) {
  const [profil, setProfil] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreurChargement, setErreurChargement] = useState(null);

  // Champs locaux du formulaire, distincts de `profil` : ne doivent être écrasés par la réponse
  // serveur qu'après un enregistrement réussi, jamais pendant la saisie/le cochage.
  const [telephone, setTelephone] = useState('');
  const [neSouhaitePasRecevoir, setNeSouhaitePasRecevoir] = useState(false);

  const [enregistrementEnCours, setEnregistrementEnCours] = useState(false);
  const [erreurEnregistrement, setErreurEnregistrement] = useState(null);
  const [enregistrementReussi, setEnregistrementReussi] = useState(false);

  useEffect(() => {
    let annule = false;
    obtenirMonProfil()
      .then((valeur) => {
        if (annule) return;
        setProfil(valeur);
        setTelephone(valeur.telephone ?? '');
        // La case affiche l'inverse de recevoirEmailPlanification, voir enregistrer() ci-dessous.
        setNeSouhaitePasRecevoir(valeur.recevoirEmailPlanification === false);
      })
      .catch((erreur) => {
        if (!annule) setErreurChargement(erreur.response?.data?.erreur ?? 'Impossible de récupérer votre profil.');
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, []);

  // Un seul appel, un seul bouton (audit 2026-08-28) : envoie systématiquement les DEUX champs
  // ensemble, quel que soit celui réellement modifié — plus simple qu'un diff côté client, et le
  // backend accepte les deux valeurs même inchangées (moi.routes.js).
  const enregistrer = async (evenement) => {
    evenement.preventDefault();
    setErreurEnregistrement(null);
    setEnregistrementReussi(false);
    setEnregistrementEnCours(true);
    try {
      const valeur = await mettreAJourMonProfil({
        telephone,
        recevoirEmailPlanification: !neSouhaitePasRecevoir,
      });
      setProfil(valeur);
      setTelephone(valeur.telephone ?? '');
      setNeSouhaitePasRecevoir(valeur.recevoirEmailPlanification === false);
      setEnregistrementReussi(true);
    } catch (erreur) {
      setErreurEnregistrement(erreur.response?.data?.erreur ?? "Impossible d'enregistrer vos informations. Merci de réessayer.");
    } finally {
      setEnregistrementEnCours(false);
    }
  };

  return (
    <div className="modale-mon-profil__fond">
      <div className="modale-mon-profil" role="dialog" aria-label="Mon profil">
        <div className="modale-mon-profil__entete">
          <h2>Mon profil</h2>
          <button type="button" onClick={onFermer}>
            Fermer
          </button>
        </div>

        {chargement && <p>Chargement…</p>}
        {erreurChargement && <p role="alert">{erreurChargement}</p>}

        {!chargement && !erreurChargement && profil && (
          <form className="modale-mon-profil__contenu" onSubmit={enregistrer}>
            <div className="modale-mon-profil__groupe">
              <div className="modale-mon-profil__ligne">
                <span className="modale-mon-profil__libelle">Nom</span>
                <span className="modale-mon-profil__valeur">{profil.nom}</span>
              </div>
              <div className="modale-mon-profil__ligne">
                <span className="modale-mon-profil__libelle">Prénom</span>
                <span className="modale-mon-profil__valeur">{profil.prenom}</span>
              </div>
              <div className="modale-mon-profil__ligne">
                <span className="modale-mon-profil__libelle">Email</span>
                <span className="modale-mon-profil__valeur">{profil.email}</span>
              </div>
              <div className="modale-mon-profil__ligne">
                <span className="modale-mon-profil__libelle">Rôle</span>
                <span className="modale-mon-profil__valeur">{profil.roleLibelle ?? profil.roleCode}</span>
              </div>
            </div>

            <div className="modale-mon-profil__groupe">
              <div className="modale-mon-profil__ligne modale-mon-profil__champ">
                <span className="modale-mon-profil__libelle">Téléphone</span>
                <input type="tel" value={telephone} onChange={(evenement) => setTelephone(evenement.target.value)} />
              </div>

              {/* Uniquement Formateur/Inspecteur (audit 2026-08-28) : seuls ces deux rôles
                  reçoivent l'email personnalisé de planification (voir invitationTestService.js,
                  construireMessageEmailFormateur) — la case n'a pas de sens pour Accueil/
                  Coordination, Admin, ou tout futur rôle (ex. Suivi Formation), qui ne le reçoivent
                  jamais. Même patron ['formateur', 'inspecteur'].includes(roleCode) que
                  pages/coordination/Planification.jsx (estFormateurOuInspecteur). Champ
                  Téléphone/bouton Enregistrer ci-dessus restent affichés pour tous les rôles —
                  seule cette case est concernée. */}
              {['formateur', 'inspecteur'].includes(profil.roleCode) && (
                <label className="modale-mon-profil__case-preference">
                  <input
                    type="checkbox"
                    checked={neSouhaitePasRecevoir}
                    onChange={(evenement) => setNeSouhaitePasRecevoir(evenement.target.checked)}
                  />
                  <span>Je ne souhaite pas recevoir de second mail de RDV des Tests</span>
                </label>
              )}
            </div>

            {erreurEnregistrement && <p role="alert">{erreurEnregistrement}</p>}
            {enregistrementReussi && <p className="modale-mon-profil__succes">Profil mis à jour.</p>}

            <div className="modale-mon-profil__actions">
              <button type="submit" disabled={enregistrementEnCours}>
                {enregistrementEnCours ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
