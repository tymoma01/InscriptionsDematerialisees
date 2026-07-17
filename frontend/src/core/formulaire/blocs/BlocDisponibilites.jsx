import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { blocDisponibilitesSchema } from './BlocDisponibilites.schema';

const CRENEAUX = [
  { code: 'matin', libelle: 'Matin' },
  { code: 'midi', libelle: 'Midi' },
  { code: 'soir', libelle: 'Soir' },
];

const JOURS = [
  { code: 'lundi', libelle: 'Lundi' },
  { code: 'mardi', libelle: 'Mardi' },
  { code: 'mercredi', libelle: 'Mercredi' },
  { code: 'jeudi', libelle: 'Jeudi' },
  { code: 'vendredi', libelle: 'Vendredi' },
  { code: 'samedi', libelle: 'Samedi' },
  { code: 'dimanche', libelle: 'Dimanche' },
];

const LANGUES = [
  { code: 'francais', libelle: 'Français' },
  { code: 'anglais', libelle: 'Anglais' },
  { code: 'autre', libelle: 'Autre' },
];

// Bloc générique "disponibilités" : même contrat que BlocCoordonnees (valeurs, onChange,
// onValiditeChange) — rendu par BlocRenderer via blocRegistry, aucune connaissance du parcours global.
export default function BlocDisponibilites({ valeurs, onChange, onValiditeChange }) {
  const {
    register,
    formState: { errors, isValid },
    watch,
  } = useForm({
    mode: 'onChange',
    resolver: zodResolver(blocDisponibilitesSchema),
    defaultValues: {
      disponibiliteImmediate: valeurs?.disponibiliteImmediate ?? true,
      dateDebut: valeurs?.dateDebut ?? '',
      dateFin: valeurs?.dateFin ?? '',
      creneaux: valeurs?.creneaux ?? [],
      joursDisponibles: valeurs?.joursDisponibles ?? [],
      languesParlees: valeurs?.languesParlees ?? [],
      autreLanguePrecision: valeurs?.autreLanguePrecision ?? '',
    },
  });

  const valeursSaisies = watch();

  useEffect(() => {
    onChange(valeursSaisies);
  }, [JSON.stringify(valeursSaisies)]);

  useEffect(() => {
    onValiditeChange(isValid);
  }, [isValid]);

  const disponibleImmediatement = valeursSaisies.disponibiliteImmediate;
  const autreLangueCochee = (valeursSaisies.languesParlees ?? []).includes('autre');

  return (
    <fieldset className="bloc-formulaire bloc-disponibilites">
      <legend>Disponibilités</legend>

      <label htmlFor="disponibiliteImmediate">
        <input id="disponibiliteImmediate" type="checkbox" {...register('disponibiliteImmediate')} />
        Disponible immédiatement
      </label>

      {!disponibleImmediatement && (
        <>
          <label htmlFor="dateDebut">Date de début de disponibilité</label>
          <input id="dateDebut" type="date" {...register('dateDebut')} />
          {errors.dateDebut && <p role="alert">{errors.dateDebut.message}</p>}

          <label htmlFor="dateFin">Date de fin de disponibilité</label>
          <input id="dateFin" type="date" {...register('dateFin')} />
          {errors.dateFin && <p role="alert">{errors.dateFin.message}</p>}
        </>
      )}

      <fieldset>
        <legend>Créneaux souhaités</legend>
        {CRENEAUX.map((creneau) => (
          <label key={creneau.code} htmlFor={`creneau-${creneau.code}`}>
            <input
              id={`creneau-${creneau.code}`}
              type="checkbox"
              value={creneau.code}
              {...register('creneaux')}
            />
            {creneau.libelle}
          </label>
        ))}
      </fieldset>
      {errors.creneaux && <p role="alert">{errors.creneaux.message}</p>}

      <fieldset>
        <legend>Jours disponibles</legend>
        {JOURS.map((jour) => (
          <label key={jour.code} htmlFor={`jour-${jour.code}`}>
            <input
              id={`jour-${jour.code}`}
              type="checkbox"
              value={jour.code}
              {...register('joursDisponibles')}
            />
            {jour.libelle}
          </label>
        ))}
      </fieldset>
      {errors.joursDisponibles && <p role="alert">{errors.joursDisponibles.message}</p>}

      <fieldset>
        <legend>Langues parlées</legend>
        {LANGUES.map((langue) => (
          <label key={langue.code} htmlFor={`langue-${langue.code}`}>
            <input
              id={`langue-${langue.code}`}
              type="checkbox"
              value={langue.code}
              {...register('languesParlees')}
            />
            {langue.libelle}
          </label>
        ))}
      </fieldset>

      {autreLangueCochee && (
        <>
          <label htmlFor="autreLanguePrecision">Précisez la langue</label>
          <input id="autreLanguePrecision" type="text" {...register('autreLanguePrecision')} />
          {errors.autreLanguePrecision && <p role="alert">{errors.autreLanguePrecision.message}</p>}
        </>
      )}
    </fieldset>
  );
}
