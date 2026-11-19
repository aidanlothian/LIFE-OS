import type { ProjectStatus } from "@/types";

export const STATUS_ORDER: ProjectStatus[] = ["active", "on_hold", "complete"];

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  active: "Active",
  on_hold: "On Hold",
  complete: "Complete",
};

function daysBetween(from: string, to: string) {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
  );
}

// "Oct 20", or "Oct 20, 2027" when it isn't this year. Dates are plain
// YYYY-MM-DD, so they're formatted in UTC to avoid shifting a day.
export function formatDeadline(deadline: string, today: string) {
  const sameYear = deadline.slice(0, 4) === today.slice(0, 4);
  return new Date(`${deadline}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}

// Short label plus a tone for the deadline chip. Complete projects never
// show as overdue.
export function deadlineInfo(
  deadline: string,
  today: string,
  status: ProjectStatus
): { label: string; tone: "bad" | "warn" | "muted" } {
  const days = daysBetween(today, deadline);
  const date = formatDeadline(deadline, today);
  if (status === "complete") return { label: `Due ${date}`, tone: "muted" };
  if (days < 0) return { label: `Overdue · ${date}`, tone: "bad" };
  if (days === 0) return { label: "Due today", tone: "warn" };
  if (days <= 7) return { label: `Due ${date} · ${days}d left`, tone: "warn" };
  return { label: `Due ${date}`, tone: "muted" };
}
