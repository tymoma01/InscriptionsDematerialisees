import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { blocInfosPersoSchema, NIR_REGEX } from './BlocInfosPerso.schema';
import { NATIONALITES } from './nationalites';
import { propsChampNumeriqueMasque } from '../masqueNumerique';
import { propsRadioAccessible } from '../radioAccessible';
import { verifierDisponibilite } from '../../../services/candidatService';
import './BlocInfosPerso.css';

// 1 (sexe) - 2 (année) - 2 (mois) - 2 (département) - 3 (commune) - 3 (numéro d'ordre) - 2 (clé)
// = 15 chiffres, format NIR français standard (ex. "1 85 05 78 006 084 36").
const GROUPES_NIR = [1, 2, 2, 2, 3, 3, 2];
const LONGUEUR_NIR = 15;

// Validation croisée NIR / civilité / date de naissance (1er chiffre = sexe, chiffres 2-3 =
// année, chiffres 4-5 = mois — voir CLAUDE.md, structure du NIR). Volontairement pas la clé de
// contrôle (2 derniers chiffres) : hors périmètre pour l'instant.
//
// Implémentée en pur calcul dérivé (appelée directement au rendu, voir plus bas) plutôt qu'en
// .refine() zod sur le schéma : react-hook-form + zodResolver s'est révélé peu fiable ici pour
// rafraîchir errors.nir quand c'est un AUTRE champ (civilité ou date de naissance) qui change
// après coup sans retoucher au NIR lui-même — setValue(..., { shouldValidate: true }) et
// trigger() ont été essayés sur civilite/dateNaissance/nir, avec un succès incohérent selon le
// champ déclencheur (confirmé en test manuel). Un calcul dérivé, réévalué à chaque rendu à partir
// des valeurs déjà suivies par watch() (qui, elles, sont fiables), élimine complètement ce
// problème : aucune dépendance au cycle de validation interne de react-hook-form.
//
// Se neutralise tant que le NIR n'a pas déjà son format de base (15 chiffres) ou que le champ à
// croiser n'est pas renseigné — la validation de format/obligatoire de chaque champ (schéma zod)
// reste seule responsable de ces cas-là, pour ne pas afficher un message d'incohérence trompeur
// pendant que le candidat est encore en train de saisir.
function calculerErreurCoherenceNir({ nir, civilite, dateNaissance }) {
  if (!NIR_REGEX.test(nir ?? '')) return null;

  if (civilite) {
    const chiffreSexeAttendu = civilite === 'monsieur' ? '1' : '2';
    if (nir.charAt(0) !== chiffreSexeAttendu) {
      return 'Le premier chiffre du NIR ne correspond pas à la civilité renseignée';
    }
  }

  if (dateNaissance && dateNaissance.length >= 7) {
    const anneeNaissance = dateNaissance.slice(0, 4);
    const moisNaissance = dateNaissance.slice(5, 7);

    if (nir.slice(1, 3) !== anneeNaissance.slice(2)) {
      return "Les chiffres 2 et 3 du NIR ne correspondent pas à l'année de naissance renseignée";
    }
    if (nir.slice(3, 5) !== moisNaissance) {
      return 'Les chiffres 4 et 5 du NIR ne correspondent pas au mois de naissance renseigné';
    }
  }

  return null;
}

const SITUATIONS_FAMILIALES = [
  { code: 'celibataire', libelle: 'Célibataire' },
  { code: 'marie', libelle: 'Marié(e)' },
  { code: 'pacse', libelle: 'Pacsé(e)' },
  { code: 'divorce', libelle: 'Divorcé(e)' },
  { code: 'veuf', libelle: 'Veuf/Veuve' },
];

