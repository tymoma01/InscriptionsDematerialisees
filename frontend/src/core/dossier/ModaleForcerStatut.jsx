import { useState } from 'react';
import StatutBadge from '../workflow/StatutBadge';
import './ModaleForcerStatut.css';

// Statuts exclus du forçage (bloc 3, audit 2026-09-25, décision utilisateur explicite) — MIROIR de
// STATUTS_EXCLUS_FORCAGE_* côté serveur (backend/src/core/workflow/workflowEngine.js) : dupliqué
// plutôt que partagé (convention du projet), pour ne JAMAIS proposer ces statuts dans la liste de
// choix (pas seulement les rejeter après coup au clic sur "Forcer ce statut" — le serveur reste de
// toute façon la seule source de vérité réelle, voir workflowEngine.forcerStatut).
//
// `valide`/`rejete` : hérités pour ACCECIT (ancien circuit recruteur, 0 dossier) mais restent le
// vocabulaire ACTUEL du workflow Adaptel — exclus UNIQUEMENT pour ACCECIT (voir `entiteCode`,
// nécessaire pour cette distinction, ajouté à la session au même audit — voir
// backend/src/api/routes/auth.routes.js, GET /api/auth/moi).
const STATUTS_EXCLUS_FORCAGE_TOUTES_ENTITES = [
  'en_attente_verification',
  'en_attente_verdict',
  'verdict_positif',
  'verdict_negatif',
  'en_attente_validation_recruteur',
];
const STATUTS_EXCLUS_FORCAGE_PAR_ENTITE = {
  accecit: ['valide', 'rejete'],
};
function statutsExclusForcage(entiteCode) {
  return [...STATUTS_EXCLUS_FORCAGE_TOUTES_ENTITES, ...(STATUTS_EXCLUS_FORCAGE_PAR_ENTITE[entiteCode] ?? [])];
}

// Regroupement des statuts sous des intertitres (bloc 3, décision utilisateur) — propre à ACCECIT
// (Modularité, CLAUDE.md : ce composant reste générique, `statuts` vient de n'importe quelle
// entité) : tout code absent de ces 4 groupes (ex. Adaptel, ou un futur statut ACCECIT non encore
// classé ici) atterrit sous TITRE_AUTRES_STATUTS ci-dessous plutôt que de disparaître.
const GROUPES_STATUTS_ACCECIT = [
  { titre: 'Inscription', codes: ['nouveau', 'en_attente_pieces'] },
  { titre: 'Tests', codes: ['test_non_planifie', 'test_planifie', 'test_realise', 'test_non_realise'] },
  { titre: 'Formation', codes: ['valide_envoi_formation', 'formation_non_validee', 'valide_pret_embauche'] },
  { titre: 'Issue', codes: ['embauche', 'invalide'] },
];
const TITRE_AUTRES_STATUTS = 'Autres statuts';

// Date d'embauche (audit 2026-09-25) — même statut/même champ que ModaleMarquerEmbauche.jsx
// (parcours normal) : un forçage vers "embauche" doit renseigner dossiers.date_embauche
// exactement comme le bouton "Marquer comme embauché", voir workflowEngine.forcerStatut côté
// serveur. Code en dur, comme GROUPES_STATUTS_ACCECIT/VARIANTE_PAR_CODE_ACCECIT ci-dessus (ce
// composant reste par ailleurs générique — voir Modularité, CLAUDE.md — mais cette page/action
// reste propre à ACCECIT).
const CODE_STATUT_EMBAUCHE = 'embauche';

// Mapping badge (couleur) — recopié localement plutôt que partagé avec TableauDeBordAccueil.jsx/
// Validation.jsx (même convention que ces deux fichiers, voir CLAUDE.md conventions du projet) :
// un code absent (autre entité, statut non encore coloré ici) retombe sur la variante neutre
// plutôt que d'échouer.
const VARIANTE_PAR_CODE_ACCECIT = {
  nouveau: 'neutre',
  en_attente_pieces: 'attente',
  en_attente_verification: 'attente',
  test_non_planifie: 'rose',
  test_planifie: 'bleu',
  test_realise: 'violet',
  test_non_realise: 'alerte',
  invalide: 'echec',
  valide_envoi_formation: 'succes',
  valide_pret_embauche: 'vert-clair',
  formation_non_validee: 'echec-fort',
  embauche: 'vert-fonce',
};
function varianteStatut(code) {
  return VARIANTE_PAR_CODE_ACCECIT[code] ?? 'neutre';
}

