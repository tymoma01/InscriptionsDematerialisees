import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import StatutBadge from '../../core/workflow/StatutBadge';
import EnTeteBackOffice from '../../core/auth/EnTeteBackOffice';
import ChampRecherche from '../../core/filtres/ChampRecherche';
import FiltresStatut from '../../core/dossier/FiltresStatut';
import { useSession } from '../../core/auth/useSession';
import PageBackOffice from '../../core/backOffice/PageBackOffice';
import {
  listerUtilisateurs,
  listerRolesAssignables,
  creerUtilisateur,
  mettreAJourUtilisateur,
} from '../../services/utilisateurService';
import './Utilisateurs.css';

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

// Options du filtre "Statut de compte" — {code, libelle} comme les rôles ci-dessous, pour
// réutiliser FiltresStatut.jsx tel quel (voir son en-tête : générique par nature, peu importe ce
// que "statuts" représente). Codes propres à cette page, aucun lien avec la table `statuts` des
// dossiers (booléen `actif` de la table `utilisateurs`, pas un statut piloté par configuration).
const STATUTS_COMPTE = [
  { code: 'actif', libelle: 'Actif' },
  { code: 'desactive', libelle: 'Désactivé' },
];

// Une entrée par colonne triable, même patron que DossierList.jsx (core/dossier/DossierList.jsx)
// et Planification.jsx — "Rôle"/"Statut" trient sur le libellé affiché (plus lisible pour
// l'utilisateur qu'un tri sur le code brut). "Dernière connexion" : les comptes jamais connectés
// (derniere_connexion null, affichés "—") retombent en fin de tri quel que soit le sens choisi,
// -Infinity les place naturellement après les dates réelles en ordre décroissant (le plus récent
// en premier, comportement historique de cette colonne).
const COLONNES = [
  { cle: 'nom', libelle: 'Nom', extraire: (u) => (u.nom ?? '').toLowerCase() },
  { cle: 'email', libelle: 'Email', extraire: (u) => (u.email ?? '').toLowerCase() },
  { cle: 'role_libelle', libelle: 'Rôle', extraire: (u) => (u.role_libelle ?? '').toLowerCase() },
  { cle: 'actif', libelle: 'Statut', extraire: (u) => (u.actif ? 'actif' : 'desactive') },
  {
    cle: 'derniere_connexion',
    libelle: 'Dernière connexion',
    extraire: (u) => (u.derniere_connexion ? new Date(u.derniere_connexion).getTime() : -Infinity),
  },
];

