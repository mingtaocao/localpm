export type PastedPair = { key: string; value: string; description?: string };
export type PairPasteMode = "params" | "headers";

// Parse atomically: unrecognized input is left to the ordinary paste behavior.
export function parsePairPaste(
  text: string,
  mode: PairPasteMode,
): PastedPair[] | null {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => line.trim());
  if (
    mode === "params" &&
    lines.length === 1 &&
    text.includes("&") &&
    !text.includes("\t")
  ) {
    const query = text.trim().replace(/^\?/, "");
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(query)) return null;
    if (
      !query
        .split("&")
        .every((part) => part.includes("=") && part.indexOf("=") > 0)
    )
      return null;
    return Array.from(new URLSearchParams(query), ([key, value]) => ({
      key,
      value,
    }));
  }
  if (lines.length < 2) return null;
  const parsed: PastedPair[] = [];
  for (const line of lines) {
    if (line.includes("\t")) {
      const columns = line.split("\t");
      if (columns.length > 3 || !columns[0].trim()) return null;
      parsed.push({
        key: columns[0].trim(),
        value: columns[1],
        ...(columns.length === 3 ? { description: columns[2] } : {}),
      });
    } else {
      const delimiter = mode === "headers" ? ":" : "=";
      const split = line.indexOf(delimiter);
      if (split < 1 || !line.slice(0, split).trim()) return null;
      parsed.push({
        key: line.slice(0, split).trim(),
        value:
          mode === "headers"
            ? line.slice(split + 1).replace(/^\s+/, "")
            : line.slice(split + 1),
      });
    }
  }
  return parsed;
}
