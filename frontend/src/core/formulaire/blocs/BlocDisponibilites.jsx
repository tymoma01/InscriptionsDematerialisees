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

const POSTES_BUREAU = [
  { code: 'nettoyage', libelle: 'Nettoyage' },
  { code: 'chef_equipe', libelle: "Chef d'équipe" },
  { code: 'autres', libelle: 'Autres' },
];

const POSTES_HOTEL = [
  { code: 'femme_valet_chambre', libelle: 'Femme/Valet de chambre' },
  { code: 'cafetier', libelle: 'Cafétier(ère)' },
  { code: 'equipier', libelle: 'Équipier(ère)' },
  { code: 'gouvernant', libelle: 'Gouvernant(e)' },
];

const COMMENT_CONNU = [
  { code: 'bouche_a_oreille', libelle: 'Bouche à oreille' },
  { code: 'internet', libelle: 'Internet' },
  { code: 'cooptation', libelle: 'Cooptation' },
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
      typePoste: valeurs?.typePoste,
      posteBureau: valeurs?.posteBureau ?? [],
      posteHotel: valeurs?.posteHotel ?? [],
      commentConnu: valeurs?.commentConnu,
      commentConnuPrecision: valeurs?.commentConnuPrecision ?? '',
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
  const typePosteSelectionne = valeursSaisies.typePoste;
  const commentConnuSelectionne = valeursSaisies.commentConnu;
  const commentConnuPrecisionVisible = ['internet', 'autre'].includes(commentConnuSelectionne);

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

      <fieldset>
        <legend>Type de poste recherché</legend>
        <label htmlFor="typePoste-bureau">
          <input id="typePoste-bureau" type="radio" value="bureau" {...register('typePoste')} />
          Bureau
        </label>
        <label htmlFor="typePoste-hotel">
          <input id="typePoste-hotel" type="radio" value="hotel" {...register('typePoste')} />
          Hôtel
        </label>
      </fieldset>
      {errors.typePoste && <p role="alert">{errors.typePoste.message}</p>}

      {typePosteSelectionne === 'bureau' && (
        <>
          <fieldset>
            <legend>Poste recherché (bureau)</legend>
            {POSTES_BUREAU.map((poste) => (
              <label key={poste.code} htmlFor={`posteBureau-${poste.code}`}>
                <input
                  id={`posteBureau-${poste.code}`}
                  type="checkbox"
                  value={poste.code}
                  {...register('posteBureau')}
                />
                {poste.libelle}
              </label>
            ))}
          </fieldset>
          {errors.posteBureau && <p role="alert">{errors.posteBureau.message}</p>}
        </>
      )}

      {typePosteSelectionne === 'hotel' && (
        <>
          <fieldset>
            <legend>Poste recherché (hôtel)</legend>
            {POSTES_HOTEL.map((poste) => (
              <label key={poste.code} htmlFor={`posteHotel-${poste.code}`}>
                <input
                  id={`posteHotel-${poste.code}`}
                  type="checkbox"
                  value={poste.code}
                  {...register('posteHotel')}
                />
                {poste.libelle}
              </label>
            ))}
          </fieldset>
          {errors.posteHotel && <p role="alert">{errors.posteHotel.message}</p>}
        </>
      )}

      <fieldset>
        <legend>Comment nous avez-vous connu ?</legend>
        {COMMENT_CONNU.map((option) => (
          <label key={option.code} htmlFor={`commentConnu-${option.code}`}>
            <input
              id={`commentConnu-${option.code}`}
              type="radio"
              value={option.code}
              {...register('commentConnu')}
            />
            {option.libelle}
          </label>
        ))}
      </fieldset>
      {errors.commentConnu && <p role="alert">{errors.commentConnu.message}</p>}

      {commentConnuPrecisionVisible && (
        <>
          <label htmlFor="commentConnuPrecision">Précisez</label>
          <input id="commentConnuPrecision" type="text" {...register('commentConnuPrecision')} />
          {errors.commentConnuPrecision && <p role="alert">{errors.commentConnuPrecision.message}</p>}
        </>
      )}
    </fieldset>
  );
}
