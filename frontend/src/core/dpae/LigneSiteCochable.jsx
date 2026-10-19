import './LigneSiteCochable.css';

// Une ligne de site à cocher, commune aux listes de sites de la demande DPAE (sites d'affectation et
// sites par jour de la semaine type) : la case et le nom sont dans le même <label>, un clic n'importe où
// sur la ligne coche ou décoche. `variante="tuile"` : même ligne dans une grille, avec bordure.
export default function LigneSiteCochable({ site, coche, onBasculer, variante = 'liste', afficherInitiales = false }) {
  const classes = ['ligne-site-cochable', `ligne-site-cochable--${variante}`, coche ? 'ligne-site-cochable--cochee' : ''].filter(Boolean).join(' ');
  return (
    <label className={classes} title={site.nom}>
      <input type="checkbox" checked={coche} onChange={() => onBasculer(site.id)} />
      <span className="ligne-site-cochable__nom">{afficherInitiales ? site.nom : `${site.nom} (${site.initiales})`}</span>
      {afficherInitiales && <span className="ligne-site-cochable__initiales">{site.initiales}</span>}
    </label>
  );
}
