import type { ReactNode } from "react";
type IconName =
  | "sidebar"
  | "plus"
  | "settings"
  | "more"
  | "copy"
  | "close"
  | "search"
  | "sun"
  | "moon"
  | "chevron-up"
  | "chevron-down";
export function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    sidebar: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M9 4v16" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    settings: (
      <>
        <path d="M4 7h8m4 0h4M4 17h3m4 0h9" />
        <circle cx="14" cy="7" r="2" />
        <circle cx="9" cy="17" r="2" />
      </>
    ),
    more: (
      <>
        <circle cx="5" cy="12" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="12" height="12" rx="2" />
        <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
      </>
    ),
    "chevron-up": <path d="m6 15 6-6 6 6" />,
    "chevron-down": <path d="m6 9 6 6 6-6" />,
    moon: <path d="M20 15.5A8.5 8.5 0 0 1 8.5 4a8.5 8.5 0 1 0 11.5 11.5Z" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
  };
  return (
    <svg
      className="icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
