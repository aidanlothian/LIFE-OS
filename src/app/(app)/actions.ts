"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getAppDay } from "@/lib/appDay";
import { invalidateCalendarCache } from "@/lib/googleCalendar";
import { recurringTaskSortOrder } from "@/lib/recurring";

const DEFAULT_TEMPLATES: { title: string; section: "schedule" | "todo"; sort_order: number }[] = [
  { title: "Catch up on texts", section: "todo", sort_order: 1 },
  { title: "Eat Breakfast", section: "todo", sort_order: 2 },
  { title: "Eat Lunch", section: "todo", sort_order: 3 },
  { title: "Eat Dinner", section: "todo", sort_order: 4 },
];

export async function signOut() {
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

// Seeds the starter recurring templates exactly once per account, tracked by
// user_state.recurring_defaults_seeded. This used to upsert on *every* page
// load, which only prevents duplicates — it still re-creates any starter you
// deleted (so "Delete" appeared to do nothing) and makes a fresh copy of any
// you renamed. If the flag can't be read (e.g. the column doesn't exist yet),
// it does nothing: skipping a seed is harmless, resurrecting a deleted
// template is not.
export async function ensureDefaultTemplates(userId: string) {
  const supabase = createClient();

  const { data: state, error } = await supabase
    .from("user_state")
    .select("recurring_defaults_seeded")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("ensureDefaultTemplates: couldn't read seeded flag, skipping:", error);
    return;
  }
  if (state?.recurring_defaults_seeded) return;

  const { error: seedError } = await supabase.from("recurring_templates").upsert(
    DEFAULT_TEMPLATES.map((t) => ({ ...t, user_id: userId })),
    { onConflict: "user_id,title,section", ignoreDuplicates: true }
  );
  if (seedError) {
    console.error("ensureDefaultTemplates: seeding failed:", seedError);
    return;
  }

  await supabase.from("user_state").upsert(
    { user_id: userId, recurring_defaults_seeded: true, updated_at: new Date().toISOString() },
    { onConflict: "user_id" }
  );
}

// Whether a template's recurrence rule matches this app-day. "daily" always
// does (the default, and the behavior every template had before recurrence
// rules existed); "weekly" checks the day of week is in days_of_week;
// "yearly" checks the month/day match exactly (year is ignored).
function matchesRecurrence(
  template: {
    recurrence_type: string;
    days_of_week: number[] | null;
    yearly_month: number | null;
    yearly_day: number | null;
  },
  dateStr: string
): boolean {
  if (template.recurrence_type === "daily") return true;

  const [y, m, d] = dateStr.split("-").map(Number);
  if (template.recurrence_type === "weekly") {
    const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sunday
    return (template.days_of_week ?? []).includes(dayOfWeek);
  }
  if (template.recurrence_type === "yearly") {
    return template.yearly_month === m && template.yearly_day === d;
  }
  return false;
}

// Upserts today's instance of every active recurring template that matches
// today, for this user. Safe to call more than once in the same day —
// duplicates are silently skipped via the unique (template_id, due_date)
// index. Exported so recurringActions.ts can call it directly after
// add/update, so a newly (or just-)recurring-today template shows up right
// away instead of waiting for newDay()'s once-per-day gate below to reset
// tomorrow.
export async function spawnDueRecurringTasks(
  supabase: ReturnType<typeof createClient>,
  userId: string
) {
  const { data: templates } = await supabase
    .from("recurring_templates")
    .select("id, title, section, sort_order, recurrence_type, days_of_week, yearly_month, yearly_day")
    .eq("user_id", userId)
    .eq("active", true);

  const today = getAppDay();
  const dueTemplates = (templates ?? []).filter((t) => matchesRecurrence(t, today));

  if (dueTemplates.length > 0) {
    await supabase
      .from("tasks")
      .upsert(
        dueTemplates.map((t) => ({
          user_id: userId,
          template_id: t.id,
          title: t.title,
          section: t.section,
          due_date: today,
          sort_order: recurringTaskSortOrder(t.sort_order),
        })),
        { onConflict: "template_id,due_date", ignoreDuplicates: true }
      );
  }
}

// Called unconditionally on every homepage load (independent of the New
// Day wizard). Gated to run its actual spawn at most once per app-day via
// user_state.last_recurring_spawn — without this gate, deleting a
// recurring task's instance for today would just have the very next page
// load (e.g. right after the delete's own revalidate/refresh) silently
// recreate it, since its template is still active and there'd be nothing
// left to conflict with.
export async function newDay() {
  const supabase = createClient();
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const today = getAppDay();

  const { data: state } = await supabase
    .from("user_state")
    .select("last_recurring_spawn")
    .eq("user_id", user.id)
    .maybeSingle();
  if (state?.last_recurring_spawn === today) {
    revalidatePath("/");
    return;
  }

  await spawnDueRecurringTasks(supabase, user.id);

  await supabase.from("user_state").upsert(
    { user_id: user.id, last_recurring_spawn: today, updated_at: new Date().toISOString() },
    { onConflict: "user_id" }
  );

  revalidatePath("/");
}

