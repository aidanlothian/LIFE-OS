"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  MONTH_RE,
  STARTER_CATEGORIES,
  looksLikeTransfer,
  merchantKey,
  monthStart,
  round2,
  type BudgetCategory,
} from "@/lib/budget";
import { HUES } from "@/lib/memoryColors";
import { aiConfigured, sortMerchants } from "@/lib/budgetAi";

// Budget page server actions. Every one returns whether it worked (or the
// new row), so the page can update instantly and show a "couldn't save"
// note when the database says no.

async function requireUser() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HUE_KEYS: string[] = HUES.map((h) => h.key);
const MAX_AMOUNT = 10_000_000;

const done = () => revalidatePath("/budget");

function validAmount(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= MAX_AMOUNT;
}

// ---- Categories ----------------------------------------------------------

export async function addStarterCategories(): Promise<boolean> {
  const { supabase, user } = await requireUser();
  const { data: existing, error: readError } = await supabase.from("budget_categories").select("name");
  if (readError) {
    console.error("addStarterCategories read failed:", readError);
    return false;
  }
  const have = new Set((existing ?? []).map((c) => (c.name as string).toLowerCase()));
  const rows = STARTER_CATEGORIES.filter((c) => !have.has(c.name.toLowerCase())).map((c, i) => ({
    user_id: user.id,
    name: c.name,
    color: c.color,
    sort_order: (existing?.length ?? 0) + i,
  }));
  if (rows.length === 0) return true;
  const { error } = await supabase.from("budget_categories").insert(rows);
  if (error) console.error("addStarterCategories failed:", error);
  done();
  return !error;
}

export async function createCategory(name: string, color: string): Promise<BudgetCategory | null> {
  const { supabase, user } = await requireUser();
  const clean = name.trim().slice(0, 60);
  if (!clean || !HUE_KEYS.includes(color)) return null;
  const { data: last } = await supabase
    .from("budget_categories")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data, error } = await supabase
    .from("budget_categories")
    .insert({ user_id: user.id, name: clean, color, sort_order: ((last?.sort_order as number) ?? -1) + 1 })
    .select("id, name, color, sort_order")
    .single();
  if (error) console.error("createCategory failed:", error);
  done();
  return (data as BudgetCategory) ?? null;
}

export async function updateCategory(id: string, patch: { name?: string; color?: string }): Promise<boolean> {
  const { supabase } = await requireUser();
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim().slice(0, 60);
    if (!name) return false;
    update.name = name;
  }
  if (patch.color !== undefined) {
    if (!HUE_KEYS.includes(patch.color)) return false;
    update.color = patch.color;
  }
  if (Object.keys(update).length === 0) return true;
  const { error } = await supabase.from("budget_categories").update(update).eq("id", id);
  if (error) console.error("updateCategory failed:", error);
  done();
  return !error;
}

// Its transactions become uncategorized; its budget amounts and rules go.
export async function deleteCategory(id: string): Promise<boolean> {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("budget_categories").delete().eq("id", id);
  if (error) console.error("deleteCategory failed:", error);
  done();
  return !error;
}

// ---- Monthly budget ------------------------------------------------------

export async function setMonthTotal(month: string, total: number): Promise<boolean> {
  const { supabase, user } = await requireUser();
  if (!MONTH_RE.test(month) || !validAmount(total) || total < 0) return false;
  const { error } = await supabase
    .from("budget_months")
    .upsert({ user_id: user.id, month: monthStart(month), total: round2(total) }, { onConflict: "user_id,month" });
  if (error) console.error("setMonthTotal failed:", error);
  done();
  return !error;
}

export async function setAllocation(month: string, categoryId: string, amount: number): Promise<boolean> {
  const { supabase, user } = await requireUser();
  if (!MONTH_RE.test(month) || !validAmount(amount) || amount < 0) return false;
  const { error } = await supabase.from("budget_allocations").upsert(
    { user_id: user.id, month: monthStart(month), category_id: categoryId, amount: round2(amount) },
    { onConflict: "user_id,month,category_id" }
  );
  if (error) console.error("setAllocation failed:", error);
  done();
  return !error;
}

