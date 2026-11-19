"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getAppDay } from "@/lib/appDay";
import { userMinutesIntoDay } from "@/lib/timezone";
import {
  buildLocalISO,
  createEvent,
  getValidAccessToken,
  invalidateCalendarCache,
} from "@/lib/googleCalendar";
import { planQuickAdd } from "@/lib/quickAddAi";

export interface QuickAddResult {
  added: string[]; // one short line per thing created, e.g. "Event: Dinner with Sam, Thu Nov 20, 7:00 PM"
  error: string | null;
}

// The Home page's "add anything" bar: Claude splits the line into events and
// to-dos, then each is created the same way the manual buttons do.
export async function quickAdd(input: string): Promise<QuickAddResult> {
  const text = input.trim();
  if (!text) return { added: [], error: null };
  const user = await getCurrentUser();
  if (!user) return { added: [], error: "Not signed in." };

  const today = getAppDay();
  const mins = userMinutesIntoDay();
  const nowTime = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

  let plan;
  try {
    plan = await planQuickAdd(text, today, nowTime);
  } catch (err) {
    console.error("quickAdd failed:", err);
    return { added: [], error: err instanceof Error ? err.message : "Couldn't add that." };
  }

  const added: string[] = [];
  const problems: string[] = [];

  if (plan.events.length > 0) {
    const token = await getValidAccessToken(user.id);
    if (!token) {
      problems.push("Google Calendar isn't connected, so the event wasn't added");
    } else {
      for (const e of plan.events) {
        try {
          await createEvent(token, {
            title: e.title,
            startISO: buildLocalISO(e.date, e.start),
            endISO: buildLocalISO(e.date, e.end),
          });
          added.push(`Event: ${e.title}, ${shortDay(e.date, today)} ${clock(e.start)}`);
        } catch (err) {
          console.error("quickAdd event failed:", err);
          problems.push(`Couldn't add "${e.title}" to your calendar`);
        }
      }
      invalidateCalendarCache(user.id);
    }
  }

  if (plan.todos.length > 0) {
    const supabase = createClient();
    for (const t of plan.todos) {
      // New tasks land at the end of that day's list, like "+ Add task".
      let siblings = supabase.from("tasks").select("sort_order").eq("user_id", user.id).eq("section", "todo");
      siblings = t.dueDate ? siblings.eq("due_date", t.dueDate) : siblings.is("due_date", null);
      const { data: rows } = await siblings;
      const sortOrder = rows && rows.length > 0 ? Math.max(...rows.map((r) => r.sort_order as number)) + 1 : 0;

      const { error } = await supabase.from("tasks").insert({
        user_id: user.id,
        title: t.title,
        section: "todo",
        due_date: t.dueDate,
        sort_order: sortOrder,
      });
      if (error) {
        console.error("quickAdd task failed:", error);
        problems.push(`Couldn't add "${t.title}"`);
      } else {
        added.push(`To-do: ${t.title}${t.dueDate && t.dueDate !== today ? `, ${shortDay(t.dueDate, today)}` : ""}`);
      }
    }
  }

  if (added.length === 0 && problems.length === 0) {
    problems.push("Didn't find an event or to-do in that");
  }

  revalidatePath("/", "layout");
  return { added, error: problems.length > 0 ? `${problems.join(". ")}.` : null };
}

function shortDay(date: string, today: string): string {
  if (date === today) return "today";
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function clock(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
