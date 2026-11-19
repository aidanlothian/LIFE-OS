"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  allocationsOf,
  money,
  monthLabel,
  nextMonth,
  prevMonth,
  type BudgetCategory,
  type BudgetTransaction,
} from "@/lib/budget";
import { addStarterCategories, copyBudget } from "./actions";
import { CategoryRing, TotalRing, hueHex, type Segment } from "./Rings";
import BudgetEditor from "./BudgetEditor";
import TransactionList from "./TransactionList";
import ImportCsv from "./ImportCsv";

export type Filter = { kind: "all" } | { kind: "category"; id: string | null } | { kind: "excluded" };

const UNCAT_COLOR = "#b5ab97";

export default function BudgetView(props: {
  month: string;
  thisMonth: string;
  today: string;
  categories: BudgetCategory[];
  total: number | null;
  allocations: Record<string, number>;
  transactions: BudgetTransaction[];
  prevHasBudget: boolean;
  loadError: boolean;
  aiEnabled: boolean;
}) {
  const { month, thisMonth } = props;
  const router = useRouter();

  // Local copies so every edit shows instantly; they re-sync whenever the
  // server sends fresh data (after each save's refresh).
  const [categories, setCategories] = useState(props.categories);
  const [total, setTotal] = useState(props.total);
  const [allocations, setAllocations] = useState(props.allocations);
  const [transactions, setTransactions] = useState(props.transactions);
  useEffect(() => setCategories(props.categories), [props.categories]);
  useEffect(() => setTotal(props.total), [props.total]);
  useEffect(() => setAllocations(props.allocations), [props.allocations]);
  useEffect(() => setTransactions(props.transactions), [props.transactions]);

  const [editing, setEditing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [error, setError] = useState<string | null>(props.loadError ? "Some budget data didn't load. Try refreshing." : null);

  // Runs a save in the background, then refreshes from the server.
  function save(fn: () => Promise<unknown>) {
    startTransition(async () => {
      const result = await fn();
      if (result === false || result === null) setError("Couldn't save that change. It's been undone; try again.");
      router.refresh();
    });
  }

  const spentBy = useMemo(() => {
    const m = new Map<string | null, number>();
    for (const t of transactions)
      for (const a of allocationsOf(t)) m.set(a.category_id, (m.get(a.category_id) ?? 0) + a.amount);
    return m;
  }, [transactions]);

  const known = new Set(categories.map((c) => c.id));
  const uncategorized = [...spentBy.entries()]
    .filter(([id]) => id === null || !known.has(id))
    .reduce((s, [, v]) => s + v, 0);

  const segments: Segment[] = [
    ...categories.map((c) => ({ id: c.id, label: c.name, color: hueHex(c.color), amount: spentBy.get(c.id) ?? 0 })),
    ...(uncategorized > 0 ? [{ id: "none", label: "Uncategorized", color: UNCAT_COLOR, amount: uncategorized }] : []),
  ];
  const spent = segments.reduce((s, x) => s + Math.max(0, x.amount), 0);
  const allocated = Object.entries(allocations)
    .filter(([id]) => known.has(id))
    .reduce((s, [, v]) => s + v, 0);
  // Categories with a budget or spending this month get a ring.
  const ringCats = categories.filter((c) => (allocations[c.id] ?? 0) > 0 || (spentBy.get(c.id) ?? 0) !== 0);

  const toggleCategory = (id: string | null) =>
    setFilter((f) => (f.kind === "category" && f.id === id ? { kind: "all" } : { kind: "category", id }));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Budget</h1>
          <div className="mt-1 flex items-center gap-1 text-sm">
            <Link
              href={`/budget?m=${prevMonth(month)}`}
              className="rounded px-1.5 py-0.5 text-muted hover:bg-border/50 hover:text-text"
              aria-label="Previous month"
            >
              ‹
            </Link>
            <span className="min-w-[8.5rem] text-center font-medium">{monthLabel(month)}</span>
            <Link
              href={`/budget?m=${nextMonth(month)}`}
              className="rounded px-1.5 py-0.5 text-muted hover:bg-border/50 hover:text-text"
              aria-label="Next month"
            >
              ›
            </Link>
            {month !== thisMonth && (
              <Link href="/budget" className="ml-1 text-xs text-muted underline-offset-2 hover:text-text hover:underline">
                This month
              </Link>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setImporting(true)}
            className="rounded-md border border-border bg-panel px-3 py-1.5 text-sm hover:border-accent"
          >
            Import CSV
          </button>
          <button
            type="button"
            onClick={() => setEditing((e) => !e)}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:opacity-90"
          >
            {editing ? "Done" : total === null ? "Set budget" : "Edit budget"}
          </button>
        </div>
      </header>

      {error && (
        <p className="flex items-start justify-between gap-3 rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          {error}
          <button type="button" onClick={() => setError(null)} className="shrink-0 text-xs underline">
            Dismiss
          </button>
        </p>
      )}

      {categories.length === 0 && (
        <section className="rounded-lg border border-border bg-panel p-4">
          <h2 className="text-sm font-semibold">Start with some categories</h2>
          <p className="mt-1 text-sm text-muted">
            Add a starter set (Groceries, Dining Out, Transportation and more) and rename or remove them later, or make
            your own under {total === null ? "Set budget" : "Edit budget"}.
          </p>
          <button
            type="button"
            onClick={() => save(addStarterCategories)}
            className="mt-3 rounded-md border border-border bg-bg px-3 py-1.5 text-sm hover:border-accent"
          >
            Add starter categories
          </button>
        </section>
      )}

      {editing && (
        <BudgetEditor
          month={month}
          categories={categories}
          setCategories={setCategories}
          total={total}
          setTotal={setTotal}
          allocations={allocations}
          setAllocations={setAllocations}
          allocated={allocated}
          save={save}
        />
      )}

      <section className="flex flex-col gap-5 rounded-lg border border-border bg-panel p-4 md:flex-row md:items-start">
        <div className="flex flex-col items-center gap-2 md:w-[240px]">
          <TotalRing segments={segments} total={total} />
          {total === null && !editing && (
            <div className="flex flex-col items-center gap-1 text-center">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-sm text-accent underline-offset-2 hover:underline"
              >
                Set a budget for {monthLabel(month).split(" ")[0]}
              </button>
              {props.prevHasBudget && (
                <button
                  type="button"
                  onClick={() => save(() => copyBudget(month, prevMonth(month)))}
                  className="text-xs text-muted underline-offset-2 hover:text-text hover:underline"
                >
                  or copy last month&apos;s
                </button>
              )}
            </div>
          )}
          {total !== null && allocated > 0 && Math.abs(allocated - total) > 0.004 && (
            <p className="text-center text-xs text-muted">
              {allocated < total
                ? `${money(total - allocated, true)} not given to a category yet`
                : `Categories add up to ${money(allocated - total, true)} more than the total`}
            </p>
          )}
        </div>

        <div className="min-w-0 flex-1">
          {ringCats.length === 0 && uncategorized === 0 ? (
            <p className="py-6 text-center text-sm text-muted">
              Nothing spent yet this month. Import a CSV from your bank or card to fill this in.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {ringCats.map((c) => (
                <CategoryRing
                  key={c.id}
                  label={c.name}
                  color={hueHex(c.color)}
                  spent={spentBy.get(c.id) ?? 0}
                  budget={allocations[c.id] ?? null}
                  active={filter.kind === "category" && filter.id === c.id}
                  onClick={() => toggleCategory(c.id)}
                />
              ))}
              {uncategorized !== 0 && (
                <CategoryRing
                  label="Uncategorized"
                  color={UNCAT_COLOR}
                  spent={uncategorized}
                  budget={null}
                  active={filter.kind === "category" && filter.id === null}
                  onClick={() => toggleCategory(null)}
                />
              )}
            </div>
          )}
        </div>
      </section>

      <TransactionList
        today={props.today}
        month={month}
        categories={categories}
        transactions={transactions}
        setTransactions={setTransactions}
        filter={filter}
        setFilter={setFilter}
        spent={spent}
        save={save}
        aiEnabled={props.aiEnabled}
        onError={setError}
      />

      {importing && (
        <ImportCsv
          aiEnabled={props.aiEnabled}
          onClose={() => setImporting(false)}
          onDone={(firstMonth) => {
            setImporting(false);
            router.refresh();
            if (firstMonth && firstMonth !== month) router.push(`/budget?m=${firstMonth}`);
          }}
        />
      )}
    </div>
  );
}
