import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { blocDisponibilitesSchema } from './BlocDisponibilites.schema';
import { propsRadioAccessible } from '../radioAccessible';
import './BlocDisponibilites.css';

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
    setValue,
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
      autrePosteBureauPrecision: valeurs?.autrePosteBureauPrecision ?? '',
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
  const autrePosteBureauCoche = (valeursSaisies.posteBureau ?? []).includes('autres');
  const commentConnuSelectionne = valeursSaisies.commentConnu;
  // Visible et obligatoire pour les 3 mêmes options (voir BlocDisponibilites.schema.js) :
  // Internet, Autre et Cooptation.
  const commentConnuPrecisionVisible = ['internet', 'autre', 'cooptation'].includes(commentConnuSelectionne);

  useEffect(() => {
    if (!autrePosteBureauCoche) {
      setValue('autrePosteBureauPrecision', '');
    }
  }, [autrePosteBureauCoche]);

  return (
    <fieldset className="bloc-formulaire bloc-disponibilites">
      <legend>Disponibilités</legend>

      <label htmlFor="disponibiliteImmediate" className="bloc-disponibilites__case-immediate">
        <input id="disponibiliteImmediate" type="checkbox" {...register('disponibiliteImmediate')} />
        Disponible immédiatement
      </label>

      {!disponibleImmediatement && (
        <div className="bloc-disponibilites__dates">
          <div>
            <label htmlFor="dateDebut">
              Date de début de disponibilité <span className="champ-obligatoire">*</span>
            </label>
            <input id="dateDebut" type="date" {...register('dateDebut')} />
            {errors.dateDebut && <p role="alert">{errors.dateDebut.message}</p>}
          </div>

          <div>
            <label htmlFor="dateFin">
              Date de fin de disponibilité <span className="champ-obligatoire">*</span>
            </label>
            <input id="dateFin" type="date" {...register('dateFin')} />
            {errors.dateFin && <p role="alert">{errors.dateFin.message}</p>}
          </div>
        </div>
      )}

      <fieldset>
        <legend>
          Créneaux souhaités <span className="champ-obligatoire">*</span>
        </legend>
        <div className="bloc-disponibilites__options">
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
        </div>
      </fieldset>
      {errors.creneaux && <p role="alert">{errors.creneaux.message}</p>}

      <fieldset>
        <legend>
          Jours disponibles <span className="champ-obligatoire">*</span>
        </legend>
        <div className="bloc-disponibilites__options">
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
        </div>
      </fieldset>
      {errors.joursDisponibles && <p role="alert">{errors.joursDisponibles.message}</p>}

      <fieldset>
        <legend>Langues parlées</legend>
        <div className="bloc-disponibilites__options">
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
        </div>
      </fieldset>

      {autreLangueCochee && (
        <div className="bloc-disponibilites__champ-precision">
          <label htmlFor="autreLanguePrecision">
            Précisez la langue <span className="champ-obligatoire">*</span>
          </label>
          <input id="autreLanguePrecision" type="text" {...register('autreLanguePrecision')} />
          {errors.autreLanguePrecision && <p role="alert">{errors.autreLanguePrecision.message}</p>}
        </div>
      )}

      <fieldset>
        <legend>
          Type de poste recherché <span className="champ-obligatoire">*</span>
        </legend>
        <div className="bloc-disponibilites__options">
          <label htmlFor="typePoste-bureau">
            <input
              id="typePoste-bureau"
              type="radio"
              value="bureau"
              {...propsRadioAccessible({
                register,
                setValue,
                champ: 'typePoste',
                valeur: 'bureau',
                valeurCourante: typePosteSelectionne,
              })}
            />
            Bureau
          </label>
          <label htmlFor="typePoste-hotel">
            <input
              id="typePoste-hotel"
              type="radio"
              value="hotel"
              {...propsRadioAccessible({
                register,
                setValue,
                champ: 'typePoste',
                valeur: 'hotel',
                valeurCourante: typePosteSelectionne,
              })}
            />
            Hôtel
          </label>
        </div>
      </fieldset>
      {errors.typePoste && <p role="alert">{errors.typePoste.message}</p>}

      {typePosteSelectionne === 'bureau' && (
        <>
          <fieldset>
            <legend>
              Poste recherché (bureau) <span className="champ-obligatoire">*</span>
            </legend>
            <div className="bloc-disponibilites__options">
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
            </div>
          </fieldset>
          {errors.posteBureau && <p role="alert">{errors.posteBureau.message}</p>}
          {autrePosteBureauCoche && (
            <div className="bloc-disponibilites__champ-precision">
              <label htmlFor="autrePosteBureauPrecision">
                Précisez le poste <span className="champ-obligatoire">*</span>
              </label>
              <input id="autrePosteBureauPrecision" type="text" {...register('autrePosteBureauPrecision')} />
              {errors.autrePosteBureauPrecision && <p role="alert">{errors.autrePosteBureauPrecision.message}</p>}
            </div>
          )}
        </>
      )}

      {typePosteSelectionne === 'hotel' && (
        <>
          <fieldset>
            <legend>
              Poste recherché (hôtel) <span className="champ-obligatoire">*</span>
            </legend>
            <div className="bloc-disponibilites__options">
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
            </div>
          </fieldset>
          {errors.posteHotel && <p role="alert">{errors.posteHotel.message}</p>}
        </>
      )}

      <fieldset>
        <legend>
          Comment nous avez-vous connu ? <span className="champ-obligatoire">*</span>
        </legend>
        <div className="bloc-disponibilites__options">
          {COMMENT_CONNU.map((option) => (
            <label key={option.code} htmlFor={`commentConnu-${option.code}`}>
              <input
                id={`commentConnu-${option.code}`}
                type="radio"
                value={option.code}
                {...propsRadioAccessible({
                  register,
                  setValue,
                  champ: 'commentConnu',
                  valeur: option.code,
                  valeurCourante: commentConnuSelectionne,
                })}
              />
              {option.libelle}
            </label>
          ))}
        </div>
      </fieldset>
      {errors.commentConnu && <p role="alert">{errors.commentConnu.message}</p>}

      {commentConnuPrecisionVisible && (
        <div className="bloc-disponibilites__champ-precision">
          <label htmlFor="commentConnuPrecision">
            Précisez <span className="champ-obligatoire">*</span>
          </label>
          <input id="commentConnuPrecision" type="text" {...register('commentConnuPrecision')} />
          {errors.commentConnuPrecision && <p role="alert">{errors.commentConnuPrecision.message}</p>}
        </div>
      )}
    </fieldset>
  );
}
