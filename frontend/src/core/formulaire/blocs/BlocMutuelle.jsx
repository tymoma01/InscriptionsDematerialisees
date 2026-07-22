import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { blocMutuelleSchema } from './BlocMutuelle.schema';
import { propsRadioAccessible } from '../radioAccessible';

const CAS_DISPENSE = [
  {
    champ: 'cas1CmuC',
    libelle: 'Bénéficiez-vous de la CMU-C (Couverture Maladie Universelle Complémentaire) ?',
  },
  {
    champ: 'cas2Acs',
    libelle: "Bénéficiez-vous de l'ACS (Aide au paiement d'une Complémentaire Santé) ?",
  },
  {
    champ: 'cas3MutuelleIndividuelle',
    libelle:
      "Bénéficiez-vous d'une mutuelle individuelle au moment de la mise en place du régime obligatoire de l'entreprise ?",
  },
  {
    champ: 'cas4MutuelleCollective',
    libelle:
      "Bénéficiez-vous d'une mutuelle collective (y compris ayant droit d'un dispositif de prévoyance complémentaire de la SNCF, l'ENIM, l'IEG...) ?",
  },
];

// Bloc générique "mutuelle" : même contrat que les autres blocs (valeurs, onChange,
// onValiditeChange) — rendu par BlocRenderer via blocRegistry, aucune connaissance du parcours global.
export default function BlocMutuelle({ valeurs, onChange, onValiditeChange }) {
  const {
    register,
    formState: { errors, isValid },
    watch,
    setValue,
  } = useForm({
    mode: 'onChange',
    resolver: zodResolver(blocMutuelleSchema),
    defaultValues: {
      cas1CmuC: valeurs?.cas1CmuC,
      cas2Acs: valeurs?.cas2Acs,
      cas3MutuelleIndividuelle: valeurs?.cas3MutuelleIndividuelle,
      cas4MutuelleCollective: valeurs?.cas4MutuelleCollective,
      certificationAucuneDispense: valeurs?.certificationAucuneDispense ?? false,
    },
  });

  const valeursSaisies = watch();

  useEffect(() => {
    onChange(valeursSaisies);
  }, [JSON.stringify(valeursSaisies)]);

  useEffect(() => {
    onValiditeChange(isValid);
  }, [isValid]);

  // La certification n'est cochable que si les 4 cas de dispense sont tous renseignés à "Non"
  const aucuneDispense = CAS_DISPENSE.every((cas) => valeursSaisies[cas.champ] === 'non');

  // Dès qu'un cas redevient "Oui" après coup, on décoche automatiquement la certification :
  // sinon la case resterait cochée et désactivée, donc impossible à décocher soi-même.
  useEffect(() => {
    if (!aucuneDispense && valeursSaisies.certificationAucuneDispense) {
      setValue('certificationAucuneDispense', false, { shouldValidate: true });
    }
  }, [aucuneDispense]);

  return (
    <fieldset className="bloc-formulaire bloc-mutuelle">
      <legend>Mutuelle d'entreprise</legend>

      {CAS_DISPENSE.map((cas) => (
        <fieldset key={cas.champ}>
          <legend>
            {cas.libelle} <span className="champ-obligatoire">*</span>
          </legend>
          <label htmlFor={`${cas.champ}-oui`}>
            <input
              id={`${cas.champ}-oui`}
              type="radio"
              value="oui"
              {...propsRadioAccessible({
                register,
                setValue,
                champ: cas.champ,
                valeur: 'oui',
                valeurCourante: valeursSaisies[cas.champ],
              })}
            />
            Oui
          </label>
          <label htmlFor={`${cas.champ}-non`}>
            <input
              id={`${cas.champ}-non`}
              type="radio"
              value="non"
              {...propsRadioAccessible({
                register,
                setValue,
                champ: cas.champ,
                valeur: 'non',
                valeurCourante: valeursSaisies[cas.champ],
              })}
            />
            Non
          </label>
          {errors[cas.champ] && <p role="alert">{errors[cas.champ].message}</p>}
        </fieldset>
      ))}

      <label htmlFor="certificationAucuneDispense">
        <input
          id="certificationAucuneDispense"
          type="checkbox"
          disabled={!aucuneDispense}
          {...register('certificationAucuneDispense')}
        />
        Je certifie n'avoir aucun des justificatifs me dispensant d'adhérer à la mutuelle obligatoire à
        compter du 01/01/2016
      </label>
      {errors.certificationAucuneDispense && <p role="alert">{errors.certificationAucuneDispense.message}</p>}
    </fieldset>
  );
}
