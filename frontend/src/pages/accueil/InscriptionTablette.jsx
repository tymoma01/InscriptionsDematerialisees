import FormulaireInscription from '../../core/formulaire/FormulaireInscription';
import { formulaireConfigAccecitTest } from '../../core/formulaire/donneesTest/formulaireConfig.accecit';

// Page accueil tablette : instancie le moteur de formulaire avec la config de l'entité.
// La config vient de données de test locales tant que le backend n'est pas branché ;
// elle sera remplacée par le résultat de l'appel à l'API (résolution via entiteContext).
export default function InscriptionTablette() {
  return (
    <main className="page-inscription-tablette">
      <h1>Inscription candidat</h1>
      <FormulaireInscription configBlocs={formulaireConfigAccecitTest} />
    </main>
  );
}
