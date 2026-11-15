"use client";
/**
 * (i) help button: the definition opens on hover (desktop) and on click/tap (touch).
 * Rendered in a fixed-position layer so it is never clipped by scrolling panels.
 */
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GLOSSARY, type GlossaryKey } from "@/lib/glossary";

export default function InfoTip({ k, text, className = "" }: { k?: GlossaryKey; text?: string; className?: string }) {
  const body = text ?? (k ? GLOSSARY[k] : "");
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0, above: false });
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  const open = hover || pinned;

  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const above = r.bottom + 130 > window.innerHeight;
    setPos({ x: Math.min(Math.max(8, r.left + r.width / 2 - 130), window.innerWidth - 268), y: above ? r.top - 6 : r.bottom + 6, above });
  };

  useEffect(() => {
    if (!pinned) return;
    const close = (e: Event) => {
      if (btn.current && e.target instanceof Node && btn.current.contains(e.target)) return;
      setPinned(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setPinned(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", close, true);
    };
  }, [pinned]);

  if (!body) return null;
  const i = body.indexOf(":");
  const [term, def] = i > 0 && i < 40 ? [body.slice(0, i), body.slice(i + 1).trim()] : [null, body];

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label={`What is ${term ?? "this"}?`}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => {
          place();
          setHover(true);
        }}
        onMouseLeave={() => setHover(false)}
        onFocus={() => {
          place();
          setHover(true);
        }}
        onBlur={() => setHover(false)}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          place();
          setPinned((p) => !p);
        }}
        className={`inline-grid h-[15px] w-[15px] shrink-0 place-items-center rounded-full border border-ink-mute/70 align-middle font-serif text-[9.5px] italic leading-none text-ink-mute transition-colors hover:border-accent hover:text-accent ${className}`}
      >
        i
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            className="pointer-events-none fixed z-[100] w-[260px] rounded-md border border-line-strong bg-[#0d131c] px-3 py-2 text-[11.5px] leading-snug text-ink-soft shadow-[0_8px_24px_rgba(0,0,0,0.55)]"
            style={{ left: pos.x, top: pos.y, transform: pos.above ? "translateY(-100%)" : undefined }}
          >
            {term && <strong className="font-semibold text-ink">{term}: </strong>}
            {def}
          </div>,
          document.body,
        )}
    </>
  );
}

/** Label text with an (i) tip next to it. */
export function Term({ children, k, text, className = "" }: { children: React.ReactNode; k?: GlossaryKey; text?: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {children}
      <InfoTip k={k} text={text} />
    </span>
  );
}
