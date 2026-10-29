import { USER_TIME_ZONE } from "@/lib/timezone";

// The app's day boundary is 4am in the user's timezone, not midnight — work done late
// into the night still counts as "today" until 4am. Used everywhere EXCEPT
// the Calendar widget, which intentionally keeps a real midnight-to-
// midnight 24-hour day view (a calendar showing 4am-to-4am would be
// confusing next to actual clock times).
//
// Converts the given instant to the user's wall-clock time via the
// toLocaleString/Date round trip (no timezone library needed), subtracts 4
// hours, and takes the resulting calendar date — so anything before 4am
// resolves to the previous day.
export function getAppDay(now: Date = new Date()): string {
  const etString = now.toLocaleString("en-US", { timeZone: USER_TIME_ZONE });
  const et = new Date(etString);
  et.setHours(et.getHours() - 4);
  const y = et.getFullYear();
  const m = String(et.getMonth() + 1).padStart(2, "0");
  const d = String(et.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
