import { useState } from 'react';
import { seConnecter } from '../../services/authService';
import './LoginForm.css';

// Formulaire de connexion générique (aucune référence à un rôle ou une entité précise) : sert
// de porte d'entrée à tous les écrans internes réservés à un agent authentifié (accueil,
// coordination, recruteur, formateur, admin — voir CLAUDE.md section Authentification et
// rôles). onConnexionReussie laisse à l'appelant (App.jsx) la décision de la redirection, ce
// composant ne connaît pas le routage — même patron que CaptureTablette.jsx.
export default function LoginForm({ onConnexionReussie }) {
  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [erreur, setErreur] = useState(null);

  const gererEnvoi = async (evenement) => {
    evenement.preventDefault();
    setEnvoiEnCours(true);
    setErreur(null);
    try {
      const utilisateur = await seConnecter({ email, motDePasse });
      if (!utilisateur) {
        setErreur('Email ou mot de passe incorrect.');
        return;
      }
      onConnexionReussie(utilisateur);
    } catch {
      setErreur('Connexion au serveur impossible. Vérifiez le réseau et réessayez.');
    } finally {
      setEnvoiEnCours(false);
    }
  };

  return (
    <form className="login-form" onSubmit={gererEnvoi}>
      <h1>Connexion</h1>

      <label className="login-form__champ">
        <span>Email</span>
        <input
          type="email"
          value={email}
          onChange={(evenement) => setEmail(evenement.target.value)}
          autoComplete="username"
          required
        />
      </label>

      <label className="login-form__champ">
        <span>Mot de passe</span>
        <input
          type="password"
          value={motDePasse}
          onChange={(evenement) => setMotDePasse(evenement.target.value)}
          autoComplete="current-password"
          required
        />
      </label>

      {erreur && <p role="alert">{erreur}</p>}

      <button type="submit" disabled={envoiEnCours}>
        {envoiEnCours ? 'Connexion en cours...' : 'Se connecter'}
      </button>
    </form>
  );
}
