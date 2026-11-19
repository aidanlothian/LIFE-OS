"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const DEFAULT_HABITS: {
  title: string;
  category: string;
  category_order: number;
  sort_order: number;
}[] = [
  { title: "7+ hours of sleep", category: "Health", category_order: 1, sort_order: 1 },
  { title: "Drink water", category: "Health", category_order: 1, sort_order: 2 },
  { title: "Physical activity", category: "Health", category_order: 1, sort_order: 3 },
  { title: "Stretch", category: "Health", category_order: 1, sort_order: 4 },
  { title: "Make bed", category: "Organized", category_order: 2, sort_order: 1 },
  { title: "Catch up on texts", category: "Organized", category_order: 2, sort_order: 2 },
  { title: "Morning planner", category: "Organized", category_order: 2, sort_order: 3 },
  { title: "Check calendar", category: "Organized", category_order: 2, sort_order: 4 },
  { title: "Clear inbox", category: "Organized", category_order: 2, sort_order: 5 },
  { title: "1+ hour focused work time", category: "Focused", category_order: 3, sort_order: 1 },
  { title: "<1 hour on social media", category: "Focused", category_order: 3, sort_order: 2 },
  { title: "Read one news article", category: "Focused", category_order: 3, sort_order: 3 },
  { title: "Finish my 3 things", category: "Focused", category_order: 3, sort_order: 4 },
];

async function requireUser() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

// Seeds the fixed habit list the first time this user's habit tracker
// loads, and never again after that. The "any habits exist at all" check
// matters, not just per-(title,category): once a default habit is dragged
// into a different section, its (title, category) pair no longer matches
// what's in DEFAULT_HABITS, so a per-title upsert alone would treat that as
// "missing" and quietly re-insert a fresh copy back into its original
// section on every subsequent page load — undoing every category move.
// The upsert is still there as a race-safe fallback for two concurrent
// first-ever page loads landing on an empty habits table at the same time.
export async function ensureDefaultHabits(userId: string) {
  const supabase = createClient();
  const { count } = await supabase
    .from("habits")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (count && count > 0) return;

  await supabase.from("habits").upsert(
    DEFAULT_HABITS.map((h) => ({ ...h, user_id: userId })),
    { onConflict: "user_id,title,category", ignoreDuplicates: true }
  );
}

async function nextCategoryOrder(supabase: ReturnType<typeof createClient>) {
  const { data } = await supabase.from("habits").select("category_order");
  const max = (data ?? []).reduce((m, h) => Math.max(m, h.category_order as number), 0);
  return max + 1;
}

// Looks up the category_order an existing category already uses, or hands
// out a fresh one at the end of the list for a brand-new category name.
async function categoryOrderFor(supabase: ReturnType<typeof createClient>, category: string) {
  const { data } = await supabase
    .from("habits")
    .select("category_order")
    .eq("category", category)
    .limit(1);

  if (data && data.length > 0) return data[0].category_order as number;
  return nextCategoryOrder(supabase);
}

export async function addHabit(formData: FormData) {
  const { supabase, user } = await requireUser();

  const title = String(formData.get("title") || "").trim();
  if (!title) return;
  const category = String(formData.get("category") || "").trim() || "General";

  const { data: siblings } = await supabase
    .from("habits")
    .select("sort_order")
    .eq("category", category);

  const categoryOrder = await categoryOrderFor(supabase, category);
  const sortOrder =
    siblings && siblings.length > 0
      ? Math.max(...siblings.map((h) => h.sort_order as number)) + 1
      : 1;

  // Upsert (ignoring the conflict) rather than a plain insert: guards
  // against creating a duplicate row if the form gets submitted twice
  // (double-click, slow network causing a resubmit).
  await supabase.from("habits").upsert(
    {
      user_id: user.id,
      title,
      category,
      category_order: categoryOrder,
      sort_order: sortOrder,
    },
    { onConflict: "user_id,title,category", ignoreDuplicates: true }
  );

  revalidatePath("/habits");
  revalidatePath("/");
}

export async function updateHabit(habitId: string, formData: FormData) {
  const { supabase } = await requireUser();

  const title = String(formData.get("title") || "").trim();
  if (!title) return;
  const category = String(formData.get("category") || "").trim() || "General";
  const categoryOrder = await categoryOrderFor(supabase, category);

  await supabase
    .from("habits")
    .update({ title, category, category_order: categoryOrder })
    .eq("id", habitId);

  revalidatePath("/habits");
  revalidatePath("/");
}

