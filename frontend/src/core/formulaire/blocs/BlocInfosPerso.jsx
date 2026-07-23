import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { blocInfosPersoSchema } from './BlocInfosPerso.schema';
import { NATIONALITES } from './nationalites';
import { propsChampNumeriqueMasque } from '../masqueNumerique';
import { propsRadioAccessible } from '../radioAccessible';
import { verifierDisponibilite } from '../../../services/candidatService';
import './BlocInfosPerso.css';

// 1 (sexe) - 2 (année) - 2 (mois) - 2 (département) - 3 (commune) - 3 (numéro d'ordre) - 2 (clé)
// = 15 chiffres, format NIR français standard (ex. "1 85 05 78 006 084 36").
const GROUPES_NIR = [1, 2, 2, 2, 3, 3, 2];
const LONGUEUR_NIR = 15;

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

  useEffect(() => {
    onValiditeChange(isValid && !erreurDisponibiliteNir);
  }, [isValid, erreurDisponibiliteNir]);

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
    if (!nir || errors.nir) return;
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
        {!errors.nir && erreurDisponibiliteNir && <p role="alert">{erreurDisponibiliteNir}</p>}
      </div>
    </fieldset>
  );
}