// Écran admin de gestion des comptes (CLAUDE.md, section Rôles : "Admin : gestion globale") —
// liste des comptes de l'entité courante, création, modification (nom/prénom/rôle/mot de passe)
// et activation/désactivation. Aucune suppression : un compte désactivé (actif: false) ne peut
// plus se connecter (voir backend utilisateurRepository.trouverParEmail), mais reste référencé
// par l'historique/les relances/les évaluations/le journal d'audit — le supprimer casserait
// cette traçabilité.
export default function Utilisateurs() {
  const { utilisateur: utilisateurConnecte, chargement: chargementSession } = useSession();

  const [utilisateurs, setUtilisateurs] = useState([]);
  const [roles, setRoles] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);
  // null = fermé, 'creation' = formulaire vide, ou l'objet utilisateur à éditer.
  const [formulaireOuvert, setFormulaireOuvert] = useState(null);

  // Recherche + filtres, cumulables entre eux et avec le tri ci-dessous — entièrement client :
  // GET /api/utilisateurs ne pagine pas (voir utilisateurRepository.listerUtilisateurs, aucun
  // LIMIT/OFFSET), la liste `utilisateurs` est donc déjà intégralement en mémoire, même choix que
  // DossierList.jsx/Planification.jsx pour la même raison.
  const [recherche, setRecherche] = useState('');
  const [roleFiltre, setRoleFiltre] = useState(null); // null = tous les rôles
  const [statutCompteFiltre, setStatutCompteFiltre] = useState(null); // null = tous

  // Défaut = nom croissant, même ordre que le backend (utilisateurRepository.listerUtilisateurs,
  // orderBy nom asc) — préservé tant qu'aucun en-tête n'a été cliqué.
  const [tri, setTri] = useState({ colonne: 'nom', ordre: 'asc' });

  const chargerUtilisateurs = () => {
    setChargement(true);
    setErreur(null);
    return listerUtilisateurs()
      .then(setUtilisateurs)
      .catch((erreur) => setErreur(erreur.response?.data?.erreur ?? 'Impossible de récupérer les comptes.'))
      .finally(() => setChargement(false));
  };

  useEffect(() => {
    chargerUtilisateurs();
    listerRolesAssignables()
      .then(setRoles)
      .catch(() => {
        // Non bloquant pour la liste ci-dessous ; sans rôles chargés, le formulaire de création/
        // édition reste simplement désactivé (voir FormulaireUtilisateur).
      });
  }, []);

  const gererFinFormulaire = () => {
    setFormulaireOuvert(null);
    chargerUtilisateurs();
  };

  // Bascule rapide depuis la liste, sans ouvrir le formulaire complet — le serveur revalide
  // systématiquement (ex : impossible de se désactiver soi-même), voir utilisateurService.js.
  const basculerActif = async (cible) => {
    try {
      await mettreAJourUtilisateur(cible.id, { actif: !cible.actif });
      chargerUtilisateurs();
    } catch (erreur) {
      window.alert(
        erreur.response?.data?.erreur ?? "Le serveur n'a pas pu enregistrer ce changement. Merci de réessayer.",
      );
    }
  };

  // Recherche sur le nom complet (prénom + nom, même patron que filtrerDossiers.js) et l'email —
  // les deux champs où un admin identifie un compte au premier coup d'œil.
  const utilisateursFiltres = useMemo(() => {
    const rechercheNormalisee = recherche.trim().toLowerCase();
    return utilisateurs.filter((u) => {
      if (rechercheNormalisee) {
        const nomComplet = `${u.prenom} ${u.nom}`.toLowerCase();
        if (!nomComplet.includes(rechercheNormalisee) && !u.email.toLowerCase().includes(rechercheNormalisee)) {
          return false;
        }
      }
      if (roleFiltre && u.role_code !== roleFiltre) return false;
      if (statutCompteFiltre) {
        const statutCode = u.actif ? 'actif' : 'desactive';
        if (statutCode !== statutCompteFiltre) return false;
      }
      return true;
    });
  }, [utilisateurs, recherche, roleFiltre, statutCompteFiltre]);

  const utilisateursTries = useMemo(() => {
    const colonneTri = COLONNES.find((colonne) => colonne.cle === tri.colonne);
    const copie = [...utilisateursFiltres];
    copie.sort((a, b) => {
      const valeurA = colonneTri.extraire(a);
      const valeurB = colonneTri.extraire(b);
      if (valeurA < valeurB) return tri.ordre === 'asc' ? -1 : 1;
      if (valeurA > valeurB) return tri.ordre === 'asc' ? 1 : -1;
      return 0;
    });
    return copie;
  }, [utilisateursFiltres, tri]);

  // Reclique sur la colonne déjà active : inverse l'ordre. Nouvelle colonne : "Dernière
  // connexion" repart décroissant (le plus récent en premier reste le repère le plus utile), les
  // colonnes textuelles repartent croissant (ordre alphabétique naturel) — même patron que
  // DossierList.jsx/Planification.jsx.
  const trierPar = (colonne) => {
    setTri((precedent) => {
      if (precedent.colonne === colonne) {
        return { colonne, ordre: precedent.ordre === 'asc' ? 'desc' : 'asc' };
      }
      return { colonne, ordre: colonne === 'derniere_connexion' ? 'desc' : 'asc' };
    });
  };

  if (chargementSession) {
    return (
      <PageBackOffice>
        <p>Chargement de la session…</p>
      </PageBackOffice>
    );
  }

  if (!utilisateurConnecte) {
    return (
      <PageBackOffice>
        <p role="alert">
          Vous devez être connecté pour gérer les comptes. <Link to="/connexion">Se connecter</Link>
        </p>
      </PageBackOffice>
    );
  }

  return (
    <PageBackOffice>
      <div className="page-utilisateurs">
        <header className="page-utilisateurs__entete">
          <h1>Comptes utilisateurs</h1>
          <EnTeteBackOffice />
        </header>

        <button type="button" onClick={() => setFormulaireOuvert('creation')}>
          Nouveau compte
        </button>

        {formulaireOuvert && (
          <FormulaireUtilisateur
            // key force un remontage (donc un état de formulaire vierge) quand on passe de la
            // création à l'édition, ou de l'édition d'un compte à un autre, sans avoir à fermer le
            // formulaire entre les deux — sans ça, les champs contrôlés garderaient leurs valeurs
            // précédentes (useState ne réinitialise pas sur un simple changement de props).
            key={formulaireOuvert === 'creation' ? 'creation' : formulaireOuvert.id}
            utilisateur={formulaireOuvert === 'creation' ? null : formulaireOuvert}
            roles={roles}
            onTermine={gererFinFormulaire}
            onAnnuler={() => setFormulaireOuvert(null)}
          />
        )}

        {chargement && <p>Chargement des comptes…</p>}
        {erreur && <p role="alert">{erreur}</p>}

        {!chargement && !erreur && utilisateurs.length > 0 && (
          <>
            <ChampRecherche
              valeur={recherche}
              onChanger={setRecherche}
              placeholder="Rechercher un compte (nom, email)"
              ariaLabel="Rechercher un compte par nom ou email"
            />
            <FiltresStatut
              statuts={roles}
              statutFiltre={roleFiltre}
              onChangerStatutFiltre={setRoleFiltre}
              ariaLabel="Filtrer par rôle"
            />
            <FiltresStatut
              statuts={STATUTS_COMPTE}
              statutFiltre={statutCompteFiltre}
              onChangerStatutFiltre={setStatutCompteFiltre}
              ariaLabel="Filtrer par statut de compte"
            />
          </>
        )}

        {!chargement && !erreur && utilisateurs.length === 0 && (
          <p className="page-utilisateurs__vide">Aucun compte pour cette entité.</p>
        )}

        {!chargement && !erreur && utilisateurs.length > 0 && utilisateursTries.length === 0 && (
          <p className="page-utilisateurs__vide">Aucun compte ne correspond à ces critères.</p>
        )}

        {!chargement && !erreur && utilisateursTries.length > 0 && (
          <div className="table-utilisateurs__scroll">
            <table className="table-utilisateurs">
              <thead>
                <tr>
                  {COLONNES.map((colonne) => {
                    const actif = tri.colonne === colonne.cle;
                    return (
                      <th
                        key={colonne.cle}
                        scope="col"
                        // Colonne "Nom" figée au défilement horizontal (voir
                        // .table-utilisateurs__colonne-figee, Utilisateurs.css) — première colonne
                        // du tableau, repère constant pour identifier une ligne même une fois les
                        // colonnes suivantes défilées hors champ sur tablette/écran étroit.
                        className={colonne.cle === 'nom' ? 'table-utilisateurs__colonne-figee' : undefined}
                        aria-sort={actif ? (tri.ordre === 'asc' ? 'ascending' : 'descending') : 'none'}
                      >
                        <button type="button" className="table-utilisateurs__entete-tri" onClick={() => trierPar(colonne.cle)}>
                          {colonne.libelle}
                          <span className="table-utilisateurs__indicateur-tri" aria-hidden="true">
                            {actif ? (tri.ordre === 'asc' ? '▲' : '▼') : ''}
                          </span>
                        </button>
                      </th>
                    );
                  })}
                  <th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                {utilisateursTries.map((u) => (
                  <tr key={u.id}>
                    <td className="table-utilisateurs__colonne-figee">
                      {u.prenom} {u.nom}
                    </td>
                    <td>{u.email}</td>
                    <td>{u.role_libelle}</td>
                    <td>
                      <StatutBadge libelle={u.actif ? 'Actif' : 'Désactivé'} variante={u.actif ? 'succes' : 'echec'} />
                    </td>
                    <td>{u.derniere_connexion ? FORMAT_DATE.format(new Date(u.derniere_connexion)) : '—'}</td>
                    <td>
                      {/* display: flex sur un <div> interne plutôt que directement sur le <td> :
                          posé sur la cellule elle-même, ça lui ferait perdre son
                          display: table-cell (donc son étirement/centrage vertical automatique
                          sur la hauteur de la ligne) — décalage visible dès qu'une autre cellule
                          de la même ligne est plus haute. Même correctif que DossierList.jsx
                          (__actions), qui documente ce même piège pour la même raison. */}
                      <div className="table-utilisateurs__actions">
                        <button type="button" onClick={() => setFormulaireOuvert(u)}>
                          Modifier
                        </button>
                        <button
                          type="button"
                          onClick={() => basculerActif(u)}
                          disabled={u.actif && u.id === utilisateurConnecte.id}
                        >
                          {u.actif ? 'Désactiver' : 'Réactiver'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageBackOffice>
  );
}

const MOT_DE_PASSE_MIN = 8;

// Formulaire de création/édition — un seul composant pour les deux, `utilisateur` vaut null en
// création. L'email n'est jamais modifiable en édition (désactivé, voir input ci-dessous) : le
// backend n'accepte de toute façon pas ce champ sur PATCH — le changer soulèverait des questions
// hors périmètre ici (ré-vérification d'unicité, sessions actives sur l'ancien email...).
function FormulaireUtilisateur({ utilisateur, roles, onTermine, onAnnuler }) {
  const modeEdition = Boolean(utilisateur);

  // Amène le formulaire à l'écran dès son ouverture ("Nouveau compte" ou "Modifier"), même
  // principe que ModalePlanificationTest.jsx : sans ça, il s'ouvre en bas de la page (après le
  // tableau des comptes) et l'admin ne le voit pas apparaître sans défiler manuellement. Un seul
  // effet au montage suffit (pas de contenu chargé de façon asynchrone après coup ici,
  // contrairement au calendrier de disponibilité de ModalePlanificationTest.jsx) — la prop `key`
  // posée par Utilisateurs.jsx (voir plus haut) garantit un remontage à chaque nouvelle cible.
  const panneauRef = useRef(null);
  useEffect(() => {
    panneauRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const [nom, setNom] = useState(utilisateur?.nom ?? '');
  const [prenom, setPrenom] = useState(utilisateur?.prenom ?? '');
  const [email, setEmail] = useState(utilisateur?.email ?? '');
  const [roleCode, setRoleCode] = useState(utilisateur?.role_code ?? roles[0]?.code ?? '');
  const [motDePasse, setMotDePasse] = useState('');
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [erreur, setErreur] = useState(null);

  const gererEnvoi = async (evenement) => {
    evenement.preventDefault();
    setEnvoiEnCours(true);
    setErreur(null);
    try {
      if (modeEdition) {
        const donnees = { nom, prenom, roleCode };
        if (motDePasse) donnees.motDePasse = motDePasse;
        await mettreAJourUtilisateur(utilisateur.id, donnees);
      } else {
        await creerUtilisateur({ nom, prenom, email, motDePasse, roleCode });
      }
      onTermine();
    } catch (erreur) {
      setErreur(
        erreur.response?.data?.erreur ?? "Le serveur n'a pas pu enregistrer ce compte. Merci de réessayer.",
      );
    } finally {
      setEnvoiEnCours(false);
    }
  };

  return (
    <form ref={panneauRef} className="formulaire-utilisateur" onSubmit={gererEnvoi}>
      <h2>{modeEdition ? `Modifier ${utilisateur.prenom} ${utilisateur.nom}` : 'Nouveau compte'}</h2>

      {/* Grille à deux colonnes de largeur égale (Nom/Prénom, puis Email/Rôle) : occupe le cadre
          élargi (voir Utilisateurs.css) plutôt que de laisser un grand vide à droite avec un
          champ par ligne. Identique en création et en édition — aucun champ supplémentaire
          (le statut actif/désactivé se bascule depuis un bouton de la liste, pas ce formulaire,
          voir basculerActif). */}
      <div className="formulaire-utilisateur__ligne">
        <label>
          <span>Nom</span>
          <input type="text" value={nom} onChange={(evenement) => setNom(evenement.target.value)} required />
        </label>

        <label>
          <span>Prénom</span>
          <input type="text" value={prenom} onChange={(evenement) => setPrenom(evenement.target.value)} required />
        </label>
      </div>

      <div className="formulaire-utilisateur__ligne">
        <label>
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(evenement) => setEmail(evenement.target.value)}
            required
            disabled={modeEdition}
          />
        </label>

        <label>
          <span>Rôle</span>
          <select value={roleCode} onChange={(evenement) => setRoleCode(evenement.target.value)} required>
            {roles.length === 0 && <option value="">Aucun rôle disponible</option>}
            {roles.map((role) => (
              <option key={role.code} value={role.code}>
                {role.libelle}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label>
        <span>{modeEdition ? 'Nouveau mot de passe (laisser vide pour ne pas changer)' : 'Mot de passe'}</span>
        <input
          type="password"
          value={motDePasse}
          onChange={(evenement) => setMotDePasse(evenement.target.value)}
          required={!modeEdition}
          minLength={MOT_DE_PASSE_MIN}
          autoComplete="new-password"
        />
      </label>

      {erreur && <p role="alert">{erreur}</p>}

      <div className="formulaire-utilisateur__actions">
        <button type="button" onClick={onAnnuler} disabled={envoiEnCours}>
          Annuler
        </button>
        <button type="submit" disabled={envoiEnCours || roles.length === 0}>
          {envoiEnCours ? 'Enregistrement...' : modeEdition ? 'Enregistrer' : 'Créer le compte'}
        </button>
      </div>
    </form>
  );
}
