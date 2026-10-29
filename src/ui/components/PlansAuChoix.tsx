import type { AnyIslandPlanResult } from "../../optimizer/runIslandPlan";
import { LIBELLE_CRITERE } from "../../optimizer/plansAuChoix";
import { severiteVitale } from "../../optimizer/viability";

interface Props {
  plans: AnyIslandPlanResult[];
  choix: number;
  onChoix: (i: number) => void;
}

const ATTR_FR: Record<string, string> = { Happiness: "bonheur", Money: "argent", Health: "santé", FireSafety: "incendie" };

/** Le pire attribut vital par maison, ou « sain ». */
function bilan(p: Extract<AnyIslandPlanResult, { mode: "import" }>): string {
  if (severiteVitale(p.attrsTotal, p.houses) === 0) return "bilan sain";
  let pire = "", v = 0;
  for (const [k, total] of Object.entries(p.attrsTotal)) {
    const parMaison = total / Math.max(1, p.houses);
    if (ATTR_FR[k] && parMaison < v) { v = parMaison; pire = ATTR_FR[k]; }
  }
  return `${pire} ${v.toFixed(1).replace(".", ",")}/maison`;
}

/**
 * PLANS AU CHOIX : une carte par plan proposé, le recommandé d'abord. Chaque carte dit sur quoi
 * le plan l'emporte, avec les quatre chiffres qui servent à trancher.
 */
export function PlansAuChoix({ plans, choix, onChoix }: Props) {
  return (
    <div className="plans-choix" role="radiogroup" aria-label="Plans proposés">
      {plans.map((p, i) => {
        if (p.mode !== "import") return null;
        const atouts = (p.atouts ?? []).map((c) => LIBELLE_CRITERE[c]);
        return (
          <button key={i} type="button" role="radio" aria-checked={i === choix}
            className={i === choix ? "active" : undefined} onClick={() => onChoix(i)}>
            <span className="titre">{i === 0 ? "Recommandé" : `Plan ${i + 1}`}</span>
            <span className="sub">{atouts.length ? atouts.join(" · ") : "—"}</span>
            <span>{p.residents.toLocaleString("fr")} habitants</span>
            <span className="sub">
              {p.fullyCovered}/{p.houses} au palier · {bilan(p)} · {p.money.net >= 0 ? "+" : ""}{p.money.net.toLocaleString("fr")}/min
            </span>
          </button>
        );
      })}
    </div>
  );
}
