import { useEffect, useRef, useState } from "react";

// Only an action id is kept in UI state. Clipboard contents are never retained.
export function useCopyFeedback() {
  const [copied, setCopied] = useState<string | null>(null);
  const sequence = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      sequence.current++;
      clearTimeout(timer.current);
    },
    [],
  );
  const copy = async (text: string, action: string) => {
    const current = ++sequence.current;
    clearTimeout(timer.current);
    setCopied(null);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      throw Object.assign(new Error("Copy failed"), {
        code: "CLIPBOARD_WRITE_FAILED",
      });
    }
    if (current !== sequence.current) return;
    setCopied(action);
    timer.current = setTimeout(() => {
      if (current === sequence.current) setCopied(null);
    }, 1600);
  };
  return { copied, copy };
}
