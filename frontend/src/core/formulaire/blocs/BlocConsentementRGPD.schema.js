import { z } from 'zod';

const CHOIX_DIFFUSION = ['autorise', 'refuse'];

export const blocConsentementRgpdSchema = z.object({
  consentementDiffusion: z.enum(CHOIX_DIFFUSION, {
    required_error: 'Merci de choisir une option',
  }),
});
