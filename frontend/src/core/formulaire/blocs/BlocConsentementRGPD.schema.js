import { z } from 'zod';

const CHOIX_DIFFUSION = ['autorise', 'refuse'];

export const blocConsentementRgpdSchema = z
  .object({
    consentementDiffusion: z.enum(CHOIX_DIFFUSION, {
      required_error: 'Merci de choisir une option',
    }),
    signatureImage: z.string().optional().default(''),
  })
  // La signature n'est demandée/obligatoire que si le candidat autorise la diffusion
  .refine((valeurs) => valeurs.consentementDiffusion !== 'autorise' || valeurs.signatureImage !== '', {
    message: 'La signature électronique est obligatoire',
    path: ['signatureImage'],
  });
