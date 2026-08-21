import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { blocCoordonneesSchema } from './BlocCoordonnees.schema';
import { propsChampNumeriqueMasque } from '../masqueNumerique';
import { verifierDisponibilite } from '../../../services/candidatService';
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
      codePostal: valeurs?.codePostal ?? '',
      ville: valeurs?.ville ?? '',
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

  // Vérification d'unicité en temps réel (au blur, voir gererBlurEmail plus bas) — distincte de la
  // validation de format (isValid ci-dessus) : un email peut être bien formé mais déjà utilisé
  // par un autre dossier. Tant que ce conflit n'est pas résolu, le bloc reste invalide (voir
  // useEffect onValiditeChange plus bas) pour empêcher d'avancer avec un email en conflit.
  const [erreurDisponibiliteEmail, setErreurDisponibiliteEmail] = useState(null);

  useEffect(() => {
    setErreurDisponibiliteEmail(null);
  }, [valeursSaisies.email]);

  useEffect(() => {
    onValiditeChange(isValid && !erreurDisponibiliteEmail);
  }, [isValid, erreurDisponibiliteEmail]);

  // register('email') capturé à part (plutôt que {...register('email')} directement dans le
  // JSX) pour pouvoir composer son onBlur natif (validation/état "touched" de react-hook-form)
  // avec la vérification d'unicité ci-dessous, sans perdre l'un ou l'autre.
  const champEmail = register('email');

  const gererBlurEmail = async (evenement) => {
    champEmail.onBlur(evenement);
    const email = evenement.target.value.trim();
    if (!email || errors.email) return;
    try {
      const disponible = await verifierDisponibilite('email', email);
      setErreurDisponibiliteEmail(disponible ? null : 'Cet email est déjà utilisé.');
    } catch {
      // Panne réseau ponctuelle : ne pas bloquer la saisie, la vérification finale à la
      // soumission reste le filet de sécurité (voir dossierService.inscrireCandidat, 409).
      setErreurDisponibiliteEmail(null);
    }
  };

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
          Numéro et nom de rue <span className="champ-obligatoire">*</span>
        </label>
        <input id="adresse" type="text" autoComplete="address-line1" {...register('adresse')} />
        {errors.adresse && <p role="alert">{errors.adresse.message}</p>}
      </div>

      <div className="bloc-coordonnees__champ">
        <label htmlFor="codePostal">
          Code postal <span className="champ-obligatoire">*</span>
        </label>
        <input id="codePostal" type="text" inputMode="numeric" autoComplete="postal-code" {...register('codePostal')} />
        {errors.codePostal && <p role="alert">{errors.codePostal.message}</p>}
      </div>

      <div className="bloc-coordonnees__champ">
        <label htmlFor="ville">
          Ville <span className="champ-obligatoire">*</span>
        </label>
        <input id="ville" type="text" autoComplete="address-level2" {...register('ville')} />
        {errors.ville && <p role="alert">{errors.ville.message}</p>}
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
        <input id="email" type="email" autoComplete="email" {...champEmail} onBlur={gererBlurEmail} />
        {errors.email && <p role="alert">{errors.email.message}</p>}
        {!errors.email && erreurDisponibiliteEmail && <p role="alert">{erreurDisponibiliteEmail}</p>}
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
