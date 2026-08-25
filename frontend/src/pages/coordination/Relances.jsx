import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import HistoriqueRelances from '../../core/dossier/HistoriqueRelances';
import GestionRendezvous from '../../core/dossier/GestionRendezvous';
import NotesDossier from '../../core/dossier/NotesDossier';
import InformationsInscription from '../../core/dossier/InformationsInscription';
import NavigationFicheDossier from '../../core/dossier/NavigationFicheDossier';
import StatutBadge from '../../core/workflow/StatutBadge';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import ErrorBoundary from '../../core/backOffice/ErrorBoundary';
import { obtenirDossier } from '../../services/dossierService';
import { useRafraichissementAuto } from '../../core/dossier/useRafraichissementAuto';
import './Relances.css';

// Mapping purement visuel, propre à cette page (pas au moteur générique StatutBadge, voir
// Modularité CLAUDE.md) — même mapping que Validation.jsx (VARIANTE_PAR_CODE_ACCECIT), dupliqué
// plutôt que partagé (voir CLAUDE.md conventions du projet) : un code absent de ce mapping (autre
// entité, nouveau statut) retombe simplement sur un badge neutre plutôt que d'échouer. Badge
// ajouté sur cette fiche (audit 2026-08-21) : le statut du dossier n'y était jusque-là visible
// nulle part, contrairement à Validation.jsx, alors que dossier.statut_code/statut_libelle est
// déjà chargé ci-dessous (obtenirDossier) pour le nom du candidat dans le titre.
const VARIANTE_PAR_CODE_ACCECIT = {
  // nouveau/test_non_planifie/test_realise ajoutés (workflow v5, audit 2026-08-21) — même mapping
  // que TableauDeBordAccueil.jsx, voir son commentaire d'en-tête pour le détail des choix de
  // couleur.
  nouveau: 'neutre',
  en_attente_pieces: 'attente',
  en_attente_verification: 'attente', // workflow hérité, plus jamais atteint
  // 'rose' (pas 'attente' ni 'neutre-fort', second correctif audit 2026-08-25) : voir
  // TableauDeBordAccueil.jsx, VARIANTE_PAR_CODE_ACCECIT, pour le détail des deux correctifs.
  test_non_planifie: 'rose',
  test_planifie: 'bleu',
  test_realise: 'violet',
  test_non_realise: 'alerte',
  invalide: 'echec',
  valide_envoi_formation: 'succes',
  valide_pret_embauche: 'vert-clair',
};
function varianteStatut(code) {
  return VARIANTE_PAR_CODE_ACCECIT[code] ?? 'neutre';
}

