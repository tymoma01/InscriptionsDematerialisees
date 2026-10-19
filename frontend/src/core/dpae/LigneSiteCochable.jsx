import './LigneSiteCochable.css';

// Une ligne de site à cocher, commune aux listes de sites de la demande DPAE (sites d'affectation et
// sites par jour de la semaine type) : case à gauche, nom, code du site à droite, le tout dans le même
// <label> — un clic n'importe où sur la ligne coche ou décoche. `variante="tuile"` : même ligne dans une
// grille, avec bordure.
export default function LigneSiteCochable({ site, coche, onBasculer, variante = 'liste' }) {
  const classes = ['ligne-site-cochable', `ligne-site-cochable--${variante}`, coche ? 'ligne-site-cochable--cochee' : ''].filter(Boolean).join(' ');
  return (
    <label className={classes} title={site.nom}>
      <input type="checkbox" checked={coche} onChange={() => onBasculer(site.id)} />
      <span className="ligne-site-cochable__nom">{site.nom}</span>
      <span className="ligne-site-cochable__initiales">{site.initiales}</span>
    </label>
  );
}
