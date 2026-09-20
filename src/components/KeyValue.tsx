import { useTranslation } from "react-i18next";
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
  const { t: tr } = useTranslation();
  const [secretDrafts, setSecretDrafts] = useState<Record<number, string>>({});
  function update(i: number, p: Partial<Pair>) {
    onChange(rows.map((r, n) => (n === i ? { ...r, ...p } : r)));
  }
  return (
    <div className="kv">
      <div className="kv-label">
        {tr("ENABLED")}
        <span>{tr("KEY")}</span>
        <span>{tr("VALUE")}</span>
        <span>{tr("DESCRIPTION")}</span>
      </div>
      {rows.map((r, i) => (
        <div className="kv-row" key={i}>
          <input
            aria-label={tr("Enable row %{index}", { index: i + 1 })}
            type="checkbox"
            checked={r.enabled}
            onChange={(e) => update(i, { enabled: e.target.checked })}
          />
          <input
            aria-label={tr("Key %{index}", { index: i + 1 })}
            placeholder={tr("Key")}
            value={r.key}
            onChange={(e) => update(i, { key: e.target.value })}
          />
          <input
            aria-label={tr("Value %{index}", { index: i + 1 })}
            type={r.isSecret ? "password" : "text"}
            placeholder={
              r.secretRef ? tr("Saved in OS credential store") : tr("Value")
            }
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
            aria-label={tr("Description %{index}", { index: i + 1 })}
            placeholder={tr("Description")}
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
              {tr("Secret")}
            </label>
          )}
          <button
            title={tr("Remove row")}
            onClick={() => onChange(rows.filter((_, n) => n !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <button className="subtle" onClick={() => onChange([...rows, pair()])}>
        {tr("＋ Add row")}
      </button>
    </div>
  );
}
