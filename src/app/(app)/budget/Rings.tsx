"use client";

import { useState } from "react";
import { HUES } from "@/lib/memoryColors";
import { money } from "@/lib/budget";

export function hueHex(key: string): string {
  return HUES.find((h) => h.key === key)?.hex ?? "#8c8372";
}

const TRACK = "#ece6d8"; // a step between `border` and `panel`
const BAD = "#b0503f"; // tailwind `bad`

export interface Segment {
  id: string;
  label: string;
  color: string; // hex
  amount: number;
}

// The month's headline: one ring for the whole budget, filled by each
// category's spending in its own color (in category order, with a small
// gap between). Hovering a piece shows that category in the middle.
export function TotalRing({
  segments,
  total,
  size = 220,
}: {
  segments: Segment[];
  total: number | null;
  size?: number;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const stroke = 18;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const spent = segments.reduce((s, x) => s + Math.max(0, x.amount), 0);
  const over = total !== null && spent > total;
  // Over budget: the pieces are scaled to fill the ring, and a red outer
  // ring says so.
  const scale = total && total > 0 ? Math.max(total, spent) : spent || 1;
  const gap = segments.filter((s) => s.amount > 0).length > 1 ? 3 : 0;

  let offset = 0;
  const arcs = segments
    .filter((s) => s.amount > 0)
    .map((s) => {
      const len = (s.amount / scale) * circ;
      const arc = { ...s, start: offset, len: Math.max(0.5, len - gap) };
      offset += len;
      return arc;
    });
  const hovered = arcs.find((a) => a.id === hover);
  const pct = total && total > 0 ? Math.round((spent / total) * 100) : null;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={TRACK} strokeWidth={stroke} />
        {arcs.map((a) => (
          <circle
            key={a.id}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={a.color}
            strokeWidth={hover === a.id ? stroke + 4 : stroke}
            strokeDasharray={`${a.len} ${circ}`}
            strokeDashoffset={-a.start}
            className="cursor-default transition-[stroke-width]"
            onMouseEnter={() => setHover(a.id)}
            onMouseLeave={() => setHover(null)}
          >
            <title>{`${a.label}: ${money(a.amount)}`}</title>
          </circle>
        ))}
        {over && (
          <circle cx={size / 2} cy={size / 2} r={r + stroke / 2 + 4} fill="none" stroke={BAD} strokeWidth={2} />
        )}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
        {hovered ? (
          <>
            <span className="text-xs text-muted">{hovered.label}</span>
            <span className="text-2xl font-semibold">{money(hovered.amount, true)}</span>
            <span className="text-xs text-muted">
              {spent > 0 ? `${Math.round((hovered.amount / spent) * 100)}% of spending` : ""}
            </span>
          </>
        ) : (
          <>
            <span className="text-xs text-muted">Spent</span>
            <span className="text-2xl font-semibold">{money(spent, true)}</span>
            {total !== null ? (
              <span className={`text-xs ${over ? "font-medium text-bad" : "text-muted"}`}>
                of {money(total, true)}
                {pct !== null ? ` · ${pct}%` : ""}
              </span>
            ) : (
              <span className="text-xs text-muted">No budget set</span>
            )}
            {total !== null && (
              <span className={`mt-1 text-sm font-medium ${over ? "text-bad" : "text-good"}`}>
                {over ? `${money(spent - total, true)} over` : `${money(total - spent, true)} left`}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// One category: how much of what was set aside for it is used.
export function CategoryRing({
  label,
  color,
  spent,
  budget,
  active,
  onClick,
}: {
  label: string;
  color: string;
  spent: number;
  budget: number | null;
  active: boolean;
  onClick: () => void;
}) {
  const size = 64;
  const stroke = 7;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const hasBudget = budget !== null && budget > 0;
  const frac = hasBudget ? Math.min(1, Math.max(0, spent) / budget) : 0;
  const over = hasBudget && spent > budget;
  const pct = hasBudget ? Math.round((spent / budget) * 100) : null;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={active ? "Show all transactions" : `Show only ${label}`}
      className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
        active ? "border-accent bg-accent/10" : "border-border bg-panel hover:border-accent/60"
      }`}
    >
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={TRACK}
            strokeWidth={stroke}
            strokeDasharray={hasBudget ? undefined : "3 4"}
          />
          {frac > 0 && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={over ? BAD : color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${frac * circ} ${circ}`}
            />
          )}
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-xs font-medium">
          {pct !== null ? `${pct}%` : "—"}
        </span>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
          <span className="truncate text-sm font-medium">{label}</span>
        </div>
        <div className="text-xs text-muted">
          {money(spent, true)}
          {hasBudget ? ` of ${money(budget, true)}` : " · no budget"}
        </div>
        {hasBudget && (
          <div className={`text-xs ${over ? "font-medium text-bad" : "text-muted"}`}>
            {over ? `${money(spent - budget, true)} over` : `${money(budget - spent, true)} left`}
          </div>
        )}
      </div>
    </button>
  );
}
