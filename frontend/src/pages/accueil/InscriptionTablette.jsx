import FormulaireInscription from '../../core/formulaire/FormulaireInscription';
import { formulaireConfigAccecitTest } from '../../core/formulaire/donneesTest/formulaireConfig.accecit';
import logoAccecit from '../../assets/logo-accecit-blanc.png';
import logoAccecitHotellerie from '../../assets/logo-accecit-hotellerie-blanc.png';
import logoAccecitTertiaire from '../../assets/logo-accecit-tertiaire-blanc.png';
import './InscriptionTablette.css';

// Page accueil tablette : instancie le moteur de formulaire avec la config de l'entité.
// La config vient de données de test locales tant que le backend n'est pas branché ;
// elle sera remplacée par le résultat de l'appel à l'API (résolution via entiteContext).
export default function InscriptionTablette() {
  return (
    <main className="page-inscription-tablette">
      <header className="page-inscription-tablette__entete">
        <div className="page-inscription-tablette__entete-contenu">
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
      </header>
      <div className="page-inscription-tablette__contenu">
        <h1>Inscription candidat</h1>
        <FormulaireInscription configBlocs={formulaireConfigAccecitTest} />
      </div>
    </main>
  );
}
