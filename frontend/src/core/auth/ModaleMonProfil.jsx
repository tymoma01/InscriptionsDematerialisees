import { useEffect, useState } from 'react';
import { obtenirMonProfil, mettreAJourMonProfil } from '../../services/moiService';
import './ModaleMonProfil.css';

// Self-service "Mon profil" (audit 2026-08-28, formateur/inspecteur en premier usage, voir
// pages/formateur/Evaluation.jsx et pages/inspecteur/Evaluation.jsx) — Nom/Prénom/Email/Rôle en
// lecture seule (résolus côté serveur, jamais modifiables ici), Téléphone et la préférence email
// planification modifiables séparément (bouton "Enregistrer" dédié au téléphone ; la case à cocher
// s'enregistre elle-même au clic, pas de bouton séparé — décision utilisateur). Même patron de
// modale que ModaleRelanceGroupee.jsx (fond plein écran, carte centrée), dupliqué plutôt que
// partagé (voir CLAUDE.md, conventions du projet).
export default function ModaleMonProfil({ onFermer }) {
  const [profil, setProfil] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreurChargement, setErreurChargement] = useState(null);

  // Champ local distinct de profil.telephone : ne doit être écrasé par la réponse serveur
  // qu'après un enregistrement réussi, jamais pendant la frappe (voir enregistrerTelephone).
  const [telephone, setTelephone] = useState('');
  const [enregistrementTelephoneEnCours, setEnregistrementTelephoneEnCours] = useState(false);
  const [erreurTelephone, setErreurTelephone] = useState(null);
  const [telephoneEnregistre, setTelephoneEnregistre] = useState(false);

  const [enregistrementPreferenceEnCours, setEnregistrementPreferenceEnCours] = useState(false);
  const [erreurPreference, setErreurPreference] = useState(null);

  useEffect(() => {
    let annule = false;
    obtenirMonProfil()
      .then((valeur) => {
        if (annule) return;
        setProfil(valeur);
        setTelephone(valeur.telephone ?? '');
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

  const enregistrerTelephone = async (evenement) => {
    evenement.preventDefault();
    setErreurTelephone(null);
    setTelephoneEnregistre(false);
    setEnregistrementTelephoneEnCours(true);
    try {
      const valeur = await mettreAJourMonProfil({ telephone });
      setProfil(valeur);
      setTelephone(valeur.telephone ?? '');
      setTelephoneEnregistre(true);
    } catch (erreur) {
      setErreurTelephone(
        erreur.response?.data?.erreur ?? "Impossible d'enregistrer votre numéro de téléphone. Merci de réessayer.",
      );
    } finally {
      setEnregistrementTelephoneEnCours(false);
    }
  };

  // La case affiche "Je ne souhaite pas recevoir..." (inverse de recevoirEmailPlanification) —
  // cochée doit donc envoyer recevoirEmailPlanification: false, décochée envoyer true. Enregistre
  // immédiatement au clic (pas de bouton dédié, contrairement au téléphone ci-dessus) : décision
  // utilisateur, une préférence booléenne n'a pas besoin d'une étape de validation séparée.
  const changerPreferenceEmail = async (evenement) => {
    const neSouhaitePasRecevoir = evenement.target.checked;
    setErreurPreference(null);
    setEnregistrementPreferenceEnCours(true);
    try {
      const valeur = await mettreAJourMonProfil({ recevoirEmailPlanification: !neSouhaitePasRecevoir });
      setProfil(valeur);
    } catch (erreur) {
      setErreurPreference(erreur.response?.data?.erreur ?? "Impossible d'enregistrer cette préférence. Merci de réessayer.");
    } finally {
      setEnregistrementPreferenceEnCours(false);
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
          <div className="modale-mon-profil__contenu">
            <dl className="modale-mon-profil__lecture-seule">
              <div>
                <dt>Nom</dt>
                <dd>{profil.nom}</dd>
              </div>
              <div>
                <dt>Prénom</dt>
                <dd>{profil.prenom}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{profil.email}</dd>
              </div>
              <div>
                <dt>Rôle</dt>
                <dd>{profil.roleLibelle ?? profil.roleCode}</dd>
              </div>
            </dl>

            <form className="modale-mon-profil__formulaire-telephone" onSubmit={enregistrerTelephone}>
              <label>
                <span>Téléphone</span>
                <input
                  type="tel"
                  value={telephone}
                  onChange={(evenement) => {
                    setTelephone(evenement.target.value);
                    setTelephoneEnregistre(false);
                  }}
                />
              </label>
              {erreurTelephone && <p role="alert">{erreurTelephone}</p>}
              {telephoneEnregistre && <p className="modale-mon-profil__succes">Numéro enregistré.</p>}
              <button type="submit" disabled={enregistrementTelephoneEnCours}>
                {enregistrementTelephoneEnCours ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </form>

            <label className="modale-mon-profil__case-preference">
              <input
                type="checkbox"
                checked={profil.recevoirEmailPlanification === false}
                onChange={changerPreferenceEmail}
                disabled={enregistrementPreferenceEnCours}
              />
              <span>Je ne souhaite pas recevoir de second mail de RDV des Tests</span>
            </label>
            {erreurPreference && <p role="alert">{erreurPreference}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
