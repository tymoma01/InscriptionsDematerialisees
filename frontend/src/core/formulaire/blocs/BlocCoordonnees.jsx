import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { blocCoordonneesSchema } from './BlocCoordonnees.schema';
import './BlocCoordonnees.css';

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

      <div className="bloc-coordonnees__champ">
        <label htmlFor="adresse">
          Adresse <span className="champ-obligatoire">*</span>
        </label>
        <input id="adresse" type="text" autoComplete="street-address" {...register('adresse')} />
        {errors.adresse && <p role="alert">{errors.adresse.message}</p>}
      </div>

      <div className="bloc-coordonnees__champ">
        <label htmlFor="telephone">
          Téléphone <span className="champ-obligatoire">*</span>
        </label>
        <input id="telephone" type="tel" autoComplete="tel" {...register('telephone')} />
        {errors.telephone && <p role="alert">{errors.telephone.message}</p>}
      </div>

      <div className="bloc-coordonnees__champ">
        <label htmlFor="email">
          Email <span className="champ-obligatoire">*</span>
        </label>
        <input id="email" type="email" autoComplete="email" {...register('email')} />
        {errors.email && <p role="alert">{errors.email.message}</p>}
      </div>

      <div className="bloc-coordonnees__champ">
        <label htmlFor="contactUrgenceNom">
          Nom du contact d'urgence <span className="champ-obligatoire">*</span>
        </label>
        <input id="contactUrgenceNom" type="text" {...register('contactUrgenceNom')} />
        {errors.contactUrgenceNom && <p role="alert">{errors.contactUrgenceNom.message}</p>}
      </div>

      <div className="bloc-coordonnees__champ">
        <label htmlFor="contactUrgenceTelephone">
          Téléphone du contact d'urgence <span className="champ-obligatoire">*</span>
        </label>
        <input id="contactUrgenceTelephone" type="tel" {...register('contactUrgenceTelephone')} />
        {errors.contactUrgenceTelephone && <p role="alert">{errors.contactUrgenceTelephone.message}</p>}
      </div>
    </fieldset>
  );
}