// Starts a month from another month's budget (total + every category).
export async function copyBudget(toMonth: string, fromMonth: string): Promise<boolean> {
  const { supabase, user } = await requireUser();
  if (!MONTH_RE.test(toMonth) || !MONTH_RE.test(fromMonth)) return false;
  const [{ data: m, error: e1 }, { data: allocs, error: e2 }] = await Promise.all([
    supabase.from("budget_months").select("total").eq("month", monthStart(fromMonth)).maybeSingle(),
    supabase.from("budget_allocations").select("category_id, amount").eq("month", monthStart(fromMonth)),
  ]);
  if (e1 || e2 || !m) {
    console.error("copyBudget read failed:", e1 ?? e2);
    return false;
  }
  const { error: e3 } = await supabase
    .from("budget_months")
    .upsert({ user_id: user.id, month: monthStart(toMonth), total: m.total }, { onConflict: "user_id,month" });
  let e4 = null;
  if ((allocs ?? []).length > 0) {
    ({ error: e4 } = await supabase.from("budget_allocations").upsert(
      (allocs ?? []).map((a) => ({
        user_id: user.id,
        month: monthStart(toMonth),
        category_id: a.category_id,
        amount: a.amount,
      })),
      { onConflict: "user_id,month,category_id" }
    ));
  }
  if (e3 || e4) console.error("copyBudget failed:", e3 ?? e4);
  done();
  return !e3 && !e4;
}

// ---- Transactions --------------------------------------------------------

export interface ImportPayloadRow {
  date: string;
  description: string;
  amount: number;
  occ: number; // how many identical rows came before this one in the file
}

// Imports one chunk of a CSV. Rows already imported (same hash) are
// skipped. Learned rules set categories; card payments and transfers come
// in excluded, so they're visible but don't count as spending.
export async function importTransactions(
  rows: ImportPayloadRow[],
  account: string
): Promise<{ ok: boolean; inserted: number; duplicates: number }> {
  const { supabase, user } = await requireUser();
  const fail = { ok: false, inserted: 0, duplicates: 0 };
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 1000) return fail;
  const acct = account.trim().slice(0, 60) || null;

  const { data: rules, error: rulesError } = await supabase
    .from("budget_rules")
    .select("merchant_key, category_id, exclude, source");
  if (rulesError) {
    console.error("importTransactions rules read failed:", rulesError);
    return fail;
  }
  const ruleFor = new Map((rules ?? []).map((r) => [r.merchant_key as string, r]));

  const insert = [];
  for (const r of rows) {
    if (!DATE_RE.test(r.date) || !validAmount(r.amount) || typeof r.description !== "string") continue;
    const description = r.description.trim().slice(0, 300);
    if (!description) continue;
    const amount = round2(r.amount);
    const rule = ruleFor.get(merchantKey(description));
    insert.push({
      user_id: user.id,
      date: r.date,
      description,
      amount,
      account: acct,
      category_id: (rule?.category_id as string | null) ?? null,
      excluded: rule ? Boolean(rule.exclude) : looksLikeTransfer(description, amount),
      auto_categorized: Boolean(rule?.category_id) && rule?.source === "ai",
      import_hash: `${r.date}|${amount.toFixed(2)}|${description.toLowerCase()}|${Math.max(0, Math.floor(r.occ))}`,
    });
  }
  if (insert.length === 0) return { ok: true, inserted: 0, duplicates: 0 };

  const { data, error } = await supabase
    .from("budget_transactions")
    .upsert(insert, { onConflict: "user_id,import_hash", ignoreDuplicates: true })
    .select("id");
  if (error) {
    console.error("importTransactions failed:", error);
    return fail;
  }
  done();
  const inserted = data?.length ?? 0;
  return { ok: true, inserted, duplicates: insert.length - inserted };
}

export async function addTransaction(input: {
  date: string;
  description: string;
  amount: number;
  categoryId: string | null;
}): Promise<string | null> {
  const { supabase, user } = await requireUser();
  const description = input.description.trim().slice(0, 300);
  if (!DATE_RE.test(input.date) || !description || !validAmount(input.amount) || input.amount === 0) return null;
  const { data, error } = await supabase
    .from("budget_transactions")
    .insert({
      user_id: user.id,
      date: input.date,
      description,
      amount: round2(input.amount),
      category_id: input.categoryId,
      account: "Added by hand",
    })
    .select("id")
    .single();
  if (error) console.error("addTransaction failed:", error);
  done();
  return (data?.id as string) ?? null;
}

