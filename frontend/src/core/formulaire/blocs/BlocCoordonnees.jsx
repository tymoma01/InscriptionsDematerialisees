import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { blocCoordonneesSchema } from './BlocCoordonnees.schema';

// Bloc générique "coordonnées" : même contrat que BlocInfosPerso (valeurs, onChange,
// onValiditeChange) — rendu par BlocRenderer via blocRegistry, aucune connaissance du parcours global.
export default function BlocCoordonnees({ valeurs, onChange, onValiditeChange }) {
  const {
    register,
    formState: { errors, isValid },
    watch,
  } = useForm({
    mode: 'onChange',
    resolver: zodResolver(blocCoordonneesSchema),
    defaultValues: {
      adresse: valeurs?.adresse ?? '',
      telephone: valeurs?.telephone ?? '',
      email: valeurs?.email ?? '',
      contactUrgenceNom: valeurs?.contactUrgenceNom ?? '',
      contactUrgenceTelephone: valeurs?.contactUrgenceTelephone ?? '',
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
    <fieldset className="bloc-formulaire bloc-coordonnees">
      <legend>Coordonnées</legend>

      <label htmlFor="adresse">Adresse</label>
      <input id="adresse" type="text" autoComplete="street-address" {...register('adresse')} />
      {errors.adresse && <p role="alert">{errors.adresse.message}</p>}

      <label htmlFor="telephone">Téléphone</label>
      <input id="telephone" type="tel" autoComplete="tel" {...register('telephone')} />
      {errors.telephone && <p role="alert">{errors.telephone.message}</p>}

      <label htmlFor="email">Email</label>
      <input id="email" type="email" autoComplete="email" {...register('email')} />
      {errors.email && <p role="alert">{errors.email.message}</p>}

      <label htmlFor="contactUrgenceNom">Nom du contact d'urgence</label>
      <input id="contactUrgenceNom" type="text" {...register('contactUrgenceNom')} />
      {errors.contactUrgenceNom && <p role="alert">{errors.contactUrgenceNom.message}</p>}

      <label htmlFor="contactUrgenceTelephone">Téléphone du contact d'urgence</label>
      <input id="contactUrgenceTelephone" type="tel" {...register('contactUrgenceTelephone')} />
      {errors.contactUrgenceTelephone && <p role="alert">{errors.contactUrgenceTelephone.message}</p>}
    </fieldset>
  );
}
