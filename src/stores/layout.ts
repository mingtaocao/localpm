// Layout preferences contain no request data; storage failures never block editing.
export function readLayout(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function saveLayout(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* In-memory layout remains usable. */
  }
}
export function layoutNumber(key: string, fallback: number): number {
  const value = Number(readLayout(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
