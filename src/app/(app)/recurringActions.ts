"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAppDay } from "@/lib/appDay";
import { moveItem, recurringTaskSortOrder } from "@/lib/recurring";
import { spawnDueRecurringTasks } from "./actions";

async function requireUser() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

function parseDaysOfWeek(formData: FormData): number[] {
  return [0, 1, 2, 3, 4, 5, 6].filter((d) => formData.get(`dow_${d}`) === "on");
}

// Shared by add/update: reads title + recurrence fields out of the form,
// validating just enough that a template can never be saved in a
// self-contradictory state (e.g. "weekly" with no days checked).
function parseTemplateForm(formData: FormData) {
  const title = String(formData.get("title") || "").trim();
  if (!title) return null;

  const recurrenceType = String(formData.get("recurrence_type") || "daily");
  if (!["daily", "weekly", "yearly"].includes(recurrenceType)) return null;

  let daysOfWeek: number[] = [];
  let yearlyMonth: number | null = null;
  let yearlyDay: number | null = null;

  if (recurrenceType === "weekly") {
    daysOfWeek = parseDaysOfWeek(formData);
    if (daysOfWeek.length === 0) return null;
  } else if (recurrenceType === "yearly") {
    // The date input's year is meaningless here — only month/day matter.
    const raw = String(formData.get("yearly_date") || "");
    const parts = raw.split("-").map(Number);
    if (parts.length !== 3 || parts.some((p) => Number.isNaN(p))) return null;
    yearlyMonth = parts[1];
    yearlyDay = parts[2];
  }

  return { title, recurrenceType, daysOfWeek, yearlyMonth, yearlyDay };
}

export async function addRecurringTemplate(formData: FormData) {
  const { supabase, user } = await requireUser();
  const parsed = parseTemplateForm(formData);
  if (!parsed) return;

  const { data: siblings } = await supabase
    .from("recurring_templates")
    .select("sort_order")
    .eq("user_id", user.id);
  const order =
    siblings && siblings.length > 0
      ? Math.max(...siblings.map((t) => t.sort_order as number)) + 1
      : 1;

  await supabase.from("recurring_templates").insert({
    user_id: user.id,
    title: parsed.title,
    section: "todo",
    sort_order: order,
    recurrence_type: parsed.recurrenceType,
    days_of_week: parsed.daysOfWeek,
    yearly_month: parsed.yearlyMonth,
    yearly_day: parsed.yearlyDay,
  });

  // Spawns immediately if it matches today, rather than waiting for
  // newDay()'s once-per-day gate to reset tomorrow — this is a deliberate
  // add, not an incidental page load.
  await spawnDueRecurringTasks(supabase, user.id);

  revalidatePath("/");
  revalidatePath("/todo");
}

export async function updateRecurringTemplate(templateId: string, formData: FormData) {
  const { supabase, user } = await requireUser();
  const parsed = parseTemplateForm(formData);
  if (!parsed) return;

  await supabase
    .from("recurring_templates")
    .update({
      title: parsed.title,
      recurrence_type: parsed.recurrenceType,
      days_of_week: parsed.daysOfWeek,
      yearly_month: parsed.yearlyMonth,
      yearly_day: parsed.yearlyDay,
    })
    .eq("id", templateId);

  // Same reasoning as addRecurringTemplate — an edit that makes it match
  // today (e.g. switching from "weekends only" to "daily") should show up
  // right away rather than waiting until tomorrow.
  await spawnDueRecurringTasks(supabase, user.id);

  revalidatePath("/");
  revalidatePath("/todo");
}

// Deletes the template, plus today's (and any later) instance of it that
// hasn't been checked off — otherwise "Eat Lunch" would be gone from the
// recurring list but still sitting on today's checklist, which looks like
// the delete failed. Instances from past days, and ones you've already
// checked off, are left alone as history. Returns whether it worked so the
// UI can say so instead of failing silently.
export async function deleteRecurringTemplate(templateId: string): Promise<boolean> {
  const { supabase } = await requireUser();

  // Instances first: once the template is gone their template_id is nulled
  // out and there'd be no way to tell which tasks they were.
  const { error: tasksError } = await supabase
    .from("tasks")
    .delete()
    .eq("template_id", templateId)
    .gte("due_date", getAppDay())
    .eq("is_done", false);
  if (tasksError) {
    console.error("deleteRecurringTemplate: couldn't remove pending instances:", tasksError);
    return false;
  }

  const { error } = await supabase.from("recurring_templates").delete().eq("id", templateId);
  if (error) {
    console.error("deleteRecurringTemplate failed:", error);
    return false;
  }

  revalidatePath("/");
  revalidatePath("/todo");
  return true;
}

// Moves a template to `targetIndex` in the list and renumbers the rest 1..N.
// Tomorrow's instances spawn in this order (see spawnDueRecurringTasks), and
// today's existing instances are renumbered to match straight away, so the
// change is visible on the checklist immediately rather than only tomorrow.
export async function reorderRecurringTemplate(
  templateId: string,
  targetIndex: number
): Promise<boolean> {
  const { supabase, user } = await requireUser();

  const { data: templates, error } = await supabase
    .from("recurring_templates")
    .select("id")
    .eq("user_id", user.id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error || !templates) {
    console.error("reorderRecurringTemplate: couldn't load templates:", error);
    return false;
  }

  const ids = templates.map((t) => t.id as string);
  const from = ids.indexOf(templateId);
  if (from === -1) return false;
  const reordered = moveItem(ids, from, targetIndex);

  const today = getAppDay();
  const results = await Promise.all(
    reordered.flatMap((id, i) => [
      supabase.from("recurring_templates").update({ sort_order: i + 1 }).eq("id", id),
      supabase
        .from("tasks")
        .update({ sort_order: recurringTaskSortOrder(i + 1) })
        .eq("template_id", id)
        .eq("due_date", today),
    ])
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    console.error("reorderRecurringTemplate failed:", failed.error);
    return false;
  }

  revalidatePath("/");
  revalidatePath("/todo");
  return true;
}

// Pausing (active = false) stops future instances from spawning without
// losing the recurrence configuration, unlike deleting.
export async function toggleRecurringTemplateActive(templateId: string, nextActive: boolean) {
  const { supabase } = await requireUser();
  await supabase.from("recurring_templates").update({ active: nextActive }).eq("id", templateId);
  revalidatePath("/");
  revalidatePath("/todo");
}