// Construit la liste des groupes à afficher (bloc 3) à partir de `statuts` (brut, GET
// /api/dossiers/statuts) : exclut STATUTS_EXCLUS_FORCAGE_* SAUF si le code est le statut ACTUEL du
// dossier (celui-ci doit toujours être visible, marqué "Statut actuel", même s'il s'agit d'un
// statut hérité qu'on ne pourrait plus choisir comme CIBLE — voir estActuel ci-dessous). Un seul
// passage : chaque statut affiché est rangé dans son groupe nommé (ordre de GROUPES_STATUTS_ACCECIT
// respecté, jamais l'ordre brut de `statuts`) ou, à défaut, sous "Autres statuts" (ordre de
// `statuts`, donc `ordre` en base — colonne déjà triée par dossierRepository.listerStatuts).
function construireGroupesAffiches(statuts, dossier, entiteCode) {
  const exclus = statutsExclusForcage(entiteCode);
  const statutsAffiches = statuts
    .filter((statut) => statut.code === dossier.statut_code || !exclus.includes(statut.code))
    .map((statut) => ({ ...statut, estActuel: statut.code === dossier.statut_code }));

  const codesDejaGroupes = new Set();
  const groupes = GROUPES_STATUTS_ACCECIT.map(({ titre, codes }) => ({
    titre,
    statuts: codes
      .map((code) => statutsAffiches.find((statut) => statut.code === code))
      .filter(Boolean)
      .map((statut) => {
        codesDejaGroupes.add(statut.code);
        return statut;
      }),
  })).filter((groupe) => groupe.statuts.length > 0);

  const autres = statutsAffiches.filter((statut) => !codesDejaGroupes.has(statut.code));
  if (autres.length > 0) {
    groupes.push({ titre: TITRE_AUTRES_STATUTS, statuts: autres });
  }

  return groupes;
}

