import type { ReactNode } from "react";

const shapes = {
  gift: <><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M5 12v9h14v-9M12 8v13M12 8H8a3 3 0 1 1 3-3l1 3Zm0 0h4a3 3 0 1 0-3-3l-1 3Z" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 6 9 7 9-7" /></>,
  help: <><path d="M4 14v-3a8 8 0 0 1 16 0v3M20 17v2a2 2 0 0 1-2 2h-4" /><rect x="2" y="11" width="4" height="7" rx="2" /><rect x="18" y="11" width="4" height="7" rx="2" /></>,
  card: <><rect x="2" y="4" width="20" height="16" rx="3" /><path d="M2 10h20M6 15h3" /></>,
  truck: <><path d="M3 16V5h11v11H8m6-8h4l3 4v4h-3M14 16h-1" /><circle cx="6" cy="17" r="2" /><circle cx="16" cy="17" r="2" /></>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  logout: <><path d="M10 4H4v16h6m4-13 5 5-5 5m-5-5h13" /></>,
  chevron: <path d="m6 9 6 6 6-6" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v.01" /></>,
  leaf: <><path d="M20 3c1 11-3 17-10 17a6 6 0 0 1-6-6C4 7 10 7 20 3ZM4 21l11-11" /></>,
  sprout: <><path d="M12 21v-8M12 13C4 14 2 10 3 5c6 0 9 3 9 8Zm0-2c0-6 4-8 9-8 0 6-3 9-9 8Z" /></>,
  flower: <><path d="M12 5c3-6 9-2 7 3 6 0 6 8 0 8 2 5-4 9-7 3-3 6-9 2-7-3-6 0-6-8 0-8-2-5 4-9 7-3Z" /><circle cx="12" cy="12" r="3" /></>,
  crown: <><path d="m3 6 4 4 5-7 5 7 4-4-2 12H5L3 6Zm3 15h12" /></>,
} satisfies Record<string, ReactNode>;

export type AccountIconName = keyof typeof shapes;

/** Decorative glyphs: the enclosing control or text supplies the accessible name. */
export function AccountIcon({ name }: { name: AccountIconName }) {
  return <svg className="account-icon" viewBox="0 0 24 24" width="24" height="24" fill="none"
    stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {shapes[name]}
  </svg>;
}
