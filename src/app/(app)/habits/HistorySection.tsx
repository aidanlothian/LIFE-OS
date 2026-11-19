import Link from "next/link";
import {
  bestWorstHabit,
  monthDaysDescending,
  monthLabel,
  pad2,
  type HabitLogRow,
} from "@/lib/habits";
import HabitGrid from "./HabitGrid";
import type { Habit } from "@/types";

interface MonthKey {
  year: number;
  month: number;
  key: string; // "YYYY-MM"
}

function monthsBetween(earliestKey: string, currentYear: number, currentMonth: number): MonthKey[] {
  const [earliestYear, earliestMonth] = earliestKey.split("-").map(Number);
  const months: MonthKey[] = [];
  let y = currentYear;
  let m = currentMonth - 1;
  if (m === 0) {
    m = 12;
    y -= 1;
  }
  while (y > earliestYear || (y === earliestYear && m >= earliestMonth)) {
    months.push({ year: y, month: m, key: `${y}-${pad2(m)}` });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return months;
}

export default function HistorySection({
  habits,
  logs,
  currentYear,
  currentMonth,
  selectedMonth,
  excludedDates = new Set(),
}: {
  habits: Habit[];
  logs: HabitLogRow[];
  currentYear: number;
  currentMonth: number;
  selectedMonth?: string;
  excludedDates?: Set<string>;
}) {
  if (habits.length === 0) return null;

  const earliestKey = habits
    .map((h) => h.created_at.slice(0, 7))
    .reduce((min, k) => (k < min ? k : min));

  const months = monthsBetween(earliestKey, currentYear, currentMonth);
  if (months.length === 0) return null;

  const totalHabits = habits.length;

  // A month with zero check-offs (and nothing manually excluded) is just
  // dead weight in the history list — most often an artifact of a habit's
  // created_at predating when the tracker was actually used. Drop it rather
  // than showing an empty "0% complete" tile that has to be cleared by hand.
  interface MonthEntry extends MonthKey {
    pct: number;
    completed: number;
  }
  const monthsWithData: MonthEntry[] = months
    .map((m) => {
      const monthDays = monthDaysDescending(m.year, m.month);
      const trackedDays = monthDays.filter((d) => !excludedDates.has(d));
      const completed = logs.filter(
        (l) =>
          l.log_date >= monthDays[monthDays.length - 1] &&
          l.log_date <= monthDays[0] &&
          !excludedDates.has(l.log_date)
      ).length;
      const pct =
        totalHabits > 0 && trackedDays.length > 0
          ? Math.round((completed / (totalHabits * trackedDays.length)) * 100)
          : 0;
      return { ...m, completed, pct };
    })
    .filter((m) => m.completed > 0);

  if (monthsWithData.length === 0) return null;

  const byYear = new Map<number, MonthEntry[]>();
  for (const m of monthsWithData) {
    const list = byYear.get(m.year) ?? [];
    list.push(m);
    byYear.set(m.year, list);
  }
  const years = Array.from(byYear.keys()).sort((a, b) => b - a);

  return (
    <section id="history" className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">History</h2>

      {years.map((year) => (
        <div key={year} className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{year}</h3>
          <div className="flex flex-wrap gap-2">
            {(byYear.get(year) ?? []).map((m) => {
              const pct = m.pct;
              const isOpen = selectedMonth === m.key;

              return (
                <Link
                  key={m.key}
                  href={isOpen ? "/habits#history" : `/habits?month=${m.key}#history`}
                  className={`rounded-lg border px-3 py-2 text-sm shadow-[0_1px_3px_rgba(58,53,44,0.10)] ${
                    isOpen
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border bg-panel text-muted hover:border-accent hover:text-text"
                  }`}
                >
                  <div className="font-medium">{monthLabel(m.year, m.month).split(" ")[0]}</div>
                  <div className="text-xs">{pct}% complete</div>
                </Link>
              );
            })}
          </div>

          {(byYear.get(year) ?? []).map((m) => {
            if (selectedMonth !== m.key) return null;
            const monthDays = monthDaysDescending(m.year, m.month);
            const { best, worst } = bestWorstHabit(habits, logs, monthDays, excludedDates);
            return (
              <div key={m.key} className="flex flex-col gap-3 pt-1">
                <div className="flex items-center justify-between">
                  <h4 className="text-base font-semibold">{monthLabel(m.year, m.month)}</h4>
                  <Link href="/habits#history" className="text-xs text-muted hover:text-text">
                    Collapse
                  </Link>
                </div>
                {(best || worst) && (
                  <div className="flex flex-wrap gap-3">
                    {best && (
                      <div className="flex items-center gap-2 rounded-lg border border-good/40 bg-good/10 px-3 py-2 text-sm">
                        <span>🏆</span>
                        <span className="text-muted">Best:</span>
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
                <HabitGrid habits={habits} logs={logs} days={monthDays} excludedDates={excludedDates} />
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}
