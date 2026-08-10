import { useMemo, useState } from "react";
import { useStore } from "../state/store";
import { planProductionLayout } from "../prodlayout";
import { goodName, isProducer } from "../prodlayout/chain";
import { deleteBlueprint, listBlueprints, saveBlueprint } from "../persist/blueprints";
import { downloadLayoutPng } from "../render/exportImage";
import { BlueprintCanvas } from "./components/BlueprintCanvas";

/**
 * Onglet PRODUCTION : commande à gauche, plan au centre, chiffres à droite.
 *
 * Le plan se recalcule à chaque frappe parce qu'il coûte quelques millisecondes — pas de
 * worker, pas de bouton « calculer », pas d'état intermédiaire à tenir cohérent.
 */
export function ProdLayoutView() {
  const catalog = useStore((s) => s.catalog);
  const world = useStore((s) => s.world);

  const targets = useMemo(
    () => catalog
      .filter((d) => isProducer(d.id) && (!d.region || d.region === world))
      .sort((a, b) => a.name.localeCompare(b.name, "fr")),
    [catalog, world],
  );

  const [targetId, setTargetId] = useState(() => targets[0]?.id ?? "");
  const [count, setCount] = useState(1);
  const [imported, setImported] = useState<string[]>([]);
  const [saved, setSaved] = useState(() => listBlueprints());
  const [name, setName] = useState("");

  // la cible peut sortir de la liste quand on bascule de monde : on retombe sur la première
  const activeId = targets.some((d) => d.id === targetId) ? targetId : (targets[0]?.id ?? "");

  const plan = useMemo(() => {
    if (!activeId) return null;
    try {
      return planProductionLayout(catalog, activeId, Math.max(1, count), { imported: new Set(imported) });
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) } as const;
    }
  }, [catalog, activeId, count, imported]);

  if (!plan) return <div className="panel">Aucun bâtiment de production dans ce monde.</div>;
  if ("error" in plan) return <div className="panel prod-error">{plan.error}</div>;

  const toggleImport = (good: string) =>
    setImported((cur) => (cur.includes(good) ? cur.filter((g) => g !== good) : [...cur, good]));

  const targetName = catalog.find((d) => d.id === activeId)?.name ?? activeId;

  return (
    <div className="prod-layout">
      <aside className="panel prod-command">
        <label>
          Bâtiment
          <select
            value={activeId}
            onChange={(e) => { setTargetId(e.target.value); setImported([]); }}
          >
            {targets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label>
          Nombre
          <input
            type="number"
            min={1}
            value={count}
            onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>

        <h4>Chaîne</h4>
        <ul className="chain-tree">
          {plan.chain.nodes.map((n) => {
            const item = plan.order.items.find((i) => i.defId === n.defId)!;
            return (
              <li key={n.defId} style={{ marginLeft: n.depth * 12 }}>
                <b>{item.placed}×</b>
                <span>{catalog.find((d) => d.id === n.defId)?.name ?? n.defId}</span>
                {item.utilisation < 1 && <em>{Math.round(item.utilisation * 100)} %</em>}
                <button onClick={() => toggleImport(n.good)}>importer</button>
              </li>
            );
          })}
          {plan.chain.imports.map((i) => (
            <li key={i.good} className="imported">
              <b>↓</b>
              <span>{goodName(i.good)} · {i.ratePerMin.toFixed(2)}/min</span>
              {i.reason === "demandé" && <button onClick={() => toggleImport(i.good)}>produire</button>}
            </li>
          ))}
        </ul>

        <h4>Bibliothèque</h4>
        <div className="row">
          <input value={name} placeholder="nom" onChange={(e) => setName(e.target.value)} />
          <button
            disabled={!name.trim()}
            onClick={() => {
              saveBlueprint({ name: name.trim(), targetDefId: activeId, count, imported });
              setSaved(listBlueprints());
              setName("");
            }}
          >enregistrer</button>
        </div>
        <ul className="bp-list">
          {saved.map((b) => (
            <li key={b.name}>
              <button
                onClick={() => { setTargetId(b.targetDefId); setCount(b.count); setImported(b.imported); }}
              >{b.name}</button>
              <button onClick={() => { deleteBlueprint(b.name); setSaved(listBlueprints()); }}>✕</button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="prod-plan">
        {plan.order.perfectMultiplier > 1 && (
          <div className="banner">
            <span>
              Ratio incomplet — à <b>{count * plan.order.perfectMultiplier} {targetName}</b>, plus aucun gaspillage.
            </span>
            <button onClick={() => setCount(count * plan.order.perfectMultiplier)}>appliquer</button>
          </div>
        )}
        <BlueprintCanvas layout={plan.layout} catalog={catalog} />
        <div className="row">
          <button onClick={() => downloadLayoutPng(plan.layout, catalog, `${targetName}-${count}.png`)}>
            exporter en PNG
          </button>
        </div>
        {plan.gaps.length > 0 && (
          <ul className="gaps">{plan.gaps.map((g) => <li key={g}>{g}</li>)}</ul>
        )}
      </section>

      <aside className="panel prod-report">
        <table>
          <tbody>
            <tr><th>Bâtiments</th><td>
              {plan.report.buildings.map((b) => `${b.count} ${b.name}`).join(" · ")}
            </td></tr>
            <tr><th>Entretien</th><td>−{plan.report.upkeep} /min</td></tr>
            <tr><th>Main-d&apos;œuvre</th><td>
              {plan.report.workforce.map((w) => `${w.amount} ${w.name}`).join(" · ") || "—"}
            </td></tr>
            <tr><th>Taille</th><td>{plan.box.w} × {plan.box.h}</td></tr>
            <tr><th>Cases</th><td>{plan.box.w * plan.box.h}</td></tr>
            <tr><th>Efficacité</th><td>{(plan.efficiency * 100).toFixed(1)} %</td></tr>
            <tr><th>Production</th><td>
              {plan.report.production.ratePerMin.toFixed(2)} {plan.report.production.name} /min
            </td></tr>
            <tr><th>Valeur</th><td>{Math.round(plan.report.marketValuePerMin)} /min</td></tr>
            <tr><th>Imports</th><td>
              {plan.report.imports.map((i) => `${i.ratePerMin.toFixed(2)} ${i.name}`).join(" · ") || "aucun"}
              {plan.report.importCostPerMin > 0 && ` · −${plan.report.importCostPerMin} /min`}
            </td></tr>
          </tbody>
        </table>
      </aside>
    </div>
  );
}