// Confirmation du changement de statut manuel/forcé (audit RBAC 2026-08-31, décision utilisateur ;
// liste de choix mise en forme — bloc 3, audit 2026-09-25, remplace le <select> natif) — même
// patron que ModaleResultatFormation.jsx (pages/coordination/) : commentaire OBLIGATOIRE, bouton de
// confirmation désactivé tant que le formulaire n'est pas valide. `entiteCode` (bloc 3) : seule
// donnée propre à ACCECIT reçue en prop plutôt que dérivée de `statuts` — nécessaire pour
// statutsExclusForcage ci-dessus, voir son commentaire.
export default function ModaleForcerStatut({ dossier, statuts, entiteCode, onConfirmer, onAnnuler, enCours, erreur }) {
  const [statutCode, setStatutCode] = useState('');
  const [commentaire, setCommentaire] = useState('');
  const [dateEmbauche, setDateEmbauche] = useState('');

  const groupes = construireGroupesAffiches(statuts, dossier, entiteCode);
  const estStatutEmbauche = statutCode === CODE_STATUT_EMBAUCHE;

  const confirmer = (evenement) => {
    evenement.preventDefault();
    if (!statutCode || !commentaire.trim() || (estStatutEmbauche && !dateEmbauche)) return;
    onConfirmer(statutCode, commentaire.trim(), estStatutEmbauche ? dateEmbauche : undefined);
  };

  return (
    <div className="modale-forcer-statut__fond">
      <div className="modale-forcer-statut" role="dialog" aria-label="Forcer le statut du dossier">
        <h2>Forcer le statut du dossier</h2>
        <p>
          <span className="modale-forcer-statut__accent">
            #{dossier.id} {dossier.candidat_prenom} {dossier.candidat_nom}
          </span>
        </p>
        <p className="modale-forcer-statut__avertissement" role="alert">
          Cette action contourne le parcours normal du dossier : aucune vérification d&rsquo;étape
          n&rsquo;est effectuée, et le seul effet de bord est l&rsquo;annulation d&rsquo;un éventuel
          rendez-vous actif, si le statut choisi le prévoit. Réservez-la aux cas exceptionnels et
          indiquez-en la raison ci-dessous : elle sera tracée dans le journal d&rsquo;audit.
        </p>

        <form onSubmit={confirmer}>
          {/* Groupe de boutons radio stylés (bloc 3 ; réajusté sans défilement interne, audit
              2026-09-25 suite) : accessible au clavier nativement (flèches haut/bas pour naviguer,
              même `name` pour tous les radios quel que soit leur groupe visuel). `role="group"` +
              `aria-labelledby` par étape plutôt que <fieldset>/<legend> : <legend> ne se comporte
              pas de façon fiable dans un conteneur flex selon les navigateurs (n'aurait pas permis
              l'alignement "intertitre à gauche, badges à droite sur la même ligne" demandé) — même
              sémantique de groupement pour les lecteurs d'écran, juste sans le rendu par défaut du
              navigateur. */}
          <div className="modale-forcer-statut__choix-liste" role="radiogroup" aria-label="Nouveau statut">
            {groupes.map((groupe) => {
              const idTitre = `modale-forcer-statut-groupe-${groupe.titre.toLowerCase().replace(/\s+/g, '-')}`;
              return (
                <div key={groupe.titre} className="modale-forcer-statut__groupe" role="group" aria-labelledby={idTitre}>
                  <span id={idTitre} className="modale-forcer-statut__titre-groupe">
                    {groupe.titre}
                  </span>
                  <div className="modale-forcer-statut__badges-groupe">
                    {groupe.statuts.map((statut) => {
                      const estSelectionne = statutCode === statut.code;
                      return (
                        <label
                          key={statut.code}
                          className={
                            'modale-forcer-statut__choix' +
                            (statut.estActuel ? ' modale-forcer-statut__choix--actuel' : '') +
                            (estSelectionne ? ' modale-forcer-statut__choix--selectionne' : '')
                          }
                          // Couleur du statut réutilisée pour le contour de sélection (voir CSS,
                          // .modale-forcer-statut__choix--selectionne) — même variable que celle
                          // que StatutBadge lit déjà pour sa propre bordure (variables.css,
                          // --statut-<variante>-bordure), jamais une couleur générique inventée ici.
                          style={{ '--couleur-choix': `var(--statut-${varianteStatut(statut.code)}-bordure)` }}
                        >
                          <input
                            type="radio"
                            name="statutCode"
                            value={statut.code}
                            checked={estSelectionne}
                            disabled={statut.estActuel}
                            onChange={(evenement) => setStatutCode(evenement.target.value)}
                            required
                          />
                          {estSelectionne && (
                            <span className="modale-forcer-statut__coche" aria-hidden="true">
                              ✓
                            </span>
                          )}
                          <StatutBadge libelle={statut.libelle} variante={varianteStatut(statut.code)} />
                          {statut.estActuel && <span className="modale-forcer-statut__etiquette-actuel">(actuel)</span>}
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Date d'embauche (audit 2026-09-25) — UNIQUEMENT quand le statut choisi est
              "embauche", même présentation que ModaleMarquerEmbauche.jsx (parcours normal) : pas
              de `min`/`max` (une date future reste un cas d'usage légitime, voir son commentaire
              d'en-tête). Placée AU-DESSUS du motif, comme demandé. */}
          {estStatutEmbauche && (
            <label>
              <span>Date d&rsquo;embauche</span>
              <input
                type="date"
                value={dateEmbauche}
                onChange={(evenement) => setDateEmbauche(evenement.target.value)}
                required
              />
            </label>
          )}

          <label>
            <span>Motif du changement forcé (obligatoire)</span>
            <textarea value={commentaire} onChange={(evenement) => setCommentaire(evenement.target.value)} rows={3} />
          </label>

          {erreur && <p role="alert">{erreur}</p>}

          <div className="modale-forcer-statut__actions">
            <button type="button" onClick={onAnnuler} disabled={enCours}>
              Annuler
            </button>
            <button
              type="submit"
              disabled={enCours || !statutCode || !commentaire.trim() || (estStatutEmbauche && !dateEmbauche)}
            >
              {enCours ? 'Enregistrement...' : 'Forcer ce statut'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
