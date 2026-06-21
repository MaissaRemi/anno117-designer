import { useEffect, useMemo, useState } from "react";
import { useStore } from "../state/store";
import { makeLookup } from "../engine/rules";
import { analyzeCoverage, type CoverageReport } from "../economy/coverage";

interface Props {
  onClose: () => void;
}

/**
 * Diagnostic de couverture des services publics : rapport par service
 * (% de résidences servies) et surlignage des maisons hors rayon.
 * Lecture seule — le placement optimisé se fait via « 🏛 Plan d'île ».
 */
export function CoveragePanel({ onClose }: Props) {
  const layout = useStore((s) => s.layout);
  const catalog = useStore((s) => s.catalog);
  const setHighlight = useStore((s) => s.setCoverageHighlight);
  const lookup = useMemo(() => makeLookup(catalog), [catalog]);

  const [report, setReport] = useState<CoverageReport>(() => analyzeCoverage(layout, lookup));
  const [shown, setShown] = useState<string | null>(null); // service surligné

  // recalcule à chaque changement de layout (ex: après placement)
  useEffect(() => setReport(analyzeCoverage(layout, lookup)), [layout, lookup]);
  // nettoie le surlignage à la fermeture
  useEffect(() => () => setHighlight(null), [setHighlight]);

  const highlight = (serviceId: string, cells: string[]) => {
    if (shown === serviceId) { setHighlight(null); setShown(null); }
    else { setHighlight(cells); setShown(serviceId); }
  };

  const color = (pct: number) => (pct >= 100 ? "#8bc34a" : pct >= 75 ? "#ffcc66" : "#ff8a85");

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal opt" onClick={(e) => e.stopPropagation()}>
        <h3>📡 Couverture des services publics</h3>
        <p className="muted">
          {report.housesTotal} résidence(s) posée(s). <b>{report.housesFullyCovered}</b> couverte(s) par
          TOUS leurs services à rayon connu (<b style={{ color: color(report.fullyCoveredPct) }}>{report.fullyCoveredPct}%</b>).
          Clique « 👁 » pour surligner en rouge les maisons hors rayon d'un service.
        </p>

        {report.services.length === 0 && (
          <p className="muted">Aucune résidence (ou aucun service requis). Pose des résidences d'abord.</p>
        )}

        <div className="audit-list">
          {report.services.map((s) => (
            <div key={s.serviceId} className="audit-row">
              <span className="audit-name">{s.name}</span>
              <span className="muted">
                {s.present} posé(s) · rayon {s.hasRadius ? s.range : "?"} ·{" "}
                {s.hasRadius ? `${s.housesCovered}/${s.housesRequiring}` : "non analysable"}
              </span>
              <b style={{ color: color(s.pct), minWidth: 44, textAlign: "right" }}>
                {s.hasRadius ? `${s.pct}%` : "—"}
              </b>
              {s.hasRadius && s.uncovered.length > 0 && (
                <button onClick={() => highlight(s.serviceId, s.uncovered)} title="Surligner les maisons non couvertes">
                  {shown === s.serviceId ? "🙈" : "👁"}
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="modal-actions">
          <button onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
