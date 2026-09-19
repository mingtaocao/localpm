import { useState } from "react";
import { pair, type Pair } from "../types";
export function KeyValue({
  rows,
  onChange,
  secrets = false,
}: {
  rows: Pair[];
  onChange: (r: Pair[]) => void;
  secrets?: boolean;
}) {
  const [secretDrafts, setSecretDrafts] = useState<Record<number, string>>({});
  function update(i: number, p: Partial<Pair>) {
    onChange(rows.map((r, n) => (n === i ? { ...r, ...p } : r)));
  }
  return (
    <div className="kv">
      <div className="kv-label">
        ENABLED <span>KEY</span>
        <span>VALUE</span>
        <span>DESCRIPTION</span>
      </div>
      {rows.map((r, i) => (
        <div className="kv-row" key={i}>
          <input
            aria-label={`Enable row ${i + 1}`}
            type="checkbox"
            checked={r.enabled}
            onChange={(e) => update(i, { enabled: e.target.checked })}
          />
          <input
            aria-label={`Key ${i + 1}`}
            placeholder="Key"
            value={r.key}
            onChange={(e) => update(i, { key: e.target.value })}
          />
          <input
            aria-label={`Value ${i + 1}`}
            type={r.isSecret ? "password" : "text"}
            placeholder={r.secretRef ? "Saved in OS credential store" : "Value"}
            value={r.isSecret ? (secretDrafts[i] ?? r.value) : r.value}
            onChange={(e) =>
              r.isSecret
                ? setSecretDrafts((d) => ({ ...d, [i]: e.target.value }))
                : update(i, { value: e.target.value })
            }
            onBlur={() => {
              if (r.isSecret && secretDrafts[i] !== undefined) {
                update(i, { value: secretDrafts[i] });
                setSecretDrafts((d) => {
                  const next = { ...d };
                  delete next[i];
                  return next;
                });
              }
            }}
          />
          <input
            aria-label={`Description ${i + 1}`}
            placeholder="Description"
            value={r.description}
            onChange={(e) => update(i, { description: e.target.value })}
          />
          {secrets && (
            <label className="tiny">
              <input
                type="checkbox"
                checked={!!r.isSecret}
                onChange={(e) => update(i, { isSecret: e.target.checked })}
              />
              Secret
            </label>
          )}
          <button
            title="Remove row"
            onClick={() => onChange(rows.filter((_, n) => n !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <button className="subtle" onClick={() => onChange([...rows, pair()])}>
        ＋ Add row
      </button>
    </div>
  );
}
