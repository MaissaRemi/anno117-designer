import { dieuParId, dieux, effetsDuDieu, nomDuDieu, resumeEffets } from "../../economy/dieux";

/** Dévotion : celle qu'atteindra l'île (sa Foi), ou un palier imposé. */
export type ChoixDevotion = "foi" | number;

/** Paliers proposés : ceux des effets des dieux (`milestones`). */
const PALIERS = [0, 250, 1500, 4500, 11000, 25000, 50000, 250000];

interface Props {
  /** `Patron.id`, ou "" : choix du moteur (`auto`) ou aucun dieu. */
  dieu: string;
  onDieu: (id: string) => void;
  devotion: ChoixDevotion;
  onDevotion: (d: ChoixDevotion) => void;
  /** Libellé de l'entrée vide : « choisi par le moteur » ou « aucun ». */
  vide: string;
}

/**
 * Choix du dieu tutélaire et de sa dévotion. Par défaut la dévotion suit la Foi du plan :
 * c'est la valeur vers laquelle le jeu la fait monter.
 */
export function DieuSelect({ dieu, onDieu, devotion, onDevotion, vide }: Props) {
  const p = dieuParId(dieu);
  const apercu = p && devotion !== "foi" ? effetsDuDieu(p, devotion) : undefined;
  return (
    <>
      <div className="field">
        <span>Dieu</span>
        <select value={dieu} onChange={(e) => onDieu(e.target.value)}>
          <option value="">{vide}</option>
          {dieux().map((d) => <option key={d.id} value={d.id}>{nomDuDieu(d)}</option>)}
        </select>
      </div>
      <div className="field" title="La dévotion d'une île monte jusqu'à sa Foi, qui grandit avec la population. « Selon la Foi » prend celle du plan ; un palier fixe décrit une île encore jeune.">
        <span>Dévotion</span>
        <select
          value={String(devotion)}
          onChange={(e) => onDevotion(e.target.value === "foi" ? "foi" : parseInt(e.target.value))}
        >
          <option value="foi">selon la Foi de l'île</option>
          {PALIERS.map((d) => <option key={d} value={d}>{d === 0 ? "aucune" : d.toLocaleString("fr")}</option>)}
        </select>
      </div>
      {apercu && (
        <span className="muted" style={{ fontSize: 11 }}>
          {nomDuDieu(apercu.dieu)} : {resumeEffets(apercu.productivitePct, apercu.ateliers.length, apercu.residence)}.
        </span>
      )}
    </>
  );
}
