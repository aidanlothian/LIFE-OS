import { createClient, getCurrentUser } from "@/lib/supabase/server";
import {
  bestWorstHabit,
  monthDaysDescending,
  monthLabel,
  type HabitLogRow,
} from "@/lib/habits";
import { getAppDay } from "@/lib/appDay";
import { addHabit, ensureDefaultHabits } from "./actions";
import HabitGrid from "./HabitGrid";
import HistorySection from "./HistorySection";
import type { Habit } from "@/types";

export default async function HabitsPage({
  searchParams,
}: {
  searchParams: { editHabit?: string; editCategory?: string; month?: string };
}) {
  const supabase = createClient();
  const user = await getCurrentUser();
  if (!user) return null; // middleware redirects unauthenticated users

  await ensureDefaultHabits(user.id);

  // Independent of each other, so they run concurrently.
  const [{ data: habitsData }, { data: logsData }, { data: excludedData }] = await Promise.all([
    supabase.from("habits").select("*").eq("active", true),
    supabase.from("habit_logs").select("habit_id, log_date"),
    // Fetched broadly (not scoped to this month) since all-time stats can
    // reach back before this month, e.g. to a habit's creation date.
    supabase.from("habit_excluded_days").select("excluded_date"),
  ]);
  const habits = (habitsData ?? []) as Habit[];
  const logs: HabitLogRow[] = logsData ?? [];
  const excludedDates = new Set((excludedData ?? []).map((r) => r.excluded_date as string));

  const today = getAppDay();
  const [year, month] = today.split("-").map(Number);
  const monthDays = monthDaysDescending(year, month, today);
  const { best, worst } = bestWorstHabit(habits, logs, monthDays, excludedDates);
  const totalHabits = habits.length;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold">Habit Tracker</h1>
        <p className="mt-1 text-sm text-muted">
          {totalHabits} habit{totalHabits === 1 ? "" : "s"}
        </p>
      </header>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{monthLabel(year, month)}</h2>

        {(best || worst) && (
          <div className="flex flex-wrap gap-3">
            {best && (
              <div className="flex items-center gap-2 rounded-lg border border-good/40 bg-good/10 px-3 py-2 text-sm">
                <span>🏆</span>
                <span className="text-muted">Best this month:</span>
                <span className="font-medium text-text">{best.habit.title}</span>
                <span className="text-good">{best.pct}%</span>
              </div>
            )}
            {worst && (
              <div className="flex items-center gap-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
                <span>⚠️</span>
                <span className="text-muted">Needs work:</span>
                <span className="font-medium text-text">{worst.habit.title}</span>
                <span className="text-warn">{worst.pct}%</span>
              </div>
            )}
          </div>
        )}

        <HabitGrid
          habits={habits}
          logs={logs}
          days={monthDays}
          pinToday
          showControls
          editHabitId={searchParams.editHabit}
          editCategoryName={searchParams.editCategory}
          excludedDates={excludedDates}
        />
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
          Add a habit
        </h2>
        <form
          action={addHabit}
          className="flex flex-col gap-2 rounded-lg border border-border bg-panel shadow-[0_1px_3px_rgba(58,53,44,0.10)] p-3 sm:flex-row sm:items-center"
        >
          <input
            name="title"
            required
            placeholder="Habit name"
            className="flex-1 rounded-md border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
          <input
            name="category"
            list="habit-categories"
            placeholder="Category"
            defaultValue="General"
            className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
          <datalist id="habit-categories">
            {Array.from(new Set(habits.map((h) => h.category))).map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <button
            type="submit"
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:opacity-90"
          >
            Add
          </button>
        </form>
      </section>

      <HistorySection
        habits={habits}
        logs={logs}
        currentYear={year}
        currentMonth={month}
        selectedMonth={searchParams.month}
        excludedDates={excludedDates}
      />
    </div>
  );
}
