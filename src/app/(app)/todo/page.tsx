import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getAppDay } from "@/lib/appDay";
import { monthGridDays } from "@/lib/todoCalendar";
import AddTaskButton from "../AddTaskButton";
import AddEvergreenTaskButton from "../AddEvergreenTaskButton";
import EditRecurringTasksButton from "../EditRecurringTasksButton";
import TodoList from "../TodoList";
import TaskRow from "../TaskRow";
import TaskCalendar from "./TaskCalendar";
import type { RecurringTemplate, Task } from "@/types";

// Excluding by template_id alone misses any stray instance that predates
// its template link (e.g. one created during a schema hiccup) — matching
// by title too catches those regardless of how the row came to exist.
const RECURRING_TASK_TITLES = ["Catch up on texts", "Eat Breakfast", "Eat Lunch", "Eat Dinner"];
const RECURRING_TITLES_FILTER = `(${RECURRING_TASK_TITLES.map((t) => `"${t}"`).join(",")})`;

export default async function TodoPage({
  searchParams,
}: {
  searchParams: { month?: string };
}) {
  const supabase = createClient();
  const user = await getCurrentUser();
  if (!user) return null; // middleware redirects unauthenticated users

  const today = getAppDay();
  const [todayYear, todayMonth] = today.split("-").map(Number);

  // Number("") is 0, not NaN — so a naive split+map+isFinite check silently
  // "succeeds" with year 0 when there's no ?month= param at all. Validate
  // the shape explicitly instead of leaning on NaN fallback.
  const monthParam = searchParams.month;
  let year = todayYear;
  let month = todayMonth;
  if (monthParam && /^\d{4}-\d{1,2}$/.test(monthParam)) {
    const [y, m] = monthParam.split("-").map(Number);
    year = y;
    month = m;
  }

  // Calendar view: every task whose due date falls anywhere in the
  // displayed grid (including the padded lead/trail days from adjacent
  // months).
  const gridDays = monthGridDays(year, month);
  const gridStart = gridDays[0];
  const gridEnd = gridDays[gridDays.length - 1];

  // All independent of each other, so they run concurrently instead of as
  // 7 sequential round trips.
  const [
    { data: projects },
    { data: recurringTemplatesData },
    { data: monthTasksRaw, error: monthTasksError },
    { data: todayRaw, error: todayError },
    { data: upcomingRaw, error: upcomingError },
    { data: evergreenRaw, error: evergreenError },
    { data: overdueRaw, error: overdueError },
  ] = await Promise.all([
    supabase.from("projects").select("id, name").order("created_at", { ascending: true }),
    supabase
      .from("recurring_templates")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("tasks")
      .select("*, project:projects(id, name)")
      .eq("section", "todo")
      .is("parent_task_id", null)
      .is("template_id", null)
      .not("title", "in", RECURRING_TITLES_FILTER)
      .gte("due_date", gridStart)
      .lte("due_date", gridEnd)
      .order("sort_order", { ascending: true }),
    // Today's checklist — same query/shape as the homepage (subtasks,
    // drag-reorder), except recurring-template tasks (meals, "Catch up on
    // texts") are left off this dedicated planning page — they're a
    // homepage-only daily-routine concern, not something to manage here.
    supabase
      .from("tasks")
      .select("*, project:projects(id, name)")
      .eq("section", "todo")
      .eq("due_date", today)
      .is("template_id", null)
      .not("title", "in", RECURRING_TITLES_FILTER)
      .order("sort_order", { ascending: true }),
    // Upcoming — everything not yet due, soonest first.
    supabase
      .from("tasks")
      .select("*, project:projects(id, name)")
      .eq("section", "todo")
      .eq("is_done", false)
      .gt("due_date", today)
      .is("parent_task_id", null)
      .order("due_date", { ascending: true }),
    // Evergreen — no due date at all, not tied to a particular day.
    supabase
      .from("tasks")
      .select("*, project:projects(id, name)")
      .eq("section", "todo")
      .eq("is_done", false)
      .is("due_date", null)
      .is("parent_task_id", null)
      .order("created_at", { ascending: false }),
    // Overdue — past due and unchecked. Recurring-template tasks are
    // excluded: a fresh instance for today already exists regardless (see
    // the New Day wizard for the same reasoning), so a stale one from a
    // previous day is just noise, not a meaningful thing to flag here.
    supabase
      .from("tasks")
      .select("*, project:projects(id, name)")
      .eq("section", "todo")
      .eq("is_done", false)
      .lt("due_date", today)
      .not("due_date", "is", null)
      .is("parent_task_id", null)
      .is("template_id", null)
      .not("title", "in", RECURRING_TITLES_FILTER)
      .order("due_date", { ascending: true }),
  ]);

  const recurringTemplates = (recurringTemplatesData ?? []) as RecurringTemplate[];

  if (monthTasksError) console.error("Failed to fetch calendar tasks:", monthTasksError);
  const tasksByDate: Record<string, Task[]> = {};
  for (const t of (monthTasksRaw ?? []) as Task[]) {
    if (!t.due_date) continue;
    const list = tasksByDate[t.due_date] ?? [];
    list.push(t);
    tasksByDate[t.due_date] = list;
  }

  if (todayError) console.error("Failed to fetch today's tasks:", todayError);
  const todayTasks = (todayRaw ?? []).filter((t) => !t.parent_task_id) as Task[];
  const subtasksByParent: Record<string, Task[]> = {};
  for (const t of (todayRaw ?? []) as Task[]) {
    if (!t.parent_task_id) continue;
    const list = subtasksByParent[t.parent_task_id] ?? [];
    list.push(t);
    subtasksByParent[t.parent_task_id] = list;
  }

  if (upcomingError) console.error("Failed to fetch upcoming tasks:", upcomingError);
  const upcomingTasks = (upcomingRaw ?? []) as Task[];

  if (evergreenError) console.error("Failed to fetch evergreen tasks:", evergreenError);
  const evergreenTasks = (evergreenRaw ?? []) as Task[];

  if (overdueError) console.error("Failed to fetch overdue tasks:", overdueError);
  const overdueTasks = (overdueRaw ?? []) as Task[];

  // Subtasks for the Upcoming / Evergreen / Overdue rows, in one query.
  // Their parents can move between these lists (and get their date cleared),
  // and a task shouldn't look like it lost its subtasks just because it
  // isn't on today's list. Keys never collide with Today's — different parents.
  const otherParentIds = [...upcomingTasks, ...evergreenTasks, ...overdueTasks].map((t) => t.id);
  if (otherParentIds.length > 0) {
    const { data: otherSubtasks, error: otherSubtasksError } = await supabase
      .from("tasks")
      .select("*")
      .in("parent_task_id", otherParentIds)
      .order("created_at", { ascending: true });
    if (otherSubtasksError) console.error("Failed to fetch subtasks:", otherSubtasksError);
    for (const t of (otherSubtasks ?? []) as Task[]) {
      if (!t.parent_task_id) continue;
      const list = subtasksByParent[t.parent_task_id] ?? [];
      list.push(t);
      subtasksByParent[t.parent_task_id] = list;
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">To-Do List</h1>
          <p className="mt-1 text-sm text-muted">{today}</p>
        </div>
        <div className="flex items-center gap-2">
          <AddTaskButton today={today} projects={projects ?? []} />
          <EditRecurringTasksButton templates={recurringTemplates} />
        </div>
      </header>

      <TaskCalendar year={year} month={month} tasksByDate={tasksByDate} today={today} />

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Today ({todayTasks.filter((t) => !t.is_done).length}/{todayTasks.length})
        </h2>
        <div className="rounded-lg border border-border bg-panel p-3 shadow-[0_1px_3px_rgba(58,53,44,0.10)]">
          <TodoList todos={todayTasks} subtasksByParent={subtasksByParent} />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Upcoming ({upcomingTasks.length})
        </h2>
        <div className="rounded-lg border border-border bg-panel p-3 shadow-[0_1px_3px_rgba(58,53,44,0.10)]">
          {upcomingTasks.length === 0 && (
            <p className="text-sm text-muted">Nothing scheduled ahead.</p>
          )}
          <div className="flex flex-col gap-1">
            {upcomingTasks.map((t) => (
              <TaskRow key={t.id} task={t} showStar={false} subtasks={subtasksByParent[t.id] ?? []} />
            ))}
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Evergreen ({evergreenTasks.length})
          </h2>
          <AddEvergreenTaskButton projects={projects ?? []} />
        </div>
        <p className="text-xs text-muted">No due date — not tied to any particular day.</p>
        <div className="rounded-lg border border-border bg-panel p-3 shadow-[0_1px_3px_rgba(58,53,44,0.10)]">
          {evergreenTasks.length === 0 && (
            <p className="text-sm text-muted">Nothing here.</p>
          )}
          <div className="flex flex-col gap-1">
            {evergreenTasks.map((t) => (
              <TaskRow key={t.id} task={t} showStar={false} subtasks={subtasksByParent[t.id] ?? []} />
            ))}
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Overdue ({overdueTasks.length})
        </h2>
        <div className="rounded-lg border border-bad/40 bg-bad/5 p-3 shadow-[0_1px_3px_rgba(58,53,44,0.10)]">
          {overdueTasks.length === 0 && (
            <p className="text-sm text-muted">Nothing overdue — you&apos;re all caught up.</p>
          )}
          <div className="flex flex-col gap-1">
            {overdueTasks.map((t) => (
              <TaskRow key={t.id} task={t} showStar={false} subtasks={subtasksByParent[t.id] ?? []} />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
