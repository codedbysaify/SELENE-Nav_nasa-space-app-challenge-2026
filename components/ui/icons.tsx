/** Minimal stroke icons (24-grid, currentColor). */
type P = { className?: string };
const base = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const IconPlus = (p: P) => (
  <svg {...base} {...p}><path d="M12 5v14M5 12h14" /></svg>
);
export const IconMinus = (p: P) => (
  <svg {...base} {...p}><path d="M5 12h14" /></svg>
);
export const IconReset = (p: P) => (
  <svg {...base} {...p}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>
);
export const IconGlobe = (p: P) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.6 2.4 2.6 14.6 0 17M12 3.5c-2.6 2.4-2.6 14.6 0 17" /></svg>
);
export const IconTarget = (p: P) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" /></svg>
);
export const IconInfo = (p: P) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.5v.01" /></svg>
);
export const IconLayers = (p: P) => (
  <svg {...base} {...p}><path d="M12 3 2.5 8 12 13l9.5-5L12 3Z" /><path d="m2.5 12.5 9.5 5 9.5-5" /></svg>
);
export const IconClose = (p: P) => (
  <svg {...base} {...p}><path d="M6 6l12 12M18 6 6 18" /></svg>
);
export const IconChevron = (p: P) => (
  <svg {...base} {...p}><path d="m6 9 6 6 6-6" /></svg>
);
export const IconExternal = (p: P) => (
  <svg {...base} width={12} height={12} {...p}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
);

/** SELENE-Nav mark: lunar disc with the south polar cap and a locator. */
export const SeleneMark = ({ className }: P) => (
  <svg viewBox="0 0 32 32" width={26} height={26} className={className} aria-hidden>
    <circle cx="16" cy="15" r="11" fill="none" stroke="#a3aebd" strokeWidth="1.4" />
    <path d="M7.2 21.6a11 11 0 0 0 17.6 0" fill="none" stroke="#5ec8d8" strokeWidth="1.6" />
    <circle cx="16" cy="26" r="2.1" fill="#5ec8d8" />
    <path d="M16 4v3" stroke="#6c7889" strokeWidth="1.2" />
  </svg>
);
