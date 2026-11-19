"use client";

import { startTransition, useState, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { money, myShare, round2, type BudgetCategory, type BudgetTransaction } from "@/lib/budget";
import {
  autoCategorize,
  addTransaction,
  deleteTransaction,
  deleteTransactions,
  setReimbursed,
  setSplits,
  setTransactionCategory,
  setTransactionExcluded,
} from "./actions";
import { hueHex } from "./Rings";
import type { Filter } from "./BudgetView";

const shortDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// The month's itemized spending: every transaction, newest first, each
// with its category (or a split across several). Filter by clicking a
// category ring above or the chips here.
export default function TransactionList({
  today,
  month,
  categories,
  transactions,
  setTransactions,
  filter,
  setFilter,
  spent,
  save,
  aiEnabled,
  onError,
}: {
  today: string;
  month: string;
  categories: BudgetCategory[];
  transactions: BudgetTransaction[];
  setTransactions: Dispatch<SetStateAction<BudgetTransaction[]>>;
  filter: Filter;
  setFilter: (f: Filter) => void;
  spent: number;
  save: (fn: () => Promise<unknown>) => void;
  aiEnabled: boolean;
  onError: (msg: string | null) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [sorting, setSorting] = useState(false);
  const [sortNote, setSortNote] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);

  function toggleSelected(id: string) {
    setConfirmBulk(false);
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function stopSelecting() {
    setSelecting(false);
    setSelected(new Set());
    setConfirmBulk(false);
  }

  function bulkDelete() {
    const ids = [...selected];
    setTransactions((ts) => ts.filter((t) => !selected.has(t.id)));
    stopSelecting();
    save(() => deleteTransactions(ids));
  }

  function sortWithAi() {
    setSorting(true);
    setSortNote(null);
    startTransition(async () => {
      const r = await autoCategorize();
      setSorting(false);
      if (r.notConfigured) onError("AI sorting isn't set up yet: the site needs an ANTHROPIC_API_KEY.");
      else if (!r.ok) onError("Couldn't reach Claude to sort these. Try again in a minute.");
      else
        setSortNote(
          r.sorted === 0 && r.unsure === 0
            ? "Nothing left to sort."
            : `Sorted ${r.sorted} transaction${r.sorted === 1 ? "" : "s"}` +
                (r.unsure > 0 ? `. ${r.unsure} merchant${r.unsure === 1 ? " was" : "s were"} too vague, so those are left for you.` : ".")
        );
      router.refresh();
    });
  }
  const [adding, setAdding] = useState(false);
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const known = new Set(categories.map((c) => c.id));

  const q = query.trim().toLowerCase();
  const shown = transactions.filter((t) => {
    if (q && !t.description.toLowerCase().includes(q) && !(t.account ?? "").toLowerCase().includes(q)) return false;
    if (filter.kind === "excluded") return t.excluded;
    if (filter.kind === "category") {
      if (t.excluded) return false;
      const ids = t.splits.length > 0 ? t.splits.map((s) => s.category_id) : [t.category_id];
      return ids.some((id) => (filter.id === null ? id === null || !known.has(id) : id === filter.id));
    }
    return true;
  });
  const excludedCount = transactions.filter((t) => t.excluded).length;
  const uncategorizedCount = transactions.filter(
    (t) => !t.excluded && t.splits.length === 0 && (t.category_id === null || !known.has(t.category_id))
  ).length;

  const update = (id: string, patch: Partial<BudgetTransaction>) =>
    setTransactions((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const filterLabel =
    filter.kind === "excluded"
      ? "Not counted"
      : filter.kind === "category"
        ? filter.id === null
          ? "Uncategorized"
          : (catName.get(filter.id) ?? "Category")
        : null;

  return (
    <section className="flex flex-col rounded-lg border border-border bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Spending this month</h2>
          <p className="text-xs text-muted">
            {transactions.length - excludedCount} transactions · {money(spent)}
          </p>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1 text-sm outline-none focus:border-accent sm:w-44 sm:flex-none"
          />
          <button
            type="button"
            onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
            className={`shrink-0 rounded-md border px-2.5 py-1 text-sm ${
              selecting ? "border-accent bg-accent/10 text-accent" : "border-border bg-bg hover:border-accent"
            }`}
          >
            {selecting ? "Done" : "Select"}
          </button>
          <button
            type="button"
            onClick={() => setAdding((a) => !a)}
            className="shrink-0 rounded-md border border-border bg-bg px-2.5 py-1 text-sm hover:border-accent"
          >
            + Add expense
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 pt-3 text-xs">
        {filterLabel && (
          <button
            type="button"
            onClick={() => setFilter({ kind: "all" })}
            className="rounded-full bg-accent/15 px-2.5 py-1 text-accent hover:bg-accent/25"
          >
            Showing {filterLabel} ✕
          </button>
        )}
        {uncategorizedCount > 0 && !(filter.kind === "category" && filter.id === null) && (
          <button
            type="button"
            onClick={() => setFilter({ kind: "category", id: null })}
            className="rounded-full border border-border px-2.5 py-1 text-muted hover:border-accent hover:text-text"
          >
            {uncategorizedCount} need a category
          </button>
        )}
        {aiEnabled && uncategorizedCount > 0 && (
          <button
            type="button"
            onClick={sortWithAi}
            disabled={sorting}
            className="rounded-full bg-accent px-2.5 py-1 font-medium text-bg hover:opacity-90 disabled:opacity-60"
            title="Claude picks a category for each uncategorized merchant. Change any it gets wrong."
          >
            {sorting ? "Sorting…" : "✦ Sort with AI"}
          </button>
        )}
        {sortNote && <span className="text-muted">{sortNote}</span>}
        {excludedCount > 0 && filter.kind !== "excluded" && (
          <button
            type="button"
            onClick={() => setFilter({ kind: "excluded" })}
            className="rounded-full border border-border px-2.5 py-1 text-muted hover:border-accent hover:text-text"
            title="Card payments, transfers and anything you chose not to count"
          >
            {excludedCount} not counted
          </button>
        )}
      </div>

      {adding && (
        <AddExpense
          today={today.startsWith(month) ? today : `${month}-01`}
          categories={categories}
          onCancel={() => setAdding(false)}
          onAdd={(input) => {
            setAdding(false);
            save(() => addTransaction(input));
          }}
        />
      )}

      {selecting && (
        <div className="sticky top-[60px] z-10 mx-4 mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-accent/50 bg-panel px-3 py-2 text-sm shadow-[0_1px_3px_rgba(58,53,44,0.10)] md:top-2">
          <span className="font-medium">{selected.size} selected</span>
          {(() => {
            const allShown = shown.length > 0 && shown.every((t) => selected.has(t.id));
            return (
              <button
                type="button"
                onClick={() => {
                  setConfirmBulk(false);
                  setSelected(allShown ? new Set() : new Set(shown.map((t) => t.id)));
                }}
                className="text-muted hover:text-text"
              >
                {allShown ? "Clear selection" : `Select all ${shown.length} shown`}
              </button>
            );
          })()}
          <span className="ml-auto flex items-center gap-2">
            {confirmBulk ? (
              <>
                <span className="text-xs text-muted">Delete {selected.size} for good?</span>
                <button
                  type="button"
                  onClick={bulkDelete}
                  className="rounded-md bg-bad px-2.5 py-1 font-medium text-bg hover:opacity-90"
                >
                  Delete
                </button>
                <button type="button" onClick={() => setConfirmBulk(false)} className="text-muted hover:text-text">
                  Keep
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={selected.size === 0}
                onClick={() => setConfirmBulk(true)}
                className="rounded-md border border-bad/50 px-2.5 py-1 text-bad hover:bg-bad/10 disabled:opacity-40"
              >
                Delete {selected.size > 0 ? selected.size : ""}
              </button>
            )}
          </span>
        </div>
      )}

      <ul className="flex flex-col px-2 py-2">
        {shown.length === 0 && (
          <li className="px-2 py-6 text-center text-sm text-muted">
            {transactions.length === 0 ? "No transactions this month yet." : "Nothing matches."}
          </li>
        )}
        {shown.map((t) => (
          <TransactionRow
            key={t.id}
            t={t}
            selecting={selecting}
            selected={selected.has(t.id)}
            onToggleSelect={() => toggleSelected(t.id)}
            categories={categories}
            known={known}
            onCategory={(categoryId) => {
              update(t.id, { category_id: categoryId, auto: false });
              save(async () => {
                const changed = await setTransactionCategory(t.id, categoryId);
                if (changed)
                  setTransactions((ts) =>
                    ts.map((x) => (changed.includes(x.id) ? { ...x, category_id: categoryId } : x))
                  );
                return changed;
              });
            }}
            onExclude={(excluded) => {
              update(t.id, { excluded });
              save(() => setTransactionExcluded(t.id, excluded));
            }}
            onSplit={(parts) => {
              update(t.id, { splits: parts.map((p, i) => ({ id: `new-${i}`, ...p })) });
              save(() => setSplits(t.id, parts));
            }}
            onPayback={(reimbursed) => {
              update(t.id, { reimbursed, splits: [] });
              save(() => setReimbursed(t.id, reimbursed));
            }}
            onDelete={() => {
              setTransactions((ts) => ts.filter((x) => x.id !== t.id));
              save(() => deleteTransaction(t.id));
            }}
          />
        ))}
      </ul>
    </section>
  );
}

function CategorySelect({
  value,
  categories,
  known,
  onChange,
  className = "",
}: {
  value: string | null;
  categories: BudgetCategory[];
  known: Set<string>;
  onChange: (id: string | null) => void;
  className?: string;
}) {
  const v = value && known.has(value) ? value : "";
  return (
    <select
      value={v}
      onChange={(e) => onChange(e.target.value || null)}
      className={`rounded-md border bg-bg px-1.5 py-1 text-sm outline-none focus:border-accent ${
        v ? "border-border" : "border-accent/60 text-muted"
      } ${className}`}
    >
      <option value="">Uncategorized</option>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

function TransactionRow({
  t,
  selecting,
  selected,
  onToggleSelect,
  categories,
  known,
  onCategory,
  onExclude,
  onSplit,
  onPayback,
  onDelete,
}: {
  t: BudgetTransaction;
  selecting: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  categories: BudgetCategory[];
  known: Set<string>;
  onCategory: (id: string | null) => void;
  onExclude: (excluded: boolean) => void;
  onSplit: (parts: { category_id: string | null; amount: number }[]) => void;
  onPayback: (reimbursed: number) => void;
  onDelete: () => void;
}) {
  const [splitting, setSplitting] = useState(false);
  const [payingBack, setPayingBack] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const cat = new Map(categories.map((c) => [c.id, c]));
  const isSplit = t.splits.length > 0;

  return (
    <li
      onClick={selecting ? onToggleSelect : undefined}
      className={`group flex flex-col rounded-md px-2 py-1.5 ${
        selecting ? `cursor-pointer ${selected ? "bg-accent/10" : "hover:bg-bg/70"}` : "hover:bg-bg/70"
      } ${t.excluded && !selected ? "opacity-60" : ""}`}
    >
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 sm:flex-nowrap ${selecting ? "pointer-events-none" : ""}`}>
        {selecting && (
          <span
            aria-hidden="true"
            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] text-bg ${
              selected ? "border-accent bg-accent" : "border-muted bg-panel"
            }`}
          >
            {selected ? "✓" : ""}
          </span>
        )}
        <span className="w-12 shrink-0 text-xs tabular-nums text-muted">{shortDate(t.date)}</span>
        <div className="min-w-0 flex-1 basis-[calc(100%-4rem)] sm:basis-auto">
          {/* Just the description; the account it came from shows on hover. */}
          <div className="truncate text-sm" title={t.account ? `${t.description}\n${t.account}` : t.description}>
            {t.description}
          </div>
        </div>
        <div className={`${selecting ? "ml-[5.5rem]" : "ml-[3.75rem]"} flex flex-1 flex-wrap items-center justify-end gap-2 sm:ml-0 sm:flex-none sm:flex-nowrap`}>
          {t.excluded ? (
            <span className="w-40 text-xs text-muted">Not counted</span>
          ) : isSplit ? (
            <button
              type="button"
              onClick={() => setSplitting((s) => !s)}
              className="w-40 truncate rounded-md border border-border bg-bg px-1.5 py-1 text-left text-sm hover:border-accent"
            >
              Split · {t.splits.length} categories
            </button>
          ) : (
            <CategorySelect
              value={t.category_id}
              categories={categories}
              known={known}
              onChange={onCategory}
              className="w-40"
            />
          )}
          {/* Fixed-width slot so the "AI" tag never shifts the column. */}
          <span className="-ml-1 flex w-5 shrink-0 justify-center">
            {t.auto && !t.excluded && !isSplit && (
              <span
                className="rounded bg-accent/15 px-1 text-[10px] font-medium text-accent"
                title="Sorted by Claude. Pick a different category if it's wrong, and that's remembered instead."
              >
                AI
              </span>
            )}
          </span>
          <span
            className={`flex w-24 shrink-0 flex-col items-end text-sm tabular-nums ${t.amount < 0 ? "text-good" : ""} ${
              t.excluded ? "line-through" : ""
            }`}
          >
            {t.amount < 0 ? `−${money(-t.amount)}` : money(myShare(t))}
            {t.reimbursed > 0 && (
              <span className="text-[11px] leading-tight text-muted" title={`${money(t.reimbursed)} paid back`}>
                of {money(t.amount)}
              </span>
            )}
          </span>
          <div
            className={`flex w-full shrink-0 items-center justify-end gap-3 text-xs opacity-0 sm:w-[11rem] sm:gap-2 ${
              selecting ? "invisible" : "group-hover:opacity-100 [@media(hover:none)]:opacity-100"
            }`}
          >
            {confirm ? (
              <>
                <button type="button" onClick={onDelete} className="font-medium text-bad hover:underline">
                  Delete
                </button>
                <button type="button" onClick={() => setConfirm(false)} className="text-muted hover:text-text">
                  Keep
                </button>
              </>
            ) : (
              <>
                {!t.excluded && t.amount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSplitting(false);
                      setPayingBack((p) => !p);
                    }}
                    className="whitespace-nowrap text-muted hover:text-text"
                    title="Someone paid you back for part of this"
                  >
                    Paid back
                  </button>
                )}
                {!t.excluded && (
                  <button
                    type="button"
                    onClick={() => {
                      setPayingBack(false);
                      setSplitting((s) => !s);
                    }}
                    className="text-muted hover:text-text"
                  >
                    Split
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onExclude(!t.excluded)}
                  className="text-muted hover:text-text"
                  title={t.excluded ? "Count this as spending" : "Leave this out (card payment, transfer)"}
                >
                  {t.excluded ? "Count" : "Skip"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirm(true)}
                  aria-label="Delete transaction"
                  className="text-muted hover:text-bad"
                >
                  ✕
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {isSplit && !splitting && !t.excluded && (
        <div className={`${selecting ? "ml-[5.5rem]" : "ml-[3.75rem]"} mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted`}>
          {t.splits.map((s) => {
            const c = s.category_id ? cat.get(s.category_id) : undefined;
            return (
              <span key={s.id} className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: c ? hueHex(c.color) : "#b5ab97" }} />
                {c?.name ?? "Uncategorized"} {money(s.amount)}
              </span>
            );
          })}
        </div>
      )}

      {t.reimbursed > 0 && !payingBack && !t.excluded && (
        <div className={`${selecting ? "ml-[5.5rem]" : "ml-[3.75rem]"} mt-1 text-xs text-muted`}>
          {money(t.reimbursed)} paid back · your share {money(myShare(t))}
        </div>
      )}

      {payingBack && (
        <PaybackEditor
          t={t}
          onCancel={() => setPayingBack(false)}
          onSave={(r) => {
            setPayingBack(false);
            onPayback(r);
          }}
        />
      )}

      {splitting && (
        <SplitEditor
          t={t}
          categories={categories}
          known={known}
          onCancel={() => setSplitting(false)}
          onSave={(parts) => {
            setSplitting(false);
            onSplit(parts);
          }}
        />
      )}
    </li>
  );
}

// Divides one transaction among categories, e.g. a Target run that was
// part Groceries, part Household. Parts must add up to the total.
function SplitEditor({
  t,
  categories,
  known,
  onCancel,
  onSave,
}: {
  t: BudgetTransaction;
  categories: BudgetCategory[];
  known: Set<string>;
  onCancel: () => void;
  onSave: (parts: { category_id: string | null; amount: number }[]) => void;
}) {
  const [parts, setParts] = useState<{ category_id: string | null; text: string }[]>(() =>
    t.splits.length > 0
      ? t.splits.map((s) => ({ category_id: s.category_id, text: s.amount.toFixed(2) }))
      : [
          { category_id: t.category_id, text: myShare(t).toFixed(2) },
          { category_id: null, text: "" },
        ]
  );
  const amounts = parts.map((p) => (p.text.trim() === "" ? 0 : Number(p.text.replace(/[$,\s]/g, ""))));
  const valid = amounts.every((n) => Number.isFinite(n));
  const sum = round2(amounts.reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0));
  const left = round2(myShare(t) - sum);
  const filled = parts.filter((_, i) => amounts[i] !== 0);
  const canSave = valid && Math.abs(left) < 0.005 && filled.length >= 2;

  const set = (i: number, patch: Partial<(typeof parts)[number]>) =>
    setParts((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  return (
    <div className="ml-0 mt-2 flex flex-col gap-2 rounded-md border border-border bg-bg p-3 sm:ml-[3.75rem]">
      <p className="text-xs text-muted">
        Split {money(myShare(t))}
        {t.reimbursed > 0 ? " (your share)" : ""} across categories.
      </p>
      {parts.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <CategorySelect
            value={p.category_id}
            categories={categories}
            known={known}
            onChange={(id) => set(i, { category_id: id })}
            className="min-w-0 flex-1"
          />
          <span className="relative w-28 shrink-0">
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
            <input
              inputMode="decimal"
              value={p.text}
              onChange={(e) => set(i, { text: e.target.value })}
              className="w-full rounded-md border border-border bg-panel py-1 pl-5 pr-2 text-right text-sm tabular-nums outline-none focus:border-accent"
            />
          </span>
          <button
            type="button"
            onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))}
            disabled={parts.length <= 2}
            aria-label="Remove part"
            className="shrink-0 px-1 text-xs text-muted hover:text-bad disabled:opacity-30"
          >
            ✕
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() =>
              setParts((ps) => [...ps, { category_id: null, text: left > 0 ? left.toFixed(2) : "" }])
            }
            className="text-muted hover:text-text"
          >
            + Add part
          </button>
          {left !== 0 && valid && (
            <button
              type="button"
              onClick={() => {
                const last = parts.length - 1;
                set(last, { text: round2(amounts[last] + left).toFixed(2) });
              }}
              className="text-muted hover:text-text"
            >
              Put the rest in the last part
            </button>
          )}
        </div>
        <span className={canSave ? "text-good" : "text-warn"}>
          {!valid
            ? "Check the amounts"
            : Math.abs(left) >= 0.005
              ? left > 0
                ? `${money(left)} left to assign`
                : `${money(-left)} too much`
              : filled.length < 2
                ? "Move some of it into another part"
                : "Adds up"}
        </span>
      </div>
      <div className="flex justify-end gap-2">
        {t.splits.length > 0 && (
          <button
            type="button"
            onClick={() => onSave([])}
            className="mr-auto text-xs text-muted hover:text-bad"
          >
            Remove split
          </button>
        )}
        <button type="button" onClick={onCancel} className="rounded-md px-2.5 py-1 text-sm text-muted hover:text-text">
          Cancel
        </button>
        <button
          type="button"
          disabled={!canSave}
          onClick={() =>
            onSave(
              parts
                .map((p, i) => ({ category_id: p.category_id, amount: round2(amounts[i]) }))
                .filter((p) => p.amount !== 0)
            )
          }
          className="rounded-md bg-accent px-2.5 py-1 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-40"
        >
          Save split
        </button>
      </div>
    </div>
  );
}

