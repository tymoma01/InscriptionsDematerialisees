import FormulaireInscription from '../../core/formulaire/FormulaireInscription';
import { formulaireConfigAccecitTest } from '../../core/formulaire/donneesTest/formulaireConfig.accecit';
import logoAccecit from '../../assets/logo-accecit-fonce.png';
import logoAccecitHotellerie from '../../assets/logo-accecit-hotellerie.png';
import logoAccecitTertiaire from '../../assets/logo-accecit-tertiaire.png';
import './InscriptionTablette.css';

// Page accueil tablette : instancie le moteur de formulaire avec la config de l'entité.
// La config vient de données de test locales tant que le backend n'est pas branché ;
// elle sera remplacée par le résultat de l'appel à l'API (résolution via entiteContext).
export default function InscriptionTablette() {
  return (
    <main className="page-inscription-tablette">
      <div className="page-inscription-tablette__entete">
        <img
          className="page-inscription-tablette__logo"
          src={logoAccecit}
          alt="ACCECIT — Nettoyage à visage humain"
        />
        <div className="page-inscription-tablette__logos-marques">
          <img
            className="page-inscription-tablette__logo-marque"
            src={logoAccecitHotellerie}
            alt="ACCECIT Hôtellerie"
          />
          <img
            className="page-inscription-tablette__logo-marque"
            src={logoAccecitTertiaire}
            alt="ACCECIT Tertiaire"
          />
        </div>
      </div>
      <h1>Inscription candidat</h1>
      <FormulaireInscription configBlocs={formulaireConfigAccecitTest} />
    </main>
  );
}
