import type { ScriptReport } from "../types";
import { ScriptResults as Results } from "./scripts/ScriptResults";
export function ScriptResults({ report }: { report?: ScriptReport | null }) {
  return report ? <Results report={report} /> : null;
}
