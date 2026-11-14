"use client";
/**
 * DOM layer for the pole labels. Positions are written every frame by
 * PoleMarkers (inside the WebGL scene) straight to `style.transform`, so the
 * labels keep a constant, readable pixel size and never re-render React.
 */
import { useEffect, useRef } from "react";
import { poleLabelEls } from "@/lib/frame-state";

export default function PoleLabels() {
  const south = useRef<HTMLDivElement>(null);
  const north = useRef<HTMLDivElement>(null);
  const cue = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    poleLabelEls.south = south.current;
    poleLabelEls.north = north.current;
    poleLabelEls.northCue = cue.current;
    return () => {
      poleLabelEls.south = poleLabelEls.north = null;
      poleLabelEls.northCue = null;
    };
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden>
      <div ref={south} className="pole-anchor" style={{ visibility: "hidden" }}>
        <div className="pole-label pole-label--south">
          <span className="pole-label__dot" />
          <span className="pole-label__title">SOUTH POLE</span>
          <span className="pole-label__meta">90°S · exploration target</span>
        </div>
      </div>
      <div ref={north} className="pole-anchor" style={{ visibility: "hidden" }}>
        <div className="pole-label pole-label--north">
          <span className="pole-label__title">
            NORTH POLE{" "}
            <span ref={cue} className="pole-label__cue">
              beyond limb ↑
            </span>
          </span>
          <span className="pole-label__meta">90°N · reference</span>
        </div>
      </div>
    </div>
  );
}