// Page coordination : relances et rendez-vous d'un dossier (CLAUDE.md, étape "relances et
// reprogrammations"), les deux concernant le même besoin de suivi terrain — regroupées sur un
// même écran plutôt qu'éclatées, pour que la coordination voie en un coup d'œil l'historique des
// contacts ET les rendez-vous en cours. Lit dossierId depuis le paramètre de route et le
// transmet — ni HistoriqueRelances.jsx ni GestionRendezvous.jsx ne connaissent le routage, même
// patron que VerificationPieces.jsx pour CaptureTablette.jsx.
export default function Relances() {
  const { dossierId } = useParams();

  // Nom du candidat affiché à côté du numéro de dossier dans le titre, même patron que
  // Validation.jsx (obtenirDossier, statut + nom/prénom déjà joints côté back) : purement
  // informatif, un échec de chargement ne bloque donc pas le reste de l'écran (catch silencieux,
  // comme là-bas).
  const [dossier, setDossier] = useState(null);

  useEffect(() => {
    let annule = false;
    obtenirDossier(dossierId)
      .then((valeur) => {
        if (!annule) setDossier(valeur);
      })
      .catch(() => {});
    return () => {
      annule = true;
    };
  }, [dossierId]);

  // Rafraîchissement automatique (audit 2026-08-24) : ce badge de titre uniquement — l'historique
  // des relances (HistoriqueRelances.jsx) et les rendez-vous (GestionRendezvous.jsx) gèrent leur
  // propre rafraîchissement indépendamment (voir leurs fichiers respectifs).
  useRafraichissementAuto(() => {
    obtenirDossier(dossierId)
      .then(setDossier)
      .catch(() => {});
  });

  return (
    <PageBackOffice>
      <div className="page-relances">
        {/* Titre à gauche, EnTeteBackOffice (nom de l'agent + Déconnexion) à droite, même ligne
            — même patron que Planification.jsx/Indicateurs.jsx (décision utilisateur, 2026-08-13).
            Bouton "Retour au tableau de bord" retiré (refonte navigation, 2026-08-17) : couvert
            par le lien "Dossiers candidats" de la barre de navigation commune, voir
            BarreNavigation.jsx (montée dans PageBackOffice.jsx). */}
        <header className="page-relances__entete">
          <div className="page-relances__titre-bloc">
            <h1>
              Dossier #{dossierId}
              {dossier && (
                <>
                  {' - '}
                  <span className="page-relances__candidat-nom">{dossier.candidat_nom}</span> {dossier.candidat_prenom}
                </>
              )}
            </h1>
            {/* Même badge/mapping que Validation.jsx, pour que le statut reste visible qu'on
                arrive ici depuis "Étudier le dossier" ou "Voir le dossier" (Suivi des tests). */}
            {dossier && (
              <div className="page-relances__statut">
                <span className="page-relances__statut-libelle">Statut :</span>
                <StatutBadge libelle={dossier.statut_libelle} variante={varianteStatut(dossier.statut_code)} />
              </div>
            )}
          </div>
          <EnTeteBackOffice />
        </header>

        {/* Bandeau d'accès rapide aux autres écrans du dossier (patch léger, décision utilisateur
            2026-08-21) — voir NavigationFicheDossier.jsx : jusque-là cet écran n'affichait ni le
            statut ni la section "Pièces justificatives" de Validation.jsx, sans aucun moyen d'y
            accéder sinon revenir au tableau de bord. */}
        <NavigationFicheDossier dossierId={dossierId} pageActuelle="relances" />

        {/* Repositionnée juste sous le titre (audit 2026-08-20, décision utilisateur) —
            auparavant tout en bas de la fiche, après Rendez-vous/Relances/Notes : composant
            partagé (core/dossier/InformationsInscription.jsx), même emplacement appliqué sur
            Validation.jsx/VerificationPieces.jsx/GrilleEvaluation.jsx pour rester cohérent
            partout où cette section apparaît. */}
        {/* Chaque section a déjà son propre chargement de données indépendant (voir leurs
            fichiers respectifs) — ErrorBoundary ajoute le filet manquant côté RENDU (audit
            2026-08-24, mode dégradé du back-office) : un plantage dans l'une n'empêche plus la
            consultation des trois autres, key={dossierId} sur chacune pour repartir d'un état
            propre si l'agent change de dossier (même patron que la remise à zéro déjà en place
            sur ces composants via leur propre useEffect([dossierId])). */}
        <ErrorBoundary key={`inscription-${dossierId}`} titre="Informations d'inscription complètes">
          <InformationsInscription dossierId={dossierId} />
        </ErrorBoundary>

        <ErrorBoundary key={`rendezvous-${dossierId}`} titre="Rendez-vous">
          <GestionRendezvous
            dossierId={dossierId}
            codeStatutDossier={dossier?.statut_code}
            libelleStatutDossier={dossier?.statut_libelle}
          />
        </ErrorBoundary>
        <ErrorBoundary key={`relances-${dossierId}`} titre="Relances">
          <HistoriqueRelances dossierId={dossierId} />
        </ErrorBoundary>
        <ErrorBoundary key={`notes-${dossierId}`} titre="Notes">
          <NotesDossier dossierId={dossierId} />
        </ErrorBoundary>
      </div>
    </PageBackOffice>
  );
}
