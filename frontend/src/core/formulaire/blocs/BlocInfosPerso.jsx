import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { blocInfosPersoSchema } from './BlocInfosPerso.schema';
import './BlocInfosPerso.css';

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
  } = useForm({
    mode: 'onChange',
    resolver: zodResolver(blocInfosPersoSchema),
    defaultValues: {
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

  useEffect(() => {
    onValiditeChange(isValid);
  }, [isValid]);

  return (
    <fieldset className="bloc-formulaire bloc-infos-perso">
      <legend>Informations personnelles</legend>

      <div className="bloc-infos-perso__ligne">
        <div className="bloc-infos-perso__champ">
          <label htmlFor="nom">Nom</label>
          <input id="nom" type="text" autoComplete="family-name" {...register('nom')} />
          {errors.nom && <p role="alert">{errors.nom.message}</p>}
        </div>

        <div className="bloc-infos-perso__champ">
          <label htmlFor="prenom">Prénom</label>
          <input id="prenom" type="text" autoComplete="given-name" {...register('prenom')} />
          {errors.prenom && <p role="alert">{errors.prenom.message}</p>}
        </div>
      </div>

      <label htmlFor="nomNaissance">Nom de naissance</label>
      <input id="nomNaissance" type="text" {...register('nomNaissance')} />
      {errors.nomNaissance && <p role="alert">{errors.nomNaissance.message}</p>}

      <label htmlFor="dateNaissance">Date de naissance</label>
      <input id="dateNaissance" type="date" {...register('dateNaissance')} />
      {errors.dateNaissance && <p role="alert">{errors.dateNaissance.message}</p>}

      <label htmlFor="lieuNaissance">Lieu de naissance</label>
      <input id="lieuNaissance" type="text" {...register('lieuNaissance')} />
      {errors.lieuNaissance && <p role="alert">{errors.lieuNaissance.message}</p>}

      <label htmlFor="nationalite">Nationalité</label>
      <input id="nationalite" type="text" {...register('nationalite')} />
      {errors.nationalite && <p role="alert">{errors.nationalite.message}</p>}

      <label htmlFor="situationFamiliale">Situation familiale</label>
      <select id="situationFamiliale" {...register('situationFamiliale')}>
        <option value="">Sélectionner...</option>
        {SITUATIONS_FAMILIALES.map((situation) => (
          <option key={situation.code} value={situation.code}>
            {situation.libelle}
          </option>
        ))}
      </select>
      {errors.situationFamiliale && <p role="alert">{errors.situationFamiliale.message}</p>}

      <label htmlFor="nir">N° de sécurité sociale</label>
      <input id="nir" type="text" inputMode="numeric" placeholder="1 85 05 78 006 084 36" {...register('nir')} />
      {errors.nir && <p role="alert">{errors.nir.message}</p>}
    </fieldset>
  );
}
