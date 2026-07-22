import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { blocCoordonneesSchema } from './BlocCoordonnees.schema';
import { propsChampNumeriqueMasque } from '../masqueNumerique';
import './BlocCoordonnees.css';

// Format téléphone français standard : 5 groupes de 2 chiffres (ex. "06 12 34 56 78").
const GROUPES_TELEPHONE = [2, 2, 2, 2, 2];
const LONGUEUR_TELEPHONE = 10;

// Bloc générique "coordonnées" : même contrat que BlocInfosPerso (valeurs, onChange,
// onValiditeChange) — rendu par BlocRenderer via blocRegistry, aucune connaissance du parcours global.
export default function BlocCoordonnees({ valeurs, onChange, onValiditeChange }) {
  const {
    register,
    formState: { errors, isValid },
    watch,
    setValue,
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

  // Espacement automatique pendant la saisie (affichage uniquement, voir masqueNumerique.js) —
  // la valeur suivie par react-hook-form et validée par le resolver zod reste sans espace.
  // Volontairement pas de {...register(...)} sur ces deux champs (voir le commentaire détaillé
  // dans masqueNumerique.js) : entièrement pilotés par value/onChange + setValue.
  const propsTelephone = propsChampNumeriqueMasque({
    valeurCourante: valeursSaisies.telephone,
    tailles: GROUPES_TELEPHONE,
    longueurChiffresMax: LONGUEUR_TELEPHONE,
    onChangerValeur: (chiffres) => setValue('telephone', chiffres, { shouldValidate: true }),
  });

  const propsContactUrgenceTelephone = propsChampNumeriqueMasque({
    valeurCourante: valeursSaisies.contactUrgenceTelephone,
    tailles: GROUPES_TELEPHONE,
    longueurChiffresMax: LONGUEUR_TELEPHONE,
    onChangerValeur: (chiffres) => setValue('contactUrgenceTelephone', chiffres, { shouldValidate: true }),
  });

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
        <input id="telephone" name="telephone" type="tel" autoComplete="tel" {...propsTelephone} />
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
        <input
          id="contactUrgenceTelephone"
          name="contactUrgenceTelephone"
          type="tel"
          {...propsContactUrgenceTelephone}
        />
        {errors.contactUrgenceTelephone && <p role="alert">{errors.contactUrgenceTelephone.message}</p>}
      </div>
    </fieldset>
  );
}
