import { useTranslation } from "react-i18next";
export function Auth({
  value,
  onChange,
}: {
  value: any;
  onChange: (v: any) => void;
}) {
  const { t: tr } = useTranslation();
  const type = value?.type ?? "inherit";
  const read = (k: string) =>
    value[k] ?? value[type]?.find((p: any) => p.key === k)?.value ?? "";
  const fields =
    type === "bearer"
      ? ["token"]
      : type === "basic"
        ? ["username", "password"]
        : type === "apikey"
          ? ["key", "value"]
          : [];
  return (
    <div className="form">
      <label>
        {tr("Authorization")}
        <select
          value={type}
          onChange={(e) => onChange({ type: e.target.value })}
        >
          {["inherit", "noauth", "bearer", "basic", "apikey"].map((t) => (
            <option key={t} value={t}>
              {tr(t)}
            </option>
          ))}
          {!["inherit", "noauth", "bearer", "basic", "apikey"].includes(
            type,
          ) && <option>{type}</option>}
        </select>
      </label>
      {fields.map((k) => (
        <label key={k}>
          {tr(k)}
          <input
            type={["token", "password"].includes(k) ? "password" : "text"}
            placeholder={tr("Supports {{variables}}")}
            value={read(k)}
            onChange={(e) => onChange({ ...value, [k]: e.target.value })}
          />
        </label>
      ))}
      {type === "apikey" && (
        <label>
          {tr("Add to")}
          <select
            value={read("in") || "header"}
            onChange={(e) => onChange({ ...value, in: e.target.value })}
          >
            <option value="header">{tr("Header")}</option>
            <option value="query">{tr("Query")}</option>
          </select>
        </label>
      )}
      {type === "inherit" && (
        <p className="muted">
          {tr("Inherits from the nearest folder, then the collection.")}
        </p>
      )}
    </div>
  );
}
