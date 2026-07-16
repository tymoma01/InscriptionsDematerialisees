import { blocRegistry } from './blocRegistry';

// Résout un bloc de config (code + config JSONB) vers son composant, sans jamais
// mentionner un code de bloc précis en dur — c'est le seul rôle de ce composant.
export default function BlocRenderer({ bloc, valeurs, onChange, onValiditeChange }) {
  const ComposantBloc = blocRegistry[bloc.code];

  if (!ComposantBloc) {
    return (
      <p role="alert">
        Bloc « {bloc.code} » inconnu du registre — vérifier blocRegistry.js.
      </p>
    );
  }

  return (
    <ComposantBloc
      config={bloc.config}
      valeurs={valeurs}
      onChange={onChange}
      onValiditeChange={onValiditeChange}
    />
  );
}
