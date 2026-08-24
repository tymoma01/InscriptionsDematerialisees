import { useEffect, useState } from 'react';
import { enregistrerRelance, listerMotifsResultatRelance } from '../../services/relanceService';
import './ModaleRelanceGroupee.css';

// Mêmes canaux/règle sms-email-envoi-réel que HistoriqueRelances.jsx (formulaire individuel) —
// dupliqués ici plutôt que partagés (voir CLAUDE.md, conventions du projet) : quelques lignes de
// données, pas de quoi justifier un module commun.
const CANAUX = [
  { code: 'telephone', libelle: 'Téléphone' },
  { code: 'sms', libelle: 'SMS' },
  { code: 'email', libelle: 'Email' },
];
const CODES_RESULTAT_ENVOI_AUTOMATIQUE = ['envoye', 'echec_envoi'];

// Modale de relance groupée (barre d'actions groupées, "Dossiers candidats", audit 2026-08-24) —
// UN SEUL formulaire (Canal, Résultat, Commentaire — mêmes champs que HistoriqueRelances.jsx),
// appliqué identiquement à chaque dossier sélectionné en une seule validation : enregistre une
// relance DISTINCTE par dossier (même traçabilité que l'ajout individuel — un appel à
// POST /api/dossiers/:id/relances par dossier, jamais un endpoint groupé fictif côté back), pas
// une ligne d'historique unique partagée. Pour sms/email, chaque appel déclenche un envoi RÉEL au
// candidat correspondant (voir relanceService.js côté back) : ce formulaire envoie donc N
// messages réels à la validation, pas une simulation.
export default function ModaleRelanceGroupee({ dossiers, onFermer, onTermine }) {
  const [motifs, setMotifs] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreurChargement, setErreurChargement] = useState(null);

  const [canal, setCanal] = useState(CANAUX[0].code);
  const [resultat, setResultat] = useState('');
  const [commentaire, setCommentaire] = useState('');
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  // { [dossierId]: 'en_cours' | 'succes' | 'echec' } — état d'envoi par dossier, même principe que
  // ModaleReplanificationGroupee.jsx.
  const [statutsParDossier, setStatutsParDossier] = useState({});
  const [erreursParDossier, setErreursParDossier] = useState({});

  useEffect(() => {
    let annule = false;
    listerMotifsResultatRelance()
      .then((valeur) => {
        if (annule) return;
        setMotifs(valeur);
        const optionsTelephone = valeur.filter((motif) => !CODES_RESULTAT_ENVOI_AUTOMATIQUE.includes(motif.code));
        if (optionsTelephone.length > 0) setResultat(optionsTelephone[0].code);
      })
      .catch((erreur) => {
        if (!annule) {
          setErreurChargement(erreur.response?.data?.erreur ?? 'Impossible de récupérer les résultats de relance configurés.');
        }
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, []);

  const motifsTelephone = motifs.filter((motif) => !CODES_RESULTAT_ENVOI_AUTOMATIQUE.includes(motif.code));

  // Séquentiel (pas Promise.all) : évite une rafale de N envois SMS/email strictement simultanés
  // vers le prestataire, et permet d'afficher la progression dossier par dossier (voir le rendu).
  const soumettre = async (evenement) => {
    evenement.preventDefault();
    if (envoiEnCours || (canal === 'telephone' && !resultat)) return;
    setEnvoiEnCours(true);

    for (const dossier of dossiers) {
      // Un dossier déjà relancé avec succès (nouvelle tentative après un échec partiel) n'est
      // jamais rejoué — une seconde relance identique enverrait un second SMS/email réel au même
      // candidat.
      if (statutsParDossier[dossier.id] === 'succes') continue;
      setStatutsParDossier((precedent) => ({ ...precedent, [dossier.id]: 'en_cours' }));
      try {
        // eslint-disable-next-line no-await-in-loop
        await enregistrerRelance(dossier.id, {
          canal,
          resultat: canal === 'telephone' ? resultat : undefined,
          commentaire: commentaire.trim() || undefined,
        });
        setStatutsParDossier((precedent) => ({ ...precedent, [dossier.id]: 'succes' }));
      } catch (erreur) {
        setStatutsParDossier((precedent) => ({ ...precedent, [dossier.id]: 'echec' }));
        setErreursParDossier((precedent) => ({
          ...precedent,
          [dossier.id]: erreur.response
            ? (erreur.response.data?.erreur ?? "Le serveur n'a pas pu enregistrer cette relance.")
            : 'Connexion au serveur impossible.',
        }));
      }
    }

    setEnvoiEnCours(false);
  };

  const nombreReussites = Object.values(statutsParDossier).filter((statut) => statut === 'succes').length;
  const soumissionTerminee =
    !envoiEnCours && Object.keys(statutsParDossier).length === dossiers.length && dossiers.length > 0;
  const toutReussi = soumissionTerminee && nombreReussites === dossiers.length;

  return (
    <div className="modale-relance-groupee__fond">
      <div className="modale-relance-groupee" role="dialog" aria-label="Relances groupées">
        <div className="modale-relance-groupee__entete">
          <h2>
            Relances <span>({dossiers.length} candidats sélectionnés)</span>
          </h2>
          <button type="button" onClick={onFermer} disabled={envoiEnCours}>
            Fermer
          </button>
        </div>

        {chargement && <p>Chargement…</p>}
        {erreurChargement && <p role="alert">{erreurChargement}</p>}

        {!chargement && !erreurChargement && (
          <form className="modale-relance-groupee__formulaire" onSubmit={soumettre}>
            <ul className="modale-relance-groupee__candidats">
              {dossiers.map((dossier) => (
                <li key={dossier.id}>
                  <span>
                    N°{dossier.id} - {dossier.candidat_nom} {dossier.candidat_prenom}
                  </span>
                  {statutsParDossier[dossier.id] === 'en_cours' && <span role="status">Envoi…</span>}
                  {statutsParDossier[dossier.id] === 'succes' && (
                    <span role="status" className="modale-relance-groupee__succes">
                      ✔ Relancé
                    </span>
                  )}
                  {statutsParDossier[dossier.id] === 'echec' && (
                    <span role="alert" className="modale-relance-groupee__echec" title={erreursParDossier[dossier.id]}>
                      ✘ Échec
                    </span>
                  )}
                </li>
              ))}
            </ul>

            <label>
              <span>Canal</span>
              <select value={canal} onChange={(evenement) => setCanal(evenement.target.value)} disabled={envoiEnCours}>
                {CANAUX.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.libelle}
                  </option>
                ))}
              </select>
            </label>

            {canal === 'telephone' && (
              <label>
                <span>Résultat</span>
                <select value={resultat} onChange={(evenement) => setResultat(evenement.target.value)} disabled={envoiEnCours} required>
                  {motifsTelephone.length === 0 && <option value="">Aucun résultat configuré</option>}
                  {motifsTelephone.map((motif) => (
                    <option key={motif.code} value={motif.code}>
                      {motif.libelle}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {canal !== 'telephone' && (
              <p className="modale-relance-groupee__indication-envoi">
                {CANAUX.find((c) => c.code === canal)?.libelle} envoyé directement à chaque candidat sélectionné, au moment
                de l&rsquo;enregistrement.
              </p>
            )}

            <label className="modale-relance-groupee__champ-commentaire">
              <span>Commentaire (optionnel, identique pour tous les candidats)</span>
              <textarea
                value={commentaire}
                onChange={(evenement) => setCommentaire(evenement.target.value)}
                rows={3}
                maxLength={2000}
                disabled={envoiEnCours}
              />
            </label>

            {soumissionTerminee && (
              <p role="status" className={toutReussi ? 'modale-relance-groupee__resume-succes' : 'modale-relance-groupee__resume-echec'}>
                {nombreReussites} / {dossiers.length} relance(s) enregistrée(s).
                {!toutReussi && ' Corrigez si besoin puis validez de nouveau — les relances déjà enregistrées ne seront pas rejouées.'}
              </p>
            )}

            <div className="modale-relance-groupee__actions">
              <button type="button" onClick={onFermer} disabled={envoiEnCours}>
                {toutReussi ? 'Fermer' : 'Annuler'}
              </button>
              {!toutReussi && (
                <button type="submit" disabled={envoiEnCours || motifs.length === 0 || (canal === 'telephone' && !resultat)}>
                  {envoiEnCours ? 'Envoi...' : 'Enregistrer les relances'}
                </button>
              )}
              {toutReussi && (
                <button type="button" onClick={onTermine}>
                  Terminé
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