// Bloc générique "informations personnelles" : rendu par BlocRenderer via blocRegistry,
// ne connaît rien du parcours global (étapes, autres blocs) — seulement ses propres champs.
export default function BlocInfosPerso({ valeurs, onChange, onValiditeChange }) {
  const {
    register,
    formState: { errors, isValid },
    watch,
    setValue,
  } = useForm({
    mode: 'onChange',
    resolver: zodResolver(blocInfosPersoSchema),
    defaultValues: {
      civilite: valeurs?.civilite,
      nom: valeurs?.nom ?? '',
      nomNaissance: valeurs?.nomNaissance ?? '',
      lieuNaissance: valeurs?.lieuNaissance ?? '',
      nationalite: valeurs?.nationalite ?? '',
      prenom: valeurs?.prenom ?? '',
      dateNaissance: valeurs?.dateNaissance ?? '',
      nir: valeurs?.nir ?? '',
      situationFamiliale: valeurs?.situationFamiliale ?? '',
    },
  });

  const valeursSaisies = watch();

  useEffect(() => {
    onChange(valeursSaisies);
  }, [JSON.stringify(valeursSaisies)]);

  // Vérification d'unicité en temps réel (au blur, voir gererBlurNir plus bas) — distincte de la
  // validation de format (isValid ci-dessus) : un NIR peut être bien formé mais déjà utilisé par
  // un autre dossier. Tant que ce conflit n'est pas résolu, le bloc reste invalide (voir
  // useEffect onValiditeChange plus bas) pour empêcher d'avancer avec un NIR en conflit.
  const [erreurDisponibiliteNir, setErreurDisponibiliteNir] = useState(null);

  useEffect(() => {
    // La valeur a changé depuis la dernière vérification : elle n'est plus à jour, on l'efface
    // plutôt que d'afficher un résultat qui ne correspond plus à ce qui est saisi.
    setErreurDisponibiliteNir(null);
  }, [valeursSaisies.nir]);

  // Recalculée à chaque rendu à partir des valeurs déjà suivies par watch() (civilite,
  // dateNaissance et nir) — voir calculerErreurCoherenceNir plus haut pour le choix de ne pas
  // passer par le schéma zod pour cette validation précise.
  const erreurCoherenceNir = calculerErreurCoherenceNir(valeursSaisies);

  useEffect(() => {
    onValiditeChange(isValid && !erreurDisponibiliteNir && !erreurCoherenceNir);
  }, [isValid, erreurDisponibiliteNir, erreurCoherenceNir]);

  // Espacement automatique pendant la saisie (affichage uniquement, voir masqueNumerique.js) —
  // la valeur suivie par react-hook-form et validée par le resolver zod reste sans espace.
  // Volontairement pas de {...register('nir')} sur ce champ (voir le commentaire détaillé dans
  // masqueNumerique.js) : entièrement piloté par value/onChange + setValue.
  const propsNir = propsChampNumeriqueMasque({
    valeurCourante: valeursSaisies.nir,
    tailles: GROUPES_NIR,
    longueurChiffresMax: LONGUEUR_NIR,
    onChangerValeur: (chiffres) => setValue('nir', chiffres, { shouldValidate: true }),
  });

  // Vérification ponctuelle d'unicité au moment où le candidat quitte le champ (pas à chaque
  // frappe) — la vérification définitive reste faite à la soumission finale (409, voir
  // FormulaireInscription.jsx), celle-ci n'est qu'un retour anticipé pour éviter d'arriver en
  // bout de formulaire avec un NIR déjà utilisé.
  const gererBlurNir = async () => {
    const nir = valeursSaisies.nir;
    // Pas la peine d'interroger le serveur pour un NIR déjà connu comme mal formé ou incohérent
    // avec la civilité/date de naissance : ces deux vérifications sont gratuites et immédiates,
    // contrairement à l'appel réseau ci-dessous.
    if (!nir || errors.nir || erreurCoherenceNir) return;
    try {
      const disponible = await verifierDisponibilite('nir', nir);
      setErreurDisponibiliteNir(disponible ? null : 'Ce numéro de sécurité sociale est déjà utilisé.');
    } catch {
      // Panne réseau ponctuelle : ne pas bloquer la saisie, la vérification finale à la
      // soumission reste le filet de sécurité.
      setErreurDisponibiliteNir(null);
    }
  };

  const civiliteSelectionnee = valeursSaisies.civilite;

  return (
    <fieldset className="bloc-formulaire bloc-infos-perso">
      <legend>Informations personnelles</legend>

      <div className="bloc-infos-perso__champ-pleine-largeur">
        {/* Classes dédiées (pas juste fieldset/legend) : nécessaire pour que le reset de mise en
            page dans BlocInfosPerso.css l'emporte sur le cadre générique posé par
            styles/blocFormulaire.css pour tout fieldset/legend imbriqué — voir le commentaire
            détaillé là-bas. */}
        <fieldset className="bloc-infos-perso__fieldset-civilite">
          <legend className="bloc-infos-perso__legende-civilite">
            Civilité <span className="champ-obligatoire">*</span>
          </legend>
          <div className="bloc-infos-perso__options">
            <label htmlFor="civilite-monsieur">
              <input
                id="civilite-monsieur"
                type="radio"
                value="monsieur"
                {...propsRadioAccessible({
                  register,
                  setValue,
                  champ: 'civilite',
                  valeur: 'monsieur',
                  valeurCourante: civiliteSelectionnee,
                })}
              />
              Monsieur
            </label>
            <label htmlFor="civilite-madame">
              <input
                id="civilite-madame"
                type="radio"
                value="madame"
                {...propsRadioAccessible({
                  register,
                  setValue,
                  champ: 'civilite',
                  valeur: 'madame',
                  valeurCourante: civiliteSelectionnee,
                })}
              />
              Madame
            </label>
          </div>
        </fieldset>
        {errors.civilite && <p role="alert">{errors.civilite.message}</p>}
      </div>

      <div className="bloc-infos-perso__champ-pleine-largeur">
        <label htmlFor="nom">
          Nom <span className="champ-obligatoire">*</span>
        </label>
        <input id="nom" type="text" autoComplete="family-name" {...register('nom')} />
        {errors.nom && <p role="alert">{errors.nom.message}</p>}
      </div>

      <div className="bloc-infos-perso__champ-pleine-largeur">
        <label htmlFor="prenom">
          Prénom <span className="champ-obligatoire">*</span>
        </label>
        <input id="prenom" type="text" autoComplete="given-name" {...register('prenom')} />
        {errors.prenom && <p role="alert">{errors.prenom.message}</p>}
      </div>

      <div className="bloc-infos-perso__champ-pleine-largeur">
        <label htmlFor="nomNaissance">Nom de naissance</label>
        <input id="nomNaissance" type="text" {...register('nomNaissance')} />
        {errors.nomNaissance && <p role="alert">{errors.nomNaissance.message}</p>}
      </div>

      <div className="bloc-infos-perso__champ-pleine-largeur">
        <label htmlFor="dateNaissance">
          Date de naissance <span className="champ-obligatoire">*</span>
        </label>
        <input id="dateNaissance" type="date" {...register('dateNaissance')} />
        {errors.dateNaissance && <p role="alert">{errors.dateNaissance.message}</p>}
      </div>

      <div className="bloc-infos-perso__champ-pleine-largeur">
        <label htmlFor="lieuNaissance">
          Lieu de naissance <span className="champ-obligatoire">*</span>
        </label>
        <input id="lieuNaissance" type="text" {...register('lieuNaissance')} />
        {errors.lieuNaissance && <p role="alert">{errors.lieuNaissance.message}</p>}
      </div>

      <div className="bloc-infos-perso__champ-pleine-largeur">
        <label htmlFor="nationalite">
          Nationalité <span className="champ-obligatoire">*</span>
        </label>
        <select id="nationalite" {...register('nationalite')}>
          <option value="">Sélectionner...</option>
          {NATIONALITES.map((nationalite) => (
            <option key={nationalite} value={nationalite}>
              {nationalite}
            </option>
          ))}
        </select>
        {errors.nationalite && <p role="alert">{errors.nationalite.message}</p>}
      </div>

      <div className="bloc-infos-perso__champ-pleine-largeur">
        <label htmlFor="situationFamiliale">
          Situation familiale <span className="champ-obligatoire">*</span>
        </label>
        <select id="situationFamiliale" {...register('situationFamiliale')}>
          <option value="">Sélectionner...</option>
          {SITUATIONS_FAMILIALES.map((situation) => (
            <option key={situation.code} value={situation.code}>
              {situation.libelle}
            </option>
          ))}
        </select>
        {errors.situationFamiliale && <p role="alert">{errors.situationFamiliale.message}</p>}
      </div>

      <div className="bloc-infos-perso__champ-pleine-largeur">
        <label htmlFor="nir">
          N° de sécurité sociale <span className="champ-obligatoire">*</span>
        </label>
        <input
          id="nir"
          name="nir"
          type="text"
          inputMode="numeric"
          placeholder="1 85 05 78 006 084 36"
          {...propsNir}
          onBlur={gererBlurNir}
        />
        {errors.nir && <p role="alert">{errors.nir.message}</p>}
        {!errors.nir && erreurCoherenceNir && <p role="alert">{erreurCoherenceNir}</p>}
        {!errors.nir && !erreurCoherenceNir && erreurDisponibiliteNir && <p role="alert">{erreurDisponibiliteNir}</p>}
      </div>
    </fieldset>
  );
}