// Changes a task's due date — used by the New Day wizard's overdue-task
// step, the clickable dates in the to-do lists, and the calendar's task
// popup.
//
// Subtasks always share their parent's due_date (that's how the checklist
// finds them — see addSubtask), so they move with it; otherwise they'd be
// left behind on the old day, no longer under any visible parent. The moved
// task is appended to the end of the new day's list rather than keeping a
// sort_order that only meant something on its old day.
export async function rescheduleTask(taskId: string, newDueDate: string) {
  const supabase = createClient();

  const [{ data: last }] = await Promise.all([
    supabase
      .from("tasks")
      .select("sort_order")
      .eq("due_date", newDueDate)
      .is("parent_task_id", null)
      .order("sort_order", { ascending: false })
      .limit(1),
    supabase.from("tasks").update({ due_date: newDueDate }).eq("parent_task_id", taskId),
  ]);

  await supabase
    .from("tasks")
    .update({ due_date: newDueDate, sort_order: (last?.[0]?.sort_order ?? 0) + 1 })
    .eq("id", taskId);

  revalidatePath("/");
  revalidatePath("/todo");
}

// Removes a task's due date, turning it back into an evergreen task.
// Subtasks follow (same reasoning as rescheduleTask), and the "3 Things"
// star is dropped: that's a per-day pick, so a starred task with no day
// would otherwise resurface as a stray star if it were ever given a date.
export async function clearTaskDueDate(taskId: string) {
  const supabase = createClient();
  await Promise.all([
    supabase.from("tasks").update({ due_date: null, is_mit: false }).eq("id", taskId),
    supabase.from("tasks").update({ due_date: null }).eq("parent_task_id", taskId),
  ]);
  revalidatePath("/");
  revalidatePath("/todo");
}

// Drag-and-drop reorder within a day's to-do list — same approach as
// reorderHabit in habits/actions.ts: pulls taskId out of its current
// position among that day's top-level to-dos and reinserts it at
// targetIndex, then re-sequences sort_order for the whole list.
// Saves a dragged list's new order. `orderedIds` is the list exactly as
// shown, which may be a subset of the day's tasks (/todo hides recurring
// ones), so the hidden tasks keep their slots and only the shown ones are
// rearranged among the shown positions. Only rows whose position changed
// are written.
export async function reorderTasks(orderedIds: string[]) {
  if (orderedIds.length === 0) return;
  const supabase = createClient();

  const { data: first, error: firstError } = await supabase
    .from("tasks")
    .select("user_id, section, due_date")
    .eq("id", orderedIds[0])
    .single();
  if (firstError || !first) {
    console.error("reorderTasks: couldn't read task:", firstError);
    return;
  }

  let siblingsQuery = supabase
    .from("tasks")
    .select("id, sort_order")
    .eq("user_id", first.user_id)
    .eq("section", first.section)
    .is("parent_task_id", null);
  siblingsQuery = first.due_date
    ? siblingsQuery.eq("due_date", first.due_date)
    : siblingsQuery.is("due_date", null);
  const { data: siblings, error: siblingsError } = await siblingsQuery
    .order("sort_order", { ascending: true })
    // Same tie-breaker the pages use to display the list.
    .order("created_at", { ascending: true });
  if (siblingsError || !siblings) {
    console.error("reorderTasks: couldn't read the day's tasks:", siblingsError);
    return;
  }

  const shown = new Set(orderedIds);
  const queue = orderedIds.filter((id) => siblings.some((t) => t.id === id));
  const finalIds = siblings.map((t) => (shown.has(t.id) ? queue.shift()! : (t.id as string)));
  const current = new Map(siblings.map((t) => [t.id as string, t.sort_order as number]));

  const results = await Promise.all(
    finalIds
      .map((id, i) => ({ id, i }))
      .filter(({ id, i }) => current.get(id) !== i)
      .map(({ id, i }) => supabase.from("tasks").update({ sort_order: i }).eq("id", id))
  );
  for (const { error } of results) if (error) console.error("reorderTasks: save failed:", error);

  revalidatePath("/");
  revalidatePath("/todo");
}

// Marks the New Day wizard's morning review as completed for the current
// app-day, so it won't auto-open again until the next one. Deliberately
// does NOT spawn recurring tasks itself — that happens unconditionally on
// every page load (see page.tsx), independent of whether the wizard is
// ever opened or finished.
export async function completeNewDay() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await supabase.from("user_state").upsert(
    { user_id: user.id, last_new_day: getAppDay(), updated_at: new Date().toISOString() },
    { onConflict: "user_id" }
  );

  revalidatePath("/");
}

