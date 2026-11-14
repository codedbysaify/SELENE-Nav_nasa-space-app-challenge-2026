/** Permanent data-source credits. */
const CREDITS: { label: string; href: string }[] = [
  { label: "NASA LOLA South Pole (PGDA) · Barker et al. 2023", href: "https://doi.org/10.3847/PSJ/acf3e1" },
  { label: "NASA SVS Moon Phase & Libration", href: "https://svs.gsfc.nasa.gov/5587" },
  { label: "NASA SVS CGI Moon Kit", href: "https://svs.gsfc.nasa.gov/4720" },
  { label: "NASA JPL DE440 / DE421 (NAIF) · JPL Horizons", href: "https://ssd.jpl.nasa.gov/" },
  { label: "IAU Gazetteer of Planetary Nomenclature", href: "https://planetarynames.wr.usgs.gov/" },
  { label: "NASA Artemis III regions (2024)", href: "https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/" },
];

export default function Footer() {
  return (
    <footer className="absolute inset-x-0 bottom-0 z-30 flex h-6 items-center gap-1 overflow-x-auto whitespace-nowrap border-t border-line bg-[#030509] px-3 text-[10px] text-ink-mute">
      <span className="shrink-0 font-medium text-ink-soft">Data:</span>
      {CREDITS.map((c, i) => (
        <span key={c.href} className="shrink-0">
          <a href={c.href} target="_blank" rel="noreferrer" className="hover:text-ink">
            {c.label}
          </a>
          {i < CREDITS.length - 1 && <span className="px-1.5 opacity-50">·</span>}
        </span>
      ))}
    </footer>
  );
}