function AddExpense({
  today,
  categories,
  onCancel,
  onAdd,
}: {
  today: string;
  categories: BudgetCategory[];
  onCancel: () => void;
  onAdd: (input: { date: string; description: string; amount: number; categoryId: string | null }) => void;
}) {
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const n = Number(amount.replace(/[$,\s]/g, ""));
  const ok = description.trim() !== "" && amount.trim() !== "" && Number.isFinite(n) && n !== 0;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onAdd({ date, description, amount: round2(n), categoryId });
      }}
      className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-bg p-3"
    >
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        required
        className="rounded-md border border-border bg-panel px-2 py-1 text-sm outline-none focus:border-accent"
      />
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What was it?"
        autoFocus
        maxLength={300}
        className="min-w-0 flex-1 basis-40 rounded-md border border-border bg-panel px-2 py-1 text-sm outline-none focus:border-accent"
      />
      <span className="relative w-28">
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="w-full rounded-md border border-border bg-panel py-1 pl-5 pr-2 text-right text-sm tabular-nums outline-none focus:border-accent"
        />
      </span>
      <select
        value={categoryId ?? ""}
        onChange={(e) => setCategoryId(e.target.value || null)}
        className="rounded-md border border-border bg-panel px-1.5 py-1 text-sm outline-none focus:border-accent"
      >
        <option value="">Uncategorized</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <div className="ml-auto flex gap-2">
        <button type="button" onClick={onCancel} className="px-2 py-1 text-sm text-muted hover:text-text">
          Cancel
        </button>
        <button
          type="submit"
          disabled={!ok}
          className="rounded-md bg-accent px-2.5 py-1 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </form>
  );
}