// Sets one transaction's category and remembers it for that merchant:
// other uncategorized transactions from the same merchant get it too, and
// so do future imports. Returns the ids that changed.
export async function setTransactionCategory(id: string, categoryId: string | null): Promise<string[] | null> {
  const { supabase, user } = await requireUser();
  const { data: t, error: readError } = await supabase
    .from("budget_transactions")
    .select("description")
    .eq("id", id)
    .maybeSingle();
  if (readError || !t) {
    console.error("setTransactionCategory read failed:", readError);
    return null;
  }
  const { error } = await supabase
    .from("budget_transactions")
    .update({ category_id: categoryId, auto_categorized: false })
    .eq("id", id);
  if (error) {
    console.error("setTransactionCategory failed:", error);
    return null;
  }
  const changed = [id];
  if (categoryId) {
    const key = merchantKey(t.description as string);
    const { error: ruleError } = await supabase.from("budget_rules").upsert(
      {
        user_id: user.id,
        merchant_key: key,
        category_id: categoryId,
        exclude: false,
        source: "you",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,merchant_key" }
    );
    if (ruleError) console.error("setTransactionCategory rule failed:", ruleError);
    const { data: others } = await supabase
      .from("budget_transactions")
      .select("id, description")
      .is("category_id", null)
      .eq("excluded", false);
    const matching = (others ?? [])
      .filter((o) => o.id !== id && merchantKey(o.description as string) === key)
      .map((o) => o.id as string);
    if (matching.length > 0) {
      const { error: bulkError } = await supabase
        .from("budget_transactions")
        .update({ category_id: categoryId })
        .in("id", matching);
      if (bulkError) console.error("setTransactionCategory bulk failed:", bulkError);
      else changed.push(...matching);
    }
  }
  done();
  return changed;
}

export async function setTransactionExcluded(id: string, excluded: boolean): Promise<boolean> {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("budget_transactions").update({ excluded }).eq("id", id);
  if (error) console.error("setTransactionExcluded failed:", error);
  done();
  return !error;
}

// Replaces a transaction's split. The parts must add up to its amount;
// an empty list removes the split.
export async function setSplits(
  id: string,
  parts: { category_id: string | null; amount: number }[]
): Promise<boolean> {
  const { supabase, user } = await requireUser();
  const { data: t, error: readError } = await supabase
    .from("budget_transactions")
    .select("amount, reimbursed")
    .eq("id", id)
    .maybeSingle();
  if (readError || !t) return false;
  if (parts.length > 0) {
    if (parts.length < 2 || parts.length > 20 || !parts.every((p) => validAmount(p.amount))) return false;
    const sum = round2(parts.reduce((s, p) => s + p.amount, 0));
    if (Math.abs(sum - (Number(t.amount) - Number(t.reimbursed ?? 0))) > 0.004) return false;
  }
  const { error: delError } = await supabase.from("budget_splits").delete().eq("transaction_id", id);
  if (delError) {
    console.error("setSplits delete failed:", delError);
    return false;
  }
  if (parts.length > 0) {
    const { error } = await supabase.from("budget_splits").insert(
      parts.map((p) => ({ user_id: user.id, transaction_id: id, category_id: p.category_id, amount: round2(p.amount) }))
    );
    if (error) {
      console.error("setSplits insert failed:", error);
      return false;
    }
  }
  done();
  return true;
}

// Records how much other people paid you back for a charge (0 clears it).
// Any split is removed, since it divided the old amount.
export async function setReimbursed(id: string, reimbursed: number): Promise<boolean> {
  const { supabase } = await requireUser();
  if (!validAmount(reimbursed) || reimbursed < 0) return false;
  const { data: t, error: readError } = await supabase
    .from("budget_transactions")
    .select("amount")
    .eq("id", id)
    .maybeSingle();
  if (readError || !t) return false;
  if (Number(t.amount) <= 0 || reimbursed > Number(t.amount)) return false;
  const { error: delError } = await supabase.from("budget_splits").delete().eq("transaction_id", id);
  if (delError) console.error("setReimbursed split clear failed:", delError);
  const { error } = await supabase
    .from("budget_transactions")
    .update({ reimbursed: round2(reimbursed) })
    .eq("id", id);
  if (error) console.error("setReimbursed failed:", error);
  done();
  return !error;
}

// Deletes many at once (Select mode). Their splits go with them.
export async function deleteTransactions(ids: string[]): Promise<boolean> {
  const { supabase } = await requireUser();
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 5000) return false;
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabase.from("budget_transactions").delete().in("id", ids.slice(i, i + 200));
    if (error) {
      console.error("deleteTransactions failed:", error);
      done();
      return false;
    }
  }
  done();
  return true;
}

