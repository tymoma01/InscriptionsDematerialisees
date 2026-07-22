import { useEffect, useRef } from 'react';
import SignaturePad from 'signature_pad';
import './SignatureElectronique.css';

// Composant réutilisable de capture de signature électronique : tracé au doigt/souris sur
// canvas via signature_pad, export en PNG base64 (toDataURL). Ne connaît rien du bloc qui
// l'utilise — expose uniquement la valeur courante et un callback de changement, comme les
// champs de formulaire des autres blocs (valeur '' = pas de tracé / effacé).
export default function SignatureElectronique({ valeur, onChange, disabled = false }) {
  const canvasRef = useRef(null);
  const padRef = useRef(null);

  useEffect(() => {
    const pad = new SignaturePad(canvasRef.current);
    padRef.current = pad;

    // pad.isEmpty() avant validation pour éviter d'enregistrer un tracé vide
    const emettreChangement = () => onChange(pad.isEmpty() ? '' : pad.toDataURL('image/png'));
    pad.addEventListener('endStroke', emettreChangement);

    return () => {
      pad.removeEventListener('endStroke', emettreChangement);
      pad.off();
    };
  }, []);

  // Active/désactive le tracé sans démonter le pad (ex. tant que l'appelant impose une
  // condition préalable — voir le scroll-gate de la charte dans BlocCharte.jsx).
  useEffect(() => {
    if (disabled) {
      padRef.current?.off();
    } else {
      padRef.current?.on();
    }
  }, [disabled]);

  const effacer = () => {
    padRef.current?.clear();
    onChange('');
  };

  return (
    <div className={disabled ? 'signature-electronique signature-electronique--desactivee' : 'signature-electronique'}>
      <canvas ref={canvasRef} className="signature-electronique__canvas" width={400} height={150} />
      <button type="button" onClick={effacer} disabled={disabled || !valeur}>
        Effacer la signature
      </button>
    </div>
  );
}
