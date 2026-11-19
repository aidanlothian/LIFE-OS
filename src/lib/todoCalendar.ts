import { pad2 } from "./habits";

// Every date (YYYY-MM-DD, ascending) needed to render a full-weeks month
// grid — padded with the trailing days of the previous month and the
// leading days of the next month so every row is a complete Sun-Sat week,
// same convention as any standard calendar UI.
export function monthGridDays(year: number, month: number): string[] {
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const startWeekday = firstOfMonth.getUTCDay(); // 0 = Sunday
  const gridStart = new Date(firstOfMonth);
  gridStart.setUTCDate(gridStart.getUTCDate() - startWeekday);

  const lastOfMonth = new Date(Date.UTC(year, month, 0));
  const endWeekday = lastOfMonth.getUTCDay();
  const gridEnd = new Date(lastOfMonth);
  gridEnd.setUTCDate(gridEnd.getUTCDate() + (6 - endWeekday));

  const days: string[] = [];
  const cur = new Date(gridStart);
  while (cur <= gridEnd) {
    const y = cur.getUTCFullYear();
    const m = cur.getUTCMonth() + 1;
    const d = cur.getUTCDate();
    days.push(`${y}-${pad2(m)}-${pad2(d)}`);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

export function prevMonthKey(year: number, month: number) {
  const m = month === 1 ? 12 : month - 1;
  const y = month === 1 ? year - 1 : year;
  return `${y}-${pad2(m)}`;
}

export function nextMonthKey(year: number, month: number) {
  const m = month === 12 ? 1 : month + 1;
  const y = month === 12 ? year + 1 : year;
  return `${y}-${pad2(m)}`;
}
