import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { blocCharteSchema } from './BlocCharte.schema';
import SignatureElectronique from '../SignatureElectronique';
import './BlocCharte.css';

// Bloc générique "charte" : même contrat que les autres blocs (valeurs, onChange,
// onValiditeChange) — rendu par BlocRenderer via blocRegistry, aucune connaissance du parcours
// global. La mention recopiée n'est qu'une confirmation de lecture (jamais persistée telle
// quelle) ; la preuve légale repose sur le tracé de signature, stocké côté serveur en lien avec
// la version de charte active (voir dossierService.js).
export default function BlocCharte({ valeurs, onChange, onValiditeChange }) {
  const {
    register,
    formState: { errors, isValid },
    watch,
    setValue,
  } = useForm({
    mode: 'onChange',
    resolver: zodResolver(blocCharteSchema),
    defaultValues: {
      charteMention: valeurs?.charteMention ?? '',
      charteSignatureImage: valeurs?.charteSignatureImage ?? '',
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
    <fieldset className="bloc-formulaire bloc-charte">
      <legend>Charte ACCECIT</legend>

      <div className="bloc-charte__notice">
        <p>
          <strong>Préambule</strong> — Le présent règlement a pour objet de préciser les règles
          applicables au sein d'ACCECIT et chez ses entreprises clientes, dans l'intérêt de tous
          et pour la bonne marche du travail. Il s'applique à l'ensemble du personnel intérimaire
          et temporaire pendant la durée de sa mission.
        </p>

        <p>
          <strong>Article I — Ponctualité</strong> — Le salarié doit se présenter à son poste de
          travail à l'heure fixée, en tenue de travail complète et conforme aux exigences du
          poste.
        </p>

        <p>
          <strong>Article II — Respect du règlement et de la clientèle</strong> — Le salarié
          s'engage à respecter le règlement intérieur de l'entreprise cliente ainsi que sa
          clientèle. Ce règlement est disponible à l'accueil de l'agence et dans le cahier de
          correspondance de chaque site.
        </p>

        <p>
          <strong>Article III — Interdictions</strong> — Sont notamment interdits :
        </p>
        <ul>
          <li>la diffusion de tracts ou l'affichage non autorisé ;</li>
          <li>la circulation sans motif dans les zones réservées à la clientèle ;</li>
          <li>l'utilisation des chambres, salles de bains ou WC réservés à la clientèle ;</li>
          <li>toute vente ou tout achat avec les clients ou les employés de l'entreprise cliente ;</li>
          <li>les communications et visites personnelles, sauf urgence ;</li>
          <li>l'exécution de travaux personnels sur les lieux de travail ;</li>
          <li>l'emport non autorisé d'objets appartenant à l'entreprise cliente ;</li>
          <li>la dégradation d'affiches ;</li>
          <li>toute propagande politique, religieuse ou philosophique ;</li>
          <li>la réduction volontaire de la production.</li>
        </ul>

        <p>
          <strong>Article IV — Comportement et hygiène</strong> — Le salarié doit adopter un
          comportement courtois envers la clientèle. Il est interdit de pénétrer sur le lieu de
          travail en état d'ébriété ou d'y introduire des boissons alcoolisées, ainsi que de
          fumer dans les zones où cela est signalé. Le salarié doit veiller à sa propreté
          vestimentaire et corporelle. Toute absence ou tout retard doit être signalé sans délai,
          et un justificatif doit être fourni dans un délai de 48 heures.
        </p>

        <p>
          En cas d'urgence, un numéro est joignable au 01.56.56.69.56, du lundi au vendredi de 8h
          à 12h et de 14h à 18h, et le samedi et le dimanche de 8h à 15h. En dehors de ces
          horaires, un message peut être laissé.
        </p>
      </div>

      <div className="bloc-charte__confirmation">
        <p>Recopiez la mention suivante et signez : « Lu et Approuvé »</p>

        <label htmlFor="charteMention">Mention recopiée</label>
        <input id="charteMention" type="text" {...register('charteMention')} />
        {errors.charteMention && <p role="alert">{errors.charteMention.message}</p>}

        <SignatureElectronique
          valeur={valeursSaisies.charteSignatureImage}
          onChange={(image) => setValue('charteSignatureImage', image, { shouldValidate: true })}
        />
        {errors.charteSignatureImage && <p role="alert">{errors.charteSignatureImage.message}</p>}
      </div>
    </fieldset>
  );
}
