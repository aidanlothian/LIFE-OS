import Anthropic from "@anthropic-ai/sdk";

// Server-only: turns one plain-English line ("dinner with Sam Thursday 7pm,
// remember to book a table") into calendar events and to-dos. Only the
// typed line and today's date are sent. Needs ANTHROPIC_API_KEY.

export interface QuickAddEvent {
  title: string;
  date: string; // YYYY-MM-DD
  start: string; // HH:MM, 24h
  end: string; // HH:MM, 24h
}

export interface QuickAddTodo {
  title: string;
  dueDate: string | null; // YYYY-MM-DD, or null for no date
}

export interface QuickAddPlan {
  events: QuickAddEvent[];
  todos: QuickAddTodo[];
}

const schema = {
  type: "object",
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          date: { type: "string" },
          start: { type: "string" },
          end: { type: "string" },
        },
        required: ["title", "date", "start", "end"],
        additionalProperties: false,
      },
    },
    todos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          due_date: { type: ["string", "null"] },
        },
        required: ["title", "due_date"],
        additionalProperties: false,
      },
    },
  },
  required: ["events", "todos"],
  additionalProperties: false,
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// today is the app-day (YYYY-MM-DD); nowTime is the current HH:MM in ET.
// Throws on API errors or an unreadable answer.
export async function planQuickAdd(input: string, today: string, nowTime: string): Promise<QuickAddPlan> {
  const weekday = new Date(`${today}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  });

  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    system:
      "You turn one line a person typed into their planner into calendar events and to-dos. " +
      "An event is something that happens at a specific time (a meeting, dinner, class, call). A to-do is " +
      "something they need to do themselves (\"remember to\", \"need to\", \"buy\", \"email\"). One line can " +
      "hold several of each, or only one kind.\n" +
      "Events: resolve the date (\"Thursday\" means the next Thursday on or after today; \"tomorrow\" is today + 1). " +
      "Use 24-hour HH:MM times. If no end time is given, make it one hour after the start. \"7\" for dinner " +
      "means 19:00; use common sense for am/pm. If an event has no time at all, treat it as a to-do on that date instead.\n" +
      "To-dos: due_date is the date the person should do it. A to-do with no date mentioned is due today, " +
      "unless it is clearly a someday item, then null. A prep task tied to a later event (book a table for " +
      "Thursday's dinner) is due today.\n" +
      "Titles: short and natural, in the person's words, capitalized like a planner entry (\"Dinner with Sam\", " +
      "\"Book a table\"). Never invent things they didn't ask for.",
    messages: [
      {
        role: "user",
        content: `Today is ${weekday}, ${today}. It is ${nowTime}.\n\nThey typed: ${input}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new Error("Claude wouldn't handle that one.");
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let parsed: {
    events?: { title: string; date: string; start: string; end: string }[];
    todos?: { title: string; due_date: string | null }[];
  };
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error("planQuickAdd: unreadable response", response.stop_reason);
    throw new Error("Couldn't understand that. Try rewording it.");
  }

  // Drop anything malformed rather than writing a bad date to the calendar.
  const events = (parsed.events ?? []).filter(
    (e) => e.title?.trim() && DATE.test(e.date) && TIME.test(e.start) && TIME.test(e.end)
  );
  // An end at or before the start (e.g. "11pm-1am") becomes a one-hour
  // event, kept within the same day.
  for (const e of events) if (e.end <= e.start) e.end = addHour(e.start);
  const todos = (parsed.todos ?? [])
    .filter((t) => t.title?.trim())
    .map((t) => ({ title: t.title.trim(), dueDate: t.due_date && DATE.test(t.due_date) ? t.due_date : null }));
  return { events: events.map((e) => ({ ...e, title: e.title.trim() })), todos };
}

function addHour(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const total = Math.min(h * 60 + m + 60, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
