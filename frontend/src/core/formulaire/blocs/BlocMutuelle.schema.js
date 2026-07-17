import { z } from 'zod';

const OUI_NON = ['oui', 'non'];

export const blocMutuelleSchema = z
  .object({
    cas1CmuC: z.enum(OUI_NON, { required_error: 'Merci de répondre à cette question' }),
    cas2Acs: z.enum(OUI_NON, { required_error: 'Merci de répondre à cette question' }),
    cas3MutuelleIndividuelle: z.enum(OUI_NON, { required_error: 'Merci de répondre à cette question' }),
    cas4MutuelleCollective: z.enum(OUI_NON, { required_error: 'Merci de répondre à cette question' }),
    certificationAucuneDispense: z.boolean().default(false),
  })
  // La certification est contradictoire dès qu'un des 4 cas de dispense est "Oui" —
  // elle ne peut être cochée que si les 4 cas sont à "Non".
  .refine(
    (valeurs) =>
      !valeurs.certificationAucuneDispense ||
      [valeurs.cas1CmuC, valeurs.cas2Acs, valeurs.cas3MutuelleIndividuelle, valeurs.cas4MutuelleCollective].every(
        (cas) => cas === 'non',
      ),
    {
      message: "La certification n'est possible que si les 4 cas de dispense sont à « Non »",
      path: ['certificationAucuneDispense'],
    },
  );
