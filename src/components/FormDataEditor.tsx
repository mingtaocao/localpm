import { useId, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../services/tauriApi";
import { Icon } from "./Icon";

type FormField = {
  key: string;
  value?: string;
  type?: string;
  src?: string | string[];
  disabled?: boolean;
  description?: string;
};
const emptyField = (): FormField => ({ key: "", value: "", type: "text" });

export function FormDataEditor({
  rows,
  onChange,
  onError,
}: {
  rows: FormField[];
  onChange: (rows: FormField[]) => void;
  onError: (error: unknown) => void;
}) {
  const { t } = useTranslation();
  const inputId = useId();
  const current = useRef({ rows, onChange });
  current.current = { rows, onChange };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const last = rows.at(-1);
  const blank =
    last &&
    !last.key &&
    !last.value &&
    !last.src &&
    !last.disabled &&
    !last.description &&
    (last.type ?? "text") === "text";
  const displayRows = blank ? rows : [...rows, emptyField()];
  function update(index: number, patch: Partial<FormField>) {
    onChange(
      index === rows.length
        ? [...rows, { ...emptyField(), ...patch }]
        : rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }
  async function chooseFile(row: FormField) {
    try {
      const src = await api.file();
      if (!src || !mounted.current) return;
      // A native dialog may finish after the row was edited or removed.
      const latest = current.current;
      if (!latest.rows.includes(row)) return;
      latest.onChange(
        latest.rows.map((item) => (item === row ? { ...item, src } : item)),
      );
    } catch (error) {
      if (mounted.current) onError(error);
    }
  }
  return (
    <div className="kv kv-formdata">
      <div className="kv-label">
        <span title={t("ENABLED")}>✓</span>
        <span>{t("KEY")}</span>
        <span>{t("TYPE")}</span>
        <span>{t("VALUE")}</span>
        <span />
      </div>
      {displayRows.map((row, index) => {
        const paths = Array.isArray(row.src)
          ? row.src
          : row.src
            ? [row.src]
            : [];
        const filename = paths
          .map((path) => path.split(/[\\/]/).pop())
          .join(", ");
        return (
          <div className="kv-row" data-enabled={!row.disabled} key={index}>
            <label className="kv-toggle-cell">
              <input
                type="checkbox"
                aria-label={t("Enable row %{index}", { index: index + 1 })}
                checked={!row.disabled}
                onChange={(e) => update(index, { disabled: !e.target.checked })}
              />
            </label>
            <input
              id={`${inputId}-key-${index}`}
              aria-label={t("Key %{index}", { index: index + 1 })}
              placeholder={t("Key")}
              value={row.key}
              onChange={(e) => update(index, { key: e.target.value })}
            />
            <select
              aria-label={t("Field type %{index}", { index: index + 1 })}
              value={row.type ?? "text"}
              onChange={(e) => update(index, { type: e.target.value })}
            >
              <option value="text">{t("text")}</option>
              <option value="file">{t("file")}</option>
            </select>
            {row.type === "file" ? (
              <button
                className="formdata-file"
                title={paths.join("\n") || t("Choose file")}
                aria-label={t("Choose file %{index}", { index: index + 1 })}
                onClick={() => void chooseFile(row)}
              >
                <span>{filename || t("Choose file")}</span>
              </button>
            ) : (
              <input
                aria-label={t("Value %{index}", { index: index + 1 })}
                placeholder={t("Value")}
                value={row.value ?? ""}
                onChange={(e) => update(index, { value: e.target.value })}
              />
            )}
            <button
              title={t("Remove row")}
              aria-label={t("Remove row")}
              disabled={index === rows.length}
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
            >
              <Icon name="close" />
            </button>
          </div>
        );
      })}
      <button
        className="subtle"
        onClick={() => {
          if (!blank) onChange([...rows, emptyField()]);
          requestAnimationFrame(() =>
            document
              .getElementById(`${inputId}-key-${displayRows.length - 1}`)
              ?.focus(),
          );
        }}
      >
        {t("＋ Add field")}
      </button>
    </div>
  );
}