// "Paid back": for a charge you covered for others (the whole dinner
// table), record what they paid you, either as an amount or by splitting
// the bill evenly. Only your share counts toward the budget.
function PaybackEditor({
  t,
  onCancel,
  onSave,
}: {
  t: BudgetTransaction;
  onCancel: () => void;
  onSave: (reimbursed: number) => void;
}) {
  const [mode, setMode] = useState<"amount" | "even">("amount");
  const [text, setText] = useState(t.reimbursed > 0 ? t.reimbursed.toFixed(2) : "");
  const [people, setPeople] = useState("2");

  const n = Number(people);
  const evenShare = Number.isInteger(n) && n >= 2 && n <= 50 ? round2(t.amount / n) : null;
  const typed = text.trim() === "" ? 0 : Number(text.replace(/[$,\s]/g, ""));
  const reimbursed =
    mode === "even" ? (evenShare === null ? null : round2(t.amount - evenShare)) : Number.isFinite(typed) ? round2(typed) : null;
  const ok = reimbursed !== null && reimbursed >= 0 && reimbursed <= t.amount;
  const share = ok ? round2(t.amount - reimbursed) : null;

  const tab = (m: "amount" | "even", label: string) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      className={`rounded-md px-2.5 py-1 text-xs ${mode === m ? "bg-accent/15 font-medium text-accent" : "text-muted hover:text-text"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="ml-0 mt-2 flex flex-col gap-3 rounded-md border border-border bg-bg p-3 sm:ml-[3.75rem]">
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-2 text-xs text-muted">You paid {money(t.amount)}.</span>
        {tab("amount", "Others paid me back")}
        {tab("even", "Split evenly")}
      </div>
      {mode === "amount" ? (
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">Paid back</span>
          <span className="relative w-28">
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
            <input
              inputMode="decimal"
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-md border border-border bg-panel py-1 pl-5 pr-2 text-right text-sm tabular-nums outline-none focus:border-accent"
            />
          </span>
        </label>
      ) : (
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">People, including you</span>
          <input
            inputMode="numeric"
            autoFocus
            value={people}
            onChange={(e) => setPeople(e.target.value)}
            className="w-16 rounded-md border border-border bg-panel px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-accent"
          />
        </label>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`text-xs ${ok ? "text-muted" : "text-warn"}`}>
          {ok ? (
            <>
              Your share: <span className="font-medium text-text">{money(share!)}</span>
              {t.splits.length > 0 && " · this removes the split"}
            </>
          ) : mode === "even" ? (
            "Enter 2 or more people"
          ) : (
            `Paid back can't be more than ${money(t.amount)}`
          )}
        </span>
        <div className="flex gap-2">
          {t.reimbursed > 0 && (
            <button type="button" onClick={() => onSave(0)} className="mr-2 text-xs text-muted hover:text-bad">
              Remove
            </button>
          )}
          <button type="button" onClick={onCancel} className="rounded-md px-2.5 py-1 text-sm text-muted hover:text-text">
            Cancel
          </button>
          <button
            type="button"
            disabled={!ok}
            onClick={() => ok && onSave(reimbursed!)}
            className="rounded-md bg-accent px-2.5 py-1 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
