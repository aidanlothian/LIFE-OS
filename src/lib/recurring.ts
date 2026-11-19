// Recurring-task instances sort ahead of everything else on the day's list,
// in the order their templates are arranged in "Edit recurring tasks".
//
// A day's list is ordered by tasks.sort_order, and ordinary tasks use 0 and
// up (new ones append; dragging re-numbers from 0). If recurring instances
// also used small positive numbers they'd tie with tasks planned the evening
// before, and the order between them would be arbitrary. Starting them far
// below zero makes them a block that always leads the list, in template order.
export const RECURRING_SORT_BASE = -10_000;

export function recurringTaskSortOrder(templateSortOrder: number): number {
  return RECURRING_SORT_BASE + templateSortOrder;
}

// Returns a copy of `list` with the item at `from` moved so it ends up at
// index `to` (an index into the final list, like dropping onto that row).
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return list;
  const clamped = Math.max(0, Math.min(to, list.length - 1));
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(clamped, 0, moved);
  return next;
}
