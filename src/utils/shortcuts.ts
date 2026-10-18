export function platformShortcut(
  key: string,
  platform = typeof navigator === "undefined" ? "" : navigator.platform,
): string {
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? `⌘${key}` : `Ctrl+${key}`;
}