export async function deleteTransaction(id: string): Promise<boolean> {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("budget_transactions").delete().eq("id", id);
  if (error) console.error("deleteTransaction failed:", error);
  done();
  return !error;
}

// ---- AI sorting ----------------------------------------------------------

export interface AutoSortResult {
  ok: boolean;
  notConfigured?: boolean;
  sorted: number; // transactions given a category
  unsure: number; // merchants Claude couldn't place
}

// Asks Claude to sort every uncategorized transaction (any month) into
// your categories. Each merchant it places also gets a rule, so future
// imports of that merchant are sorted for free. Your own choices are never
// overwritten: only uncategorized, unsplit, counted rows are touched.
export async function autoCategorize(): Promise<AutoSortResult> {
  const { supabase, user } = await requireUser();
  const none = { ok: false, sorted: 0, unsure: 0 };
  if (!aiConfigured()) return { ...none, notConfigured: true };

  const [{ data: cats, error: e1 }, { data: rows, error: e2 }] = await Promise.all([
    supabase.from("budget_categories").select("id, name"),
    supabase
      .from("budget_transactions")
      .select("id, description, budget_splits(id)")
      .is("category_id", null)
      .eq("excluded", false)
      .order("date", { ascending: false })
      .limit(2000),
  ]);
  if (e1 || e2) {
    console.error("autoCategorize read failed:", e1 ?? e2);
    return none;
  }
  const categories = (cats ?? []) as { id: string; name: string }[];
  if (categories.length === 0) return { ok: true, sorted: 0, unsure: 0 };

  const byKey = new Map<string, { example: string; ids: string[] }>();
  for (const r of rows ?? []) {
    if (((r.budget_splits as unknown[] | null) ?? []).length > 0) continue;
    const key = merchantKey(r.description as string);
    const entry = byKey.get(key) ?? { example: r.description as string, ids: [] };
    entry.ids.push(r.id as string);
    byKey.set(key, entry);
  }
  if (byKey.size === 0) return { ok: true, sorted: 0, unsure: 0 };
  const merchants = [...byKey.entries()].slice(0, 300).map(([key, v]) => ({ key, example: v.example }));

  let answers: Map<string, string | null>;
  try {
    answers = await sortMerchants(
      merchants,
      categories.map((c) => c.name)
    );
  } catch (err) {
    console.error("autoCategorize: Claude request failed:", err);
    return none;
  }

  const idByName = new Map(categories.map((c) => [c.name, c.id]));
  const toCategory = new Map<string, string[]>(); // category id -> transaction ids
  const rules = [];
  let unsure = 0;
  for (const m of merchants) {
    const name = answers.get(m.key);
    const categoryId = name ? idByName.get(name) : undefined;
    if (!categoryId) {
      unsure++;
      continue;
    }
    toCategory.set(categoryId, [...(toCategory.get(categoryId) ?? []), ...byKey.get(m.key)!.ids]);
    rules.push({
      user_id: user.id,
      merchant_key: m.key,
      category_id: categoryId,
      exclude: false,
      source: "ai",
      updated_at: new Date().toISOString(),
    });
  }

  let sorted = 0;
  for (const [categoryId, ids] of toCategory) {
    const { error } = await supabase
      .from("budget_transactions")
      .update({ category_id: categoryId, auto_categorized: true })
      .in("id", ids)
      .is("category_id", null); // never overwrite a choice made meanwhile
    if (error) console.error("autoCategorize update failed:", error);
    else sorted += ids.length;
  }
  if (rules.length > 0) {
    // ignoreDuplicates: a rule you made yourself is never replaced by Claude's.
    const { error } = await supabase
      .from("budget_rules")
      .upsert(rules, { onConflict: "user_id,merchant_key", ignoreDuplicates: true });
    if (error) console.error("autoCategorize rules failed:", error);
  }
  done();
  return { ok: true, sorted, unsure };
}