export async function deleteHabit(habitId: string) {
  const { supabase } = await requireUser();
  await supabase.from("habits").delete().eq("id", habitId);
  revalidatePath("/habits");
  revalidatePath("/");
}

// Drag-and-drop reorder: pulls habitId out of its category's current order
// and reinserts it at targetIndex, then re-sequences sort_order for the
// whole category. Simpler and more robust than computing swaps/fractional
// positions for an arbitrary drop target. targetCategory may differ from
// the habit's current category — dragging into a different section moves
// it there (and picks up that section's category_order) rather than being
// a no-op.
export async function reorderHabit(habitId: string, targetCategory: string, targetIndex: number) {
  const { supabase } = await requireUser();

  const { data: dragged } = await supabase
    .from("habits")
    .select("category")
    .eq("id", habitId)
    .single();
  if (!dragged) return;

  if (dragged.category !== targetCategory) {
    const categoryOrder = await categoryOrderFor(supabase, targetCategory);
    await supabase
      .from("habits")
      .update({ category: targetCategory, category_order: categoryOrder })
      .eq("id", habitId);
  }

  const { data: siblings } = await supabase
    .from("habits")
    .select("id")
    .eq("category", targetCategory)
    .order("sort_order", { ascending: true });

  if (!siblings) return;
  const ids = siblings.map((h) => h.id as string);
  const fromIndex = ids.indexOf(habitId);
  if (fromIndex !== -1) ids.splice(fromIndex, 1);
  const clampedTarget = Math.max(0, Math.min(targetIndex, ids.length));
  ids.splice(clampedTarget, 0, habitId);

  await Promise.all(
    ids.map((id, i) => supabase.from("habits").update({ sort_order: i + 1 }).eq("id", id))
  );

  revalidatePath("/habits");
  revalidatePath("/");
}

export async function renameCategory(oldName: string, formData: FormData) {
  const { supabase } = await requireUser();
  const newName = String(formData.get("name") || "").trim();
  if (!newName || newName === oldName) return;

  await supabase.from("habits").update({ category: newName }).eq("category", oldName);
  revalidatePath("/habits");
  revalidatePath("/");
}

// Deletes the category's habits along with it (and their logs, via cascade).
export async function deleteCategory(name: string) {
  const { supabase } = await requireUser();
  await supabase.from("habits").delete().eq("category", name);
  revalidatePath("/habits");
  revalidatePath("/");
}

// Swaps category_order with the adjacent category, moving every habit in
// both categories together as a block.
export async function moveCategory(name: string, direction: "up" | "down") {
  const { supabase } = await requireUser();
  const { data } = await supabase.from("habits").select("category, category_order");
  if (!data) return;

  const categories = Array.from(
    new Map(data.map((h) => [h.category as string, h.category_order as number])).entries()
  ).sort((a, b) => a[1] - b[1]);

  const idx = categories.findIndex(([c]) => c === name);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (idx === -1 || swapIdx < 0 || swapIdx >= categories.length) return;

  const [nameA, orderA] = categories[idx];
  const [nameB, orderB] = categories[swapIdx];

  await supabase.from("habits").update({ category_order: orderB }).eq("category", nameA);
  await supabase.from("habits").update({ category_order: orderA }).eq("category", nameB);

  revalidatePath("/habits");
}

// Presence-only toggle: checking a day inserts a log row, unchecking deletes
// it. ignoreDuplicates guards against a double-click race on the insert path.
export async function toggleHabitLog(habitId: string, logDate: string, nextChecked: boolean) {
  const { supabase, user } = await requireUser();

  if (nextChecked) {
    await supabase.from("habit_logs").upsert(
      { user_id: user.id, habit_id: habitId, log_date: logDate },
      { onConflict: "habit_id,log_date", ignoreDuplicates: true }
    );
  } else {
    await supabase
      .from("habit_logs")
      .delete()
      .eq("habit_id", habitId)
      .eq("log_date", logDate);
  }

  revalidatePath("/habits");
  revalidatePath("/");
}

// Presence-only toggle, same idiom as toggleHabitLog above: a row means
// that whole day is excluded from every habit's stats, across all habits.
export async function toggleExcludedDay(dateStr: string, nextExcluded: boolean) {
  const { supabase, user } = await requireUser();

  if (nextExcluded) {
    await supabase.from("habit_excluded_days").upsert(
      { user_id: user.id, excluded_date: dateStr },
      { onConflict: "user_id,excluded_date", ignoreDuplicates: true }
    );
  } else {
    await supabase.from("habit_excluded_days").delete().eq("excluded_date", dateStr);
  }

  revalidatePath("/habits");
  revalidatePath("/");
}
