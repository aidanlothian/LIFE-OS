"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { HUES } from "@/lib/memoryColors";
import { money, monthLabel, round2, type BudgetCategory } from "@/lib/budget";
import { createCategory, deleteCategory, setAllocation, setMonthTotal, updateCategory } from "./actions";
import { hueHex } from "./Rings";

// "Edit budget": the month's total, how much goes to each category, and
// the categories themselves (name, color, add, delete).
export default function BudgetEditor({
  month,
  categories,
  setCategories,
  total,
  setTotal,
  allocations,
  setAllocations,
  allocated,
  save,
}: {
  month: string;
  categories: BudgetCategory[];
  setCategories: Dispatch<SetStateAction<BudgetCategory[]>>;
  total: number | null;
  setTotal: (n: number | null) => void;
  allocations: Record<string, number>;
  setAllocations: Dispatch<SetStateAction<Record<string, number>>>;
  allocated: number;
  save: (fn: () => Promise<unknown>) => void;
}) {
  const [newName, setNewName] = useState("");
  const [colorFor, setColorFor] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const left = total === null ? null : round2(total - allocated);

  function addCategory() {
    const name = newName.trim();
    if (!name) return;
    const used = new Set(categories.map((c) => c.color));
    const color = HUES.find((h) => !used.has(h.key))?.key ?? "gray";
    setNewName("");
    save(async () => {
      const c = await createCategory(name, color);
      if (c) setCategories((cs) => [...cs, c]);
      return c;
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-accent/50 bg-panel p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Budget for {monthLabel(month)}</h2>
          <p className="text-xs text-muted">Changes save as you go.</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">Total for the month</span>
          <MoneyInput
            value={total}
            onCommit={(n) => {
              setTotal(n);
              save(() => setMonthTotal(month, n));
            }}
            className="w-32"
          />
        </label>
      </div>

      <div className="flex flex-col divide-y divide-border/70 rounded-md border border-border">
        {categories.length === 0 && <p className="px-3 py-3 text-sm text-muted">No categories yet. Add one below.</p>}
        {categories.map((c) => (
          <div key={c.id} className="group flex flex-col gap-2 px-3 py-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setColorFor((x) => (x === c.id ? null : c.id))}
                aria-label={`Change ${c.name} color`}
                className="h-4 w-4 shrink-0 rounded-full ring-offset-2 ring-offset-panel hover:ring-2 hover:ring-border"
                style={{ background: hueHex(c.color) }}
              />
              <NameInput
                value={c.name}
                onCommit={(name) => {
                  setCategories((cs) => cs.map((x) => (x.id === c.id ? { ...x, name } : x)));
                  save(() => updateCategory(c.id, { name }));
                }}
              />
              <MoneyInput
                value={allocations[c.id] ?? null}
                placeholder="0"
                onCommit={(n) => {
                  setAllocations((a) => ({ ...a, [c.id]: n }));
                  save(() => setAllocation(month, c.id, n));
                }}
                className="w-28"
              />
              {confirmDelete === c.id ? (
                <span className="flex shrink-0 items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmDelete(null);
                      setCategories((cs) => cs.filter((x) => x.id !== c.id));
                      save(() => deleteCategory(c.id));
                    }}
                    className="font-medium text-bad hover:underline"
                  >
                    Delete
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(null)} className="text-muted hover:text-text">
                    Keep
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(c.id)}
                  aria-label={`Delete ${c.name}`}
                  className="shrink-0 px-1 text-muted opacity-0 hover:text-bad group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                >
                  ✕
                </button>
              )}
            </div>
            {confirmDelete === c.id && (
              <p className="pl-6 text-xs text-muted">
                Its transactions stay, as Uncategorized. Its budget amounts are removed.
              </p>
            )}
            {colorFor === c.id && (
              <div className="flex flex-wrap gap-1.5 pl-6">
                {HUES.map((h) => (
                  <button
                    key={h.key}
                    type="button"
                    aria-label={h.label}
                    title={h.label}
                    onClick={() => {
                      setColorFor(null);
                      setCategories((cs) => cs.map((x) => (x.id === c.id ? { ...x, color: h.key } : x)));
                      save(() => updateCategory(c.id, { color: h.key }));
                    }}
                    className={`h-5 w-5 rounded-full ${c.color === h.key ? "ring-2 ring-text ring-offset-2 ring-offset-panel" : ""}`}
                    style={{ background: h.hex }}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addCategory();
          }}
          className="flex items-center gap-2 px-3 py-2"
        >
          <span className="h-4 w-4 shrink-0 rounded-full border border-dashed border-muted" />
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New category"
            maxLength={60}
            className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm outline-none placeholder:text-muted focus:border-accent focus:bg-bg"
          />
          <button
            type="submit"
            disabled={!newName.trim()}
            className="shrink-0 rounded-md border border-border bg-bg px-2.5 py-1 text-sm hover:border-accent disabled:opacity-40"
          >
            Add
          </button>
        </form>
      </div>

      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <span className="text-muted">Given to categories: {money(allocated)}</span>
        {left !== null && (
          <span className={left < 0 ? "font-medium text-bad" : left > 0 ? "text-muted" : "text-good"}>
            {left === 0
              ? "Every dollar has a category"
              : left > 0
                ? `${money(left)} still to give out`
                : `${money(-left)} more than the total`}
          </span>
        )}
      </div>
    </section>
  );
}

// A dollar amount that saves when you leave the field or press Enter.
function MoneyInput({
  value,
  onCommit,
  placeholder = "",
  className = "",
}: {
  value: number | null;
  onCommit: (n: number) => void;
  placeholder?: string;
  className?: string;
}) {
  const shown = value === null ? "" : String(value);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);

  function commit() {
    const s = text.replace(/[$,\s]/g, "");
    if (s === "" && value === null) return;
    const n = s === "" ? 0 : Number(s);
    if (!/^\d*(\.\d{0,2})?$/.test(s) || !Number.isFinite(n)) {
      setText(shown);
      return;
    }
    if (n !== value) onCommit(round2(n));
  }

  return (
    <span className={`relative shrink-0 ${className}`}>
      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
      <input
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="w-full rounded-md border border-border bg-bg py-1 pl-5 pr-2 text-right text-sm tabular-nums outline-none focus:border-accent"
      />
    </span>
  );
}

function NameInput({ value, onCommit }: { value: string; onCommit: (s: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      value={text}
      maxLength={60}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const t = text.trim();
        if (!t) setText(value);
        else if (t !== value) onCommit(t);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm outline-none hover:border-border focus:border-accent focus:bg-bg"
    />
  );
}
