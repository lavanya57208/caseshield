/** Small inline-SVG icon set (stroke style). No external icon library - zero dependencies. */

type IconName =
  | "shield"
  | "dashboard"
  | "cases"
  | "search"
  | "bell"
  | "audit"
  | "user"
  | "logout"
  | "menu"
  | "chevronRight"
  | "upload"
  | "download"
  | "eye"
  | "history"
  | "checkShield"
  | "share"
  | "lock"
  | "users"
  | "activity"
  | "folder"
  | "clipboard"
  | "filter"
  | "x"
  | "checkCircle"
  | "alertTriangle"
  | "plus"
  | "link"
  | "fileText"
  | "info";

const PATHS: Record<IconName, string> = {
  shield: `<path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6l7-3z"/>`,
  dashboard: `<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>`,
  cases: `<path d="M3 7a2 2 0 0 1 2-2h3l2 2h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>`,
  search: `<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>`,
  bell: `<path d="M6 8a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6H4c0.5-0.5 2-2 2-6z"/><path d="M10 20a2 2 0 0 0 4 0"/>`,
  audit: `<path d="M9 3h6l1 3h3v2H5V6h3l1-3z"/><path d="M5 8l1.5 12a1 1 0 0 0 1 0.9h9a1 1 0 0 0 1-0.9L19 8"/><path d="M10 12v5"/><path d="M14 12v5"/>`,
  user: `<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>`,
  logout: `<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>`,
  menu: `<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>`,
  chevronRight: `<path d="M9 6l6 6-6 6"/>`,
  upload: `<path d="M12 16V4"/><path d="M6 10l6-6 6 6"/><path d="M4 20h16"/>`,
  download: `<path d="M12 4v12"/><path d="M6 12l6 6 6-6"/><path d="M4 20h16"/>`,
  eye: `<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>`,
  history: `<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 3"/>`,
  checkShield: `<path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/>`,
  share: `<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.3 10.7l7.4-4.4"/><path d="M8.3 13.3l7.4 4.4"/>`,
  lock: `<rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>`,
  users: `<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5"/><path d="M16 5.5a3.5 3.5 0 0 1 0 6.9"/><path d="M22 20c0-2.8-2-4.7-4.7-5.3"/>`,
  activity: `<path d="M22 12h-4l-3 8-5-16-3 8H2"/>`,
  folder: `<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>`,
  clipboard: `<rect x="6" y="4" width="12" height="17" rx="2"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M9 11h6"/><path d="M9 15h6"/>`,
  filter: `<path d="M4 5h16l-6 8v6l-4-2v-4L4 5z"/>`,
  x: `<path d="M6 6l12 12"/><path d="M18 6L6 18"/>`,
  checkCircle: `<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>`,
  alertTriangle: `<path d="M12 3l10 18H2L12 3z"/><path d="M12 10v4"/><path d="M12 17h.01"/>`,
  plus: `<path d="M12 5v14"/><path d="M5 12h14"/>`,
  link: `<path d="M9 15l6-6"/><path d="M14 5l1.5-1.5a3.5 3.5 0 0 1 5 5L19 10"/><path d="M10 14l-1.5 1.5a3.5 3.5 0 0 1-5-5L5 9"/>`,
  fileText: `<path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v4h4"/><path d="M8 13h8"/><path d="M8 17h8"/>`,
  info: `<circle cx="12" cy="12" r="9"/><path d="M12 8h.01"/><path d="M11 12h1v5h1"/>`,
};

export function icon(name: IconName, size = 18, strokeWidth = 1.8): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${PATHS[name]}</svg>`;
}

/** The Case Shield mark: a shield with a subtle scale/balance line - reused for sidebar, login and favicon. */
export function logoMark(size = 30): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 32 32" fill="none">
    <rect width="32" height="32" rx="7" fill="#0F766E"/>
    <path d="M16 6.5l8 3v5.2c0 6-3.6 9.6-8 11-4.4-1.4-8-5-8-11V9.5l8-3z" fill="#F5F8FA"/>
    <path d="M16 9v13" stroke="#0F766E" stroke-width="1.3"/>
    <path d="M11 12.2h10" stroke="#0F766E" stroke-width="1.3" stroke-linecap="round"/>
    <path d="M11 12.2l-2.4 4.3a2.6 2.6 0 0 0 4.8 0z" stroke="#0F766E" stroke-width="1.1" stroke-linejoin="round"/>
    <path d="M21 12.2l-2.4 4.3a2.6 2.6 0 0 0 4.8 0z" stroke="#0F766E" stroke-width="1.1" stroke-linejoin="round"/>
  </svg>`;
}
