import { useState } from "react";
import { useTranslation } from "react-i18next";
const METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "CONNECT",
  "TRACE",
];
export function MethodSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (method: string) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const custom = !METHODS.includes(value);
  return (
    <div className="method-control">
      <select
        className="method-select"
        data-method={value}
        aria-label={t("HTTP method")}
        value={editing || custom ? "custom" : value}
        onChange={(event) => {
          if (event.target.value === "custom") {
            setDraft(custom ? value : "");
            setInvalid(false);
            setEditing(true);
          } else {
            setEditing(false);
            onChange(event.target.value);
          }
        }}
      >
        {METHODS.map((method) => (
          <option key={method} value={method}>
            {method}
          </option>
        ))}
        <option value="custom">
          {custom && !editing ? value : t("Custom method…")}
        </option>
      </select>
      {editing && (
        <div className="custom-method-editor">
          <input
            autoFocus
            aria-label={t("Custom HTTP method")}
            aria-invalid={invalid}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setEditing(false);
              if (event.key === "Enter") {
                event.preventDefault();
                apply();
              }
            }}
          />
          <button type="button" onClick={apply}>
            {t("Apply method")}
          </button>
          <button type="button" onClick={() => setEditing(false)}>
            {t("Cancel")}
          </button>
          {invalid && (
            <small role="alert">{t("Enter a valid HTTP method token.")}</small>
          )}
        </div>
      )}
    </div>
  );
  function apply() {
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(draft)) {
      setInvalid(true);
      return;
    }
    onChange(draft.toUpperCase());
    setEditing(false);
  }
}
