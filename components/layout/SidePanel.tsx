"use client";
/**
 * Right-hand panel with two tabs, so Layers and the Readout never hide each other.
 * The scroll area lives inside the panel (which receives pointer events), so its
 * scrollbar can be dragged without the click falling through to the map.
 */
import { useEffect, useState } from "react";
import LayerSelector from "@/components/ui/LayerSelector";
import InformationPanel from "@/components/layout/InformationPanel";
import { IconChevron } from "@/components/ui/icons";

type Tab = "layers" | "readout";

export default function SidePanel() {
  const [tab, setTab] = useState<Tab>("layers");
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (window.innerWidth < 1100) setOpen(false);
  }, []);

  const tabBtn = (id: Tab, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      aria-controls={`side-${id}`}
      onClick={() => {
        setTab(id);
        setOpen(true);
      }}
      className={`h-7 flex-1 rounded text-[12px] font-medium transition-colors ${
        tab === id && open ? "bg-white/10 text-ink" : "text-ink-soft hover:text-ink"
      }`}
    >
      {label}
    </button>
  );

  return (
    <section aria-label="Map layers and readout" className="panel pointer-events-auto flex max-h-full w-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 p-1.5">
        <div role="tablist" aria-label="Side panel" className="flex flex-1 gap-1 rounded-md bg-black/30 p-0.5">
          {tabBtn("layers", "Layers")}
          {tabBtn("readout", "Readout")}
        </div>
        <button
          type="button"
          aria-label={open ? "Collapse panel" : "Expand panel"}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="grid h-7 w-7 place-items-center rounded text-ink-mute hover:bg-white/5 hover:text-ink"
        >
          <IconChevron className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      {open && (
        <div
          id={`side-${tab}`}
          role="tabpanel"
          className="side-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-line px-3.5 pb-3.5 pt-3"
        >
          {tab === "layers" ? <LayerSelector /> : <InformationPanel />}
        </div>
      )}
    </section>
  );
}
