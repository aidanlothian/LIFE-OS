import { createClient } from "@/lib/supabase/server";
import { userDateStr } from "@/lib/timezone";
import {
  MONTH_RE,
  monthStart,
  nextMonth,
  prevMonth,
  type BudgetCategory,
  type BudgetTransaction,
} from "@/lib/budget";
import { aiConfigured } from "@/lib/budgetAi";
import BudgetView from "./BudgetView";

export const metadata = { title: "Budget" };

// Sorting with Claude can take a while on a big first import.
export const maxDuration = 60;

export default async function BudgetPage({ searchParams }: { searchParams: { m?: string } }) {
  const thisMonth = userDateStr().slice(0, 7);
  const month = searchParams.m && MONTH_RE.test(searchParams.m) ? searchParams.m : thisMonth;
  const start = monthStart(month);
  const end = monthStart(nextMonth(month));

  const supabase = createClient();
  const [cats, monthRow, allocs, txns, prevRow] = await Promise.all([
    supabase.from("budget_categories").select("id, name, color, sort_order").order("sort_order"),
    supabase.from("budget_months").select("total").eq("month", start).maybeSingle(),
    supabase.from("budget_allocations").select("category_id, amount").eq("month", start),
    supabase
      .from("budget_transactions")
      .select("id, date, description, amount, category_id, account, excluded, auto_categorized, reimbursed, budget_splits(id, category_id, amount)")
      .gte("date", start)
      .lt("date", end)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase.from("budget_months").select("month").eq("month", monthStart(prevMonth(month))).maybeSingle(),
  ]);
  const errors = [cats.error, monthRow.error, allocs.error, txns.error, prevRow.error].filter(Boolean);
  for (const e of errors) console.error("Budget page load failed:", e);

  const transactions: BudgetTransaction[] = (txns.data ?? []).map((t) => ({
    id: t.id as string,
    date: t.date as string,
    description: t.description as string,
    amount: Number(t.amount),
    category_id: (t.category_id as string | null) ?? null,
    account: (t.account as string | null) ?? null,
    excluded: Boolean(t.excluded),
    auto: Boolean(t.auto_categorized),
    reimbursed: Number(t.reimbursed ?? 0),
    splits: ((t.budget_splits as { id: string; category_id: string | null; amount: number }[] | null) ?? []).map(
      (s) => ({ id: s.id, category_id: s.category_id, amount: Number(s.amount) })
    ),
  }));
  const allocations: Record<string, number> = {};
  for (const a of allocs.data ?? []) allocations[a.category_id as string] = Number(a.amount);

  return (
    <BudgetView
      key={month}
      month={month}
      thisMonth={thisMonth}
      today={userDateStr()}
      categories={(cats.data ?? []) as BudgetCategory[]}
      total={monthRow.data ? Number(monthRow.data.total) : null}
      allocations={allocations}
      transactions={transactions}
      prevHasBudget={Boolean(prevRow.data)}
      loadError={errors.length > 0}
      aiEnabled={aiConfigured()}
    />
  );
}
