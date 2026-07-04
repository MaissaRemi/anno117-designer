interface Action {
  label: string;
  primary?: boolean;
  onClick: () => void;
  disabled?: boolean;
}

interface Props {
  running: boolean;
  progress?: { step: number; total: number } | null;
  error?: string | null;
  actions: Action[];
}

/** Bandeau d'action partagé : boutons + barre de progression + message d'erreur.
 *  Feedback de calcul UNIFIÉ pour Plan d'île et Multi-îles. */
export function RunPanel({ running, progress, error, actions }: Props) {
  const pct = progress ? Math.round((progress.step / Math.max(1, progress.total)) * 100) : 40;
  return (
    <div className="run-panel">
      <div className="run-actions">
        {actions.map((a) => (
          <button key={a.label} className={a.primary ? "primary" : ""} onClick={a.onClick} disabled={running || a.disabled}>
            {a.label}
          </button>
        ))}
      </div>
      {running && (
        <>
          <div className="run-progress"><div style={{ width: `${pct}%` }} /></div>
          <div className="run-msg">Calcul en cours…{progress ? ` (${progress.step}/${progress.total})` : ""}</div>
        </>
      )}
      {error && !running && <div className="warn">⚠ {error}</div>}
    </div>
  );
}
