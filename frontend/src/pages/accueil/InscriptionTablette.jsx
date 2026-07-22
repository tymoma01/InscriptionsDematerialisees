import { useEffect, useState } from 'react';
import FormulaireInscription from '../../core/formulaire/FormulaireInscription';
import { formulaireConfigAccecitTest } from '../../core/formulaire/donneesTest/formulaireConfig.accecit';
import ConfirmationInscription from './ConfirmationInscription';
import logoAccecit from '../../assets/logo-accecit-blanc.png';
import iconeAccecitHotellerie from '../../assets/icone-accecit-hotellerie.png';
import iconeAccecitTertiaire from '../../assets/icone-accecit-tertiaire.png';
import PiedDePageFormulaire from './PiedDePageFormulaire';
import FiligraneFormulaire from './FiligraneFormulaire';
import './InscriptionTablette.css';

// Logos des sous-marques : icône (image) + texte (HTML) plutôt qu'un unique visuel figé, pour
// pouvoir adapter la couleur du texte au fond de l'en-tête (voir InscriptionTablette.css) sans
// dépendre d'une déclinaison de couleur préexistante côté site officiel.
function LogoSousMarque({ icone, nom }) {
  return (
    <div className="page-inscription-tablette__logo-marque">
      <img className="page-inscription-tablette__logo-marque-icone" src={icone} alt="" />
      <div className="page-inscription-tablette__logo-marque-texte">
        <span className="page-inscription-tablette__logo-marque-nom">ACCECIT</span>
        <span className="page-inscription-tablette__logo-marque-sous-nom">{nom}</span>
      </div>
    </div>
  );
}

// Page accueil tablette : instancie le moteur de formulaire avec la config de l'entité.
// La config vient de données de test locales tant que le backend n'est pas branché ;
// elle sera remplacée par le résultat de l'appel à l'API (résolution via entiteContext).
export default function InscriptionTablette() {
  // Une fois renseigné (voir onInscriptionReussie ci-dessous), l'écran de confirmation remplace
  // le formulaire — la mention "* Champs obligatoires" n'a plus lieu d'être une fois
  // l'inscription terminée, elle ne doit donc apparaître que dans la branche formulaire.
  const [dossierIdConfirmation, setDossierIdConfirmation] = useState(null);

  // DEV UNIQUEMENT — À RETIRER une fois inutile : ?apercu_confirmation=<dossierId> affiche
  // directement l'écran de confirmation avec ce dossierId, sans passer par une inscription
  // réelle. Utile pour prévisualiser cet écran quand la soumission échoue pour une raison
  // indépendante du front (ex. secret Key Vault nir-hmac-key pas encore créé côté infra).
  // Exemple : http://localhost:5173/?apercu_confirmation=52
  useEffect(() => {
    const dossierIdApercu = new URLSearchParams(window.location.search).get('apercu_confirmation');
    if (dossierIdApercu) setDossierIdConfirmation(dossierIdApercu);
  }, []);

  return (
    <main className="page-inscription-tablette">
      <FiligraneFormulaire />
      <header className="page-inscription-tablette__entete">
        <div className="page-inscription-tablette__entete-contenu">
          <img
            className="page-inscription-tablette__logo"
            src={logoAccecit}
            alt="ACCECIT — Nettoyage à visage humain"
          />
          <div className="page-inscription-tablette__logos-marques">
            <LogoSousMarque icone={iconeAccecitHotellerie} nom="Hôtellerie" />
            <LogoSousMarque icone={iconeAccecitTertiaire} nom="Tertiaire" />
          </div>
        </div>
      </header>
      <div className="page-inscription-tablette__contenu">
        {dossierIdConfirmation ? (
          <ConfirmationInscription dossierId={dossierIdConfirmation} />
        ) : (
          <>
            <h1>Inscription candidat</h1>
            <p className="page-inscription-tablette__mention-obligatoire">* Champs obligatoires</p>
            <FormulaireInscription
              configBlocs={formulaireConfigAccecitTest}
              onInscriptionReussie={({ dossierId }) => setDossierIdConfirmation(dossierId)}
            />
          </>
        )}
      </div>
      <PiedDePageFormulaire />
    </main>
  );
}