export async function addTask(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const title = String(formData.get("title") || "").trim();
  if (!title) return;

  const section = String(formData.get("section") || "todo") as "schedule" | "todo";
  const dueDateRaw = String(formData.get("due_date") || "");
  const projectIdRaw = String(formData.get("project_id") || "");
  const notesRaw = String(formData.get("notes") || "").trim();

  // New tasks land at the end of that day's drag-reorderable list.
  const { data: siblings } = await supabase
    .from("tasks")
    .select("sort_order")
    .eq("user_id", user.id)
    .eq("section", section)
    .eq("due_date", dueDateRaw || "");
  const sortOrder =
    siblings && siblings.length > 0
      ? Math.max(...siblings.map((t) => t.sort_order as number)) + 1
      : 0;

  await supabase.from("tasks").insert({
    user_id: user.id,
    title,
    section,
    due_date: dueDateRaw || null,
    project_id: projectIdRaw || null,
    notes: notesRaw || null,
    sort_order: sortOrder,
  });

  revalidatePath("/");
  // Project Center cards and Associated To-Dos widgets list tagged tasks.
  if (projectIdRaw) revalidatePath("/projects", "layout");
}

// A subtask is just a regular task row pointing back at its parent —
// inherits the parent's section/due_date so it shows up alongside it on
// the same checklist, and is never itself eligible for "3 Things" (that's
// a top-level-only concept).
export async function addSubtask(parentTaskId: string, formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const title = String(formData.get("title") || "").trim();
  if (!title) return;

  const { data: parent } = await supabase
    .from("tasks")
    .select("section, due_date, project_id")
    .eq("id", parentTaskId)
    .single();
  if (!parent) return;

  await supabase.from("tasks").insert({
    user_id: user.id,
    title,
    section: parent.section,
    due_date: parent.due_date,
    project_id: parent.project_id,
    parent_task_id: parentTaskId,
  });

  revalidatePath("/");
}

export async function toggleDone(taskId: string, nextDone: boolean) {
  const supabase = createClient();
  await supabase
    .from("tasks")
    .update({
      is_done: nextDone,
      completed_at: nextDone ? new Date().toISOString() : null,
    })
    .eq("id", taskId);

  revalidatePath("/");
}

// Enforces the hard cap of 3 "3 Things" per day server-side, no matter
// what the client sends.
export async function toggleMit(taskId: string, nextMit: boolean, dueDate: string | null) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (nextMit && dueDate) {
    const { count } = await supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("due_date", dueDate)
      .eq("is_mit", true);

    if (count && count >= 3) {
      redirect("/?error=" + encodeURIComponent("You already have 3 things picked for that day — uncheck one first."));
    }
  }

  await supabase.from("tasks").update({ is_mit: nextMit }).eq("id", taskId);
  revalidatePath("/");
}

// Commits the items a user confirmed on the journal-photo review screen.
// Nothing from the photo itself reaches the database — only the edited
// text the user approved. Targets become "3 Things" (is_mit), capped at 3
// combined with whatever's already picked for that day, same as toggleMit;
// todos are plain tasks.
export async function saveJournalItems(
  targets: string[],
  todos: string[],
  dueDate: string
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { count: existingMitCount } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("due_date", dueDate)
    .eq("is_mit", true);

  const mitSlotsLeft = Math.max(0, 3 - (existingMitCount ?? 0));
  const cleanTargets = targets.map((t) => t.trim()).filter(Boolean).slice(0, mitSlotsLeft);
  const cleanTodos = todos.map((t) => t.trim()).filter(Boolean);

  const rows = [
    ...cleanTargets.map((title) => ({
      user_id: user.id,
      title,
      section: "todo" as const,
      due_date: dueDate,
      is_mit: true,
    })),
    ...cleanTodos.map((title) => ({
      user_id: user.id,
      title,
      section: "todo" as const,
      due_date: dueDate,
      is_mit: false,
    })),
  ];

  if (rows.length > 0) {
    await supabase.from("tasks").insert(rows);
  }

  revalidatePath("/");
}

export async function deleteTask(taskId: string) {
  const supabase = createClient();
  await supabase.from("tasks").delete().eq("id", taskId);
  revalidatePath("/");
}

export async function disconnectGoogleCalendar() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await supabase.from("google_calendar_tokens").delete().eq("user_id", user.id);
  invalidateCalendarCache(user.id);
  revalidatePath("/");
}

// Projects for the task editor's dropdown — fetched when the editor opens
// rather than threaded through every page that renders a task row.
export async function listProjectsForPicker(): Promise<{ id: string; name: string }[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("id, name")
    .order("created_at", { ascending: true });
  if (error) console.error("listProjectsForPicker failed:", error);
  return (data ?? []) as { id: string; name: string }[];
}

// Renames a task and/or moves it to a project (projectId null = none).
export async function updateTask(
  taskId: string,
  changes: { title?: string; projectId?: string | null }
) {
  const update: { title?: string; project_id?: string | null } = {};
  if (changes.title !== undefined) {
    const trimmed = changes.title.trim();
    if (!trimmed) return;
    update.title = trimmed;
  }
  if (changes.projectId !== undefined) update.project_id = changes.projectId;
  if (Object.keys(update).length === 0) return;

  const supabase = createClient();
  const { error } = await supabase.from("tasks").update(update).eq("id", taskId);
  if (error) console.error("updateTask failed:", error);
  // Task rows show on Home, /todo and project pages.
  revalidatePath("/", "layout");
}
