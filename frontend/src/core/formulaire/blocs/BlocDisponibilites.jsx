import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useRef } from 'react';
import { blocDisponibilitesSchema } from './BlocDisponibilites.schema';
import { propsRadioAccessible } from '../radioAccessible';
import './BlocDisponibilites.css';

// Deux sous-blocs "Créneaux souhaités" distincts selon le type de poste (voir
// BlocDisponibilites.schema.js pour le vocabulaire de codes correspondant, CRENEAUX_HOTEL/
// CRENEAUX_BUREAU) — un seul affiché à la fois, jamais les deux ensemble (voir typePosteSelectionne
// plus bas), même patron que Poste recherché (bureau)/(hôtel).
const CRENEAUX_HOTEL = [
  { code: 'matin', libelle: 'Matin' },
  { code: 'midi', libelle: 'Midi' },
  { code: 'soir', libelle: 'Soir' },
];
const CRENEAUX_BUREAU = [
  { code: '6h-9h', libelle: '6h-9h' },
  { code: '9h-18h', libelle: '9h-18h' },
  { code: '18h-21h', libelle: '18h-21h' },
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

// Jours dont la présence est obligatoire côté hôtellerie (activité du week-end) — même paire que
// le .refine dédié de BlocDisponibilites.schema.js, dupliqué ici tel quel plutôt que partagé
// (deux codes, pas de quoi justifier un import croisé composant/schéma).
const JOURS_WEEK_END_HOTEL = ['samedi', 'dimanche'];

const LANGUES = [
  { code: 'francais', libelle: 'Français' },
  { code: 'anglais', libelle: 'Anglais' },
  { code: 'autre', libelle: 'Autre' },
];

const POSTES_BUREAU = [
  { code: 'nettoyage', libelle: 'Nettoyage' },
  { code: 'vitrerie', libelle: 'Vitrerie' },
  { code: 'machiniste', libelle: 'Machiniste' },
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
  // Vide dès que le candidat repasse à "Bureau" (ou n'a encore rien choisi) : purement dérivé de
  // typePosteSelectionne, jamais stocké — aucun jour déjà coché n'est donc jamais décoché par ce
  // changement, seuls cet astérisque et la validation associée (voir schéma) se relâchent.
  const jourWeekEndObligatoire = typePosteSelectionne === 'hotel' ? JOURS_WEEK_END_HOTEL : [];
  // Recalculé en dérivé plutôt que lu depuis errors.joursDisponibles : le .refine() correspondant
  // (BlocDisponibilites.schema.js) bloque déjà correctement isValid/"Suivant" (confirmé), mais
  // react-hook-form + zodResolver ne remonte jamais le message d'un .refine() au niveau objet
  // dans `errors` ici (constaté aussi bien sur ce refine que sur les refines déjà en place avant
  // lui — posteBureau/posteHotel/dateDebut/dateFin... — donc pas une régression propre à ce
  // changement) — même contournement déjà adopté dans ce projet pour un problème de fiabilité
  // react-hook-form/zod équivalent, voir calculerErreurCoherenceNir (BlocInfosPerso.jsx).
  // Neutralisé tant qu'aucun jour n'est encore coché : l'erreur de base (`errors.joursDisponibles`,
  // "Sélectionnez au moins un jour disponible") reste seule affichée dans ce cas (voir le rendu).
  const joursDisponiblesSaisis = valeursSaisies.joursDisponibles ?? [];
  const erreurWeekEndHotel =
    typePosteSelectionne === 'hotel' &&
    joursDisponiblesSaisis.length > 0 &&
    !(joursDisponiblesSaisis.includes('samedi') && joursDisponiblesSaisis.includes('dimanche'))
      ? 'Les postes en hôtellerie nécessitent une disponibilité le week-end (samedi et dimanche)'
      : null;
  // Même contournement que erreurWeekEndHotel ci-dessus (le .refine() correspondant,
  // BlocDisponibilites.schema.js, bloque déjà correctement isValid/"Suivant" mais ne remonte pas
  // dans errors.creneaux) — couvre ici aussi bien "rien coché" que "9h-18h seul" (pas de garde
  // sur creneauxSaisis.length, contrairement à erreurWeekEndHotel) : errors.creneaux (base
  // .min(1)) s'est révélé peu fiable pour afficher son propre message dans ce cas précis (constaté
  // en test manuel), ce message-ci reste donc la seule source fiable pour "rien coché" côté bureau.
  const creneauxSaisis = valeursSaisies.creneaux ?? [];
  const erreurCreneauxBureau =
    typePosteSelectionne === 'bureau' &&
    !(creneauxSaisis.includes('6h-9h') || creneauxSaisis.includes('18h-21h'))
      ? 'Sélectionnez au moins un créneau 6h-9h ou 18h-21h (9h-18h seul ne suffit pas)'
      : null;
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

  // Vide les créneaux déjà cochés dès que le candidat CHANGE réellement de type de poste
  // (bureau <-> hôtel) : les deux vocabulaires (Matin/Midi/Soir vs 6h-9h/9h-18h/18h-21h) n'ont pas
  // le même sens, ne doivent jamais cohabiter en mémoire (voir le .refine dédié,
  // BlocDisponibilites.schema.js). Le ref se réconcilie avec la valeur courante au tout premier
  // rendu : une transition undefined -> 'bureau'/'hotel' (premier choix du candidat, ou remontage
  // de ce bloc en revenant sur une étape précédente avec un typePoste déjà enregistré) ne
  // déclenche donc jamais ce reset — seul un changement qui survient PENDANT que ce composant est
  // déjà monté (l'utilisateur bascule effectivement son choix) le fait.
  const typePostePrecedentRef = useRef(typePosteSelectionne);
  useEffect(() => {
    if (typePostePrecedentRef.current != null && typePostePrecedentRef.current !== typePosteSelectionne) {
      setValue('creneaux', [], { shouldValidate: true });
    }
    typePostePrecedentRef.current = typePosteSelectionne;
  }, [typePosteSelectionne]);

  return (
    <fieldset className="bloc-formulaire bloc-disponibilites">
      <legend>Disponibilités</legend>

      {/* Type de poste recherché en tout début de bloc, juste au-dessus de "Disponible
          immédiatement" (décision utilisateur, 2026-08-17) — inchangé par ailleurs (contenu,
          validation, options Poste recherché (bureau)/(hôtel) qui restent conditionnées à ce
          choix et affichées plus bas, après Langues parlées, comme avant ce déplacement). */}
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

      {/* Un seul des deux sous-blocs à la fois, selon le type de poste — jamais les deux
          ensemble, et aucun tant qu'aucun poste n'est encore sélectionné (même patron que Poste
          recherché (bureau)/(hôtel) plus bas). Les créneaux déjà cochés sont vidés à chaque
          changement réel de poste (voir l'effet dédié ci-dessus) : pas de risque de cohabitation
          entre les deux vocabulaires en mémoire. */}
      {typePosteSelectionne === 'hotel' && (
        <fieldset>
          <legend>
            Créneaux souhaités <span className="champ-obligatoire">*</span>
          </legend>
          <div className="bloc-disponibilites__options">
            {CRENEAUX_HOTEL.map((creneau) => (
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
      )}
      {typePosteSelectionne === 'bureau' && (
        <fieldset>
          <legend>
            Créneaux souhaités <span className="champ-obligatoire">*</span>
          </legend>
          <div className="bloc-disponibilites__options">
            {CRENEAUX_BUREAU.map((creneau) => (
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
      )}
      {errors.creneaux && <p role="alert">{errors.creneaux.message}</p>}
      {!errors.creneaux && erreurCreneauxBureau && <p role="alert">{erreurCreneauxBureau}</p>}

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
              {/* Astérisque supplémentaire sur Samedi/Dimanche uniquement pour l'hôtellerie (voir
                  le .refine dédié, BlocDisponibilites.schema.js) — les autres jours restent
                  couverts par le seul astérisque générique du <legend> ("au moins un jour"). Ne
                  décoche jamais rien si le candidat repasse de Hôtel à Bureau (aucun setValue
                  ici) : seuls cet astérisque et la validation associée disparaissent. */}
              {jourWeekEndObligatoire.includes(jour.code) && <span className="champ-obligatoire"> *</span>}
            </label>
          ))}
        </div>
      </fieldset>
      {errors.joursDisponibles && <p role="alert">{errors.joursDisponibles.message}</p>}
      {!errors.joursDisponibles && erreurWeekEndHotel && <p role="alert">{erreurWeekEndHotel}</p>}

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
