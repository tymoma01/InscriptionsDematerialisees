import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { blocConsentementRgpdSchema } from './BlocConsentementRGPD.schema';
import { propsRadioAccessible } from '../radioAccessible';
import SignatureElectronique from '../SignatureElectronique';
import './BlocConsentementRGPD.css';

// Bloc générique "consentement RGPD" : même contrat que les autres blocs (valeurs, onChange,
// onValiditeChange) — rendu par BlocRenderer via blocRegistry, aucune connaissance du parcours global.
export default function BlocConsentementRGPD({ valeurs, onChange, onValiditeChange }) {
  const {
    register,
    formState: { errors, isValid },
    watch,
    setValue,
  } = useForm({
    mode: 'onChange',
    resolver: zodResolver(blocConsentementRgpdSchema),
    defaultValues: {
      consentementDiffusion: valeurs?.consentementDiffusion,
      signatureImage: valeurs?.signatureImage ?? '',
    },
  });

  const valeursSaisies = watch();

  useEffect(() => {
    onChange(valeursSaisies);
  }, [JSON.stringify(valeursSaisies)]);

  useEffect(() => {
    onValiditeChange(isValid);
  }, [isValid]);

  const autorise = valeursSaisies.consentementDiffusion === 'autorise';

  // Si le candidat revient sur "Je n'autorise pas" après avoir signé, la signature n'a plus
  // lieu d'être — on l'efface pour ne pas garder un tracé associé à un refus.
  useEffect(() => {
    if (!autorise && valeursSaisies.signatureImage) {
      setValue('signatureImage', '', { shouldValidate: true });
    }
  }, [autorise]);

  return (
    <fieldset className="bloc-formulaire bloc-consentement-rgpd">
      <legend>Consentement RGPD</legend>

      <div className="bloc-consentement-rgpd__notice">
        <p>
          Dans le cadre de votre inscription, ACCECIT collecte les données suivantes vous
          concernant : civilité, nom, prénom, adresse email, téléphone, adresse postale, date et
          lieu de naissance, situation familiale, nationalité, ainsi que, le cas échéant, une
          copie de votre pièce d'identité, votre CV et une photo d'identité.
        </p>
        <p>
          Ces données sont collectées et traitées aux fins de gestion de votre dossier de
          candidat et de mise en relation avec nos entreprises clientes, sur le fondement de la
          loi Informatique et Libertés du 6 janvier 1978 modifiée et du Règlement Général sur la
          Protection des Données (RGPD) du 25 mai 2018.
        </p>
        <p>
          Conformément à cette réglementation, vous disposez d'un droit de rectification et de
          suppression des données vous concernant, que vous pouvez exercer à tout moment auprès
          d'ACCECIT.
        </p>
      </div>

      <fieldset>
        <legend>
          Autorisation de diffusion de vos données <span className="champ-obligatoire">*</span>
        </legend>

        <label className="bloc-consentement-rgpd__option" htmlFor="consentementDiffusion-autorise">
          <input
            id="consentementDiffusion-autorise"
            type="radio"
            value="autorise"
            {...propsRadioAccessible({
              register,
              setValue,
              champ: 'consentementDiffusion',
              valeur: 'autorise',
              valeurCourante: valeursSaisies.consentementDiffusion,
            })}
          />
          J'autorise les sociétés ACCECIT HOTELLERIE et ACCECIT TERTIAIRE à utiliser et diffuser à
          titre gratuit et non exclusif toutes les données mentionnées ci-dessus, susceptibles
          d'être reproduites sur les supports suivants : publication dans nos bases de données
          QUADRA, PEGASE, SILAE et MOVEWORK.
        </label>

        <label className="bloc-consentement-rgpd__option" htmlFor="consentementDiffusion-refuse">
          <input
            id="consentementDiffusion-refuse"
            type="radio"
            value="refuse"
            {...propsRadioAccessible({
              register,
              setValue,
              champ: 'consentementDiffusion',
              valeur: 'refuse',
              valeurCourante: valeursSaisies.consentementDiffusion,
            })}
          />
          Je n'autorise pas les sociétés ACCECIT HOTELLERIE et ACCECIT TERTIAIRE à utiliser et
          diffuser toutes les données mentionnées ci-dessus me concernant.
        </label>
      </fieldset>
      {errors.consentementDiffusion && <p role="alert">{errors.consentementDiffusion.message}</p>}

      {autorise && (
        <div className="bloc-consentement-rgpd__signature">
          <p>
            Merci de signer ci-dessous pour confirmer votre autorisation.{' '}
            <span className="champ-obligatoire">*</span>
          </p>
          <SignatureElectronique
            valeur={valeursSaisies.signatureImage}
            onChange={(image) => setValue('signatureImage', image, { shouldValidate: true })}
          />
          {errors.signatureImage && <p role="alert">{errors.signatureImage.message}</p>}
        </div>
      )}
    </fieldset>
  );
}
