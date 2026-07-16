const { z } = require('zod');
const { obtenirKnex } = require('../../db/knex');
const { chiffrer } = require('../securite/nirCipher');
const dossierRepository = require('./dossierRepository');

const TELEPHONE_REGEX = /^0[1-9](\s?\d{2}){4}$/;
const NIR_REGEX = /^\d{13}\s?\d{2}$/;
const NOM_REGEX = /^[A-Za-zÀ-ÖØ-öø-ÿ' -]+$/;

// Même contrat que les schémas front (BlocInfosPerso.schema.js / BlocCoordonnees.schema.js),
// revalidé côté serveur — la validation front ne suffit jamais à sécuriser une écriture en base.
const donneesInscriptionSchema = z.object({
  nom: z.string().trim().min(1),
  prenom: z.string().trim().min(1),
  dateNaissance: z.string().min(1),
  nir: z.string().trim().regex(NIR_REGEX),
  situationFamiliale: z.string().min(1),
  adresse: z.string().trim().min(1),
  telephone: z.string().trim().regex(TELEPHONE_REGEX),
  email: z.string().trim().email(),
  contactUrgenceNom: z.string().trim().min(1).regex(NOM_REGEX),
  contactUrgenceTelephone: z.string().trim().regex(TELEPHONE_REGEX),
});

// Assemble candidat (bloc infos_perso) + dossier + données du bloc coordonnées dans une
// seule transaction : soit tout est enregistré, soit rien ne l'est (pas de candidat orphelin
// sans dossier en cas d'échec à mi-parcours).
async function inscrireCandidat(entite, donneesBrutes) {
  const donnees = donneesInscriptionSchema.parse(donneesBrutes);
  const nirSansEspaces = donnees.nir.replace(/\s/g, '');
  const { nirChiffre, iv } = await chiffrer(nirSansEspaces);

  const bd = await obtenirKnex();
  return bd.transaction(async (trx) => {
    const candidatId = await dossierRepository.insererCandidat(trx, {
      entiteId: entite.id,
      nom: donnees.nom,
      prenom: donnees.prenom,
      dateNaissance: donnees.dateNaissance,
      situationFamiliale: donnees.situationFamiliale,
      nirChiffre,
      nirIv: iv,
    });

    const statutInitial = await dossierRepository.trouverStatutInitial(trx, entite.id);
    if (!statutInitial) {
      throw new Error(`Aucun statut initial configuré pour l'entité « ${entite.code} ».`);
    }

    const dossierId = await dossierRepository.creerDossier(trx, {
      candidatId,
      entiteId: entite.id,
      statutId: statutInitial.id,
    });

    await dossierRepository.enregistrerDonneesBloc(trx, {
      dossierId,
      blocCode: 'coordonnees',
      donnees: {
        adresse: donnees.adresse,
        telephone: donnees.telephone,
        email: donnees.email,
        contactUrgenceNom: donnees.contactUrgenceNom,
        contactUrgenceTelephone: donnees.contactUrgenceTelephone,
      },
    });

    return { candidatId, dossierId };
  });
}

module.exports = { inscrireCandidat };
