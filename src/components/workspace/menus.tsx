"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Menus shared by the workspace canvas and its widgets.

// A small menu anchored under a button. It's portalled to <body> with fixed
// positioning because grid items are CSS-transformed (which would otherwise
// become its positioning frame) and Section bodies clip their overflow.
export function Popover({
  anchor,
  onClose,
  width = 224,
  children,
}: {
  anchor: HTMLElement;
  onClose: () => void;
  width?: number;
  children: ReactNode;
}) {
  const rect = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  // Opens upward when the button is near the bottom of the window, so the
  // menu is never cut off below the fold.
  const below = window.innerHeight - rect.bottom;
  const up = below < 300 && rect.top > below;
  const vertical = up ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 };
  // As tall as the room on that side allows (and scrollable past that), so
  // the last items are never cut off by the window edge.
  const maxHeight = Math.max(160, (up ? rect.top : below) - 16);
  const menuRef = useRef<HTMLDivElement>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    // When the page scrolls, the menu follows its button (re-rendering
    // re-measures it), closing only once the button has left the window.
    // Scrolling inside the menu itself is ignored.
    const follow = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      const r = anchor.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) onClose();
      else setTick((t) => t + 1);
    };
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [anchor, onClose]);
  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        ref={menuRef}
        className="fixed z-50 overflow-y-auto overscroll-contain rounded-md border border-border bg-panel py-1 text-sm shadow-[0_4px_14px_rgba(58,53,44,0.15)]"
        style={{ ...vertical, left, width, maxHeight }}
      >
        {children}
      </div>
    </>,
    document.body
  );
}

export function MenuButton({
  label,
  ariaLabel,
  className,
  width,
  children,
}: {
  label: ReactNode;
  ariaLabel?: string;
  className: string;
  width?: number;
  children: (close: () => void) => ReactNode;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        className={className}
      >
        {label}
      </button>
      {anchor && (
        <Popover anchor={anchor} width={width} onClose={() => setAnchor(null)}>
          {children(() => setAnchor(null))}
        </Popover>
      )}
    </>
  );
}

export function MenuItem({
  onClick,
  disabled,
  indent = 0,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  indent?: number;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{ paddingLeft: 12 + indent * 14 }}
      className="block w-full truncate py-1.5 pr-3 text-left text-text hover:bg-border/40 disabled:cursor-default disabled:text-muted disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
