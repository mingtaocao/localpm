import { useTranslation } from "react-i18next";
import { useId, useState } from "react";
import { parsePairPaste, type PairPasteMode } from "../utils/pastePairs";
import { pair, type Pair } from "../types";
export function KeyValue({
  rows,
  onChange,
  secrets = false,
  pasteMode,
}: {
  rows: Pair[];
  onChange: (r: Pair[]) => void;
  secrets?: boolean;
  pasteMode?: PairPasteMode;
}) {
  const { t: tr } = useTranslation();
  const inputId = useId();
  const [secretDrafts, setSecretDrafts] = useState<Record<number, string>>({});
  const last = rows.at(-1);
  const blank =
    last &&
    last.enabled &&
    !last.key &&
    !last.value &&
    !last.description &&
    !last.isSecret &&
    !last.secretRef &&
    !last.kind;
  const displayRows = blank ? rows : [...rows, pair()];
  function update(i: number, p: Partial<Pair>) {
    onChange(
      i === rows.length
        ? [...rows, { ...pair(), ...p }]
        : rows.map((r, n) => (n === i ? { ...r, ...p } : r)),
    );
  }
  function remove(i: number) {
    setSecretDrafts((drafts) =>
      Object.fromEntries(
        Object.entries(drafts)
          .filter(([index]) => Number(index) !== i)
          .map(([index, value]) => [
            Number(index) > i ? Number(index) - 1 : Number(index),
            value,
          ]),
      ),
    );
    onChange(rows.filter((_, n) => n !== i));
  }
  return (
    <div className={`kv ${secrets ? "kv-secrets" : ""}`}>
      <div className="kv-label">
        <span title={tr("ENABLED")}>✓</span>
        <span>{tr("KEY")}</span>
        <span>{tr("VALUE")}</span>
        <span>{tr("DESCRIPTION")}</span>
        {secrets && <span>{tr("Secret")}</span>}
        <span />
      </div>
      {displayRows.map((r, i) => (
        <div className="kv-row" key={i}>
          <input
            aria-label={tr("Enable row %{index}", { index: i + 1 })}
            type="checkbox"
            checked={r.enabled}
            onChange={(e) => update(i, { enabled: e.target.checked })}
          />
          <input
            id={`${inputId}-key-${i + 1}`}
            aria-label={tr("Key %{index}", { index: i + 1 })}
            placeholder={tr("Key")}
            title={
              pasteMode
                ? tr("Paste multiple parameter or header lines here")
                : undefined
            }
            onPaste={(event) => {
              if (!pasteMode) return;
              const parsed = parsePairPaste(
                event.clipboardData.getData("text/plain"),
                pasteMode,
              );
              if (!parsed) return;
              event.preventDefault();
              const count = parsed.length - 1;
              setSecretDrafts((drafts) =>
                Object.fromEntries(
                  Object.entries(drafts).map(([index, value]) => [
                    Number(index) > i ? Number(index) + count : Number(index),
                    value,
                  ]),
                ),
              );
              onChange([
                ...rows.slice(0, i),
                { ...(rows[i] ?? pair()), ...parsed[0] },
                ...parsed.slice(1).map((entry) => ({ ...pair(), ...entry })),
                ...rows.slice(i + 1),
              ]);
            }}
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
                aria-label={tr("Secret row %{index}", { index: i + 1 })}
                type="checkbox"
                checked={!!r.isSecret}
                onChange={(e) => update(i, { isSecret: e.target.checked })}
              />
              {tr("Secret")}
            </label>
          )}
          <button
            title={tr("Remove row")}
            disabled={i === rows.length}
            onClick={() => remove(i)}
          >
            ×
          </button>
        </div>
      ))}
      <button
        className="subtle"
        onClick={() => {
          if (!blank) onChange([...rows, pair()]);
          requestAnimationFrame(() =>
            document
              .getElementById(`${inputId}-key-${displayRows.length}`)
              ?.focus(),
          );
        }}
      >
        {tr("＋ Add row")}
      </button>
    </div>
  );
}
