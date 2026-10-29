import { createClient } from "@/lib/supabase/server";
import { userDateStr, userMinutesIntoDay, userUtcOffset } from "@/lib/timezone";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
// calendar.events for reading/writing events, plus calendarlist.readonly
// so we can look up your calendar's own default color (most events don't
// carry an explicit colorId override — they just inherit whatever color
// you picked for the calendar itself in Google Calendar's settings).
const SCOPE = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
].join(" ");

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function getGoogleAuthUrl() {
  const params = new URLSearchParams({
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    redirect_uri: requireEnv("GOOGLE_REDIRECT_URI"),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    // Forces the consent screen every time, which is also what guarantees
    // Google hands back a refresh_token (it's otherwise only issued on the
    // very first-ever consent for this app+account).
    prompt: "consent",
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
      redirect_uri: requireEnv("GOOGLE_REDIRECT_URI"),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${await res.text()}`);
  return res.json();
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${await res.text()}`);
  return res.json();
}

export async function isGoogleCalendarConnected(userId: string) {
  const supabase = createClient();
  const { data } = await supabase
    .from("google_calendar_tokens")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}

// Returns a valid access token, transparently refreshing (and persisting
// the refresh) if the stored one is expired or about to be. Returns null
// if the user has never connected.
export async function getValidAccessToken(userId: string): Promise<string | null> {
  const supabase = createClient();
  const { data: row } = await supabase
    .from("google_calendar_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (!row) return null;

  const expiresAt = new Date(row.expires_at as string).getTime();
  const expiringSoon = expiresAt - Date.now() < 60_000;
  if (!expiringSoon) return row.access_token as string;

  const refreshed = await refreshAccessToken(row.refresh_token as string);
  const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();

  await supabase
    .from("google_calendar_tokens")
    .update({
      access_token: refreshed.access_token,
      expires_at: newExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  return refreshed.access_token;
}

// Google's standard event color palette (colorId -> hex). Stable/documented
// values from the Calendar API's colors resource — hardcoded rather than
// fetched from the /colors endpoint since they essentially never change,
// and it saves an extra API round trip on every calendar load.
const EVENT_COLORS: Record<string, string> = {
  "1": "#7986cb", // Lavender
  "2": "#33b679", // Sage
  "3": "#8e24aa", // Grape
  "4": "#e67c73", // Flamingo
  "5": "#f6c026", // Banana
  "6": "#f5511d", // Tangerine
  "7": "#039be5", // Peacock
  "8": "#616161", // Graphite
  "9": "#3f51b5", // Blueberry
  "10": "#0b8043", // Basil
  "11": "#d60000", // Tomato
};
// Last-resort fallback if even the calendar's own color can't be fetched
// (e.g. scope not yet granted, or the calendarList call fails).
const DEFAULT_EVENT_COLOR = "#c9971f";

export interface CalendarEvent {
  id: string;
  title: string;
  start: string | null; // ISO datetime; null for an all-day event
  end: string | null;
  allDay: boolean;
  color: string; // hex
}

export interface PositionedEvent extends CalendarEvent {
  startMin: number; // minutes since midnight
  endMin: number;
  col: number; // 0-indexed side-by-side column, for overlapping events
  totalCols: number; // how many columns wide this event's overlap cluster is
}

// Minutes into `dateStr` (YYYY-MM-DD) that this timestamp falls at. An
// event that started the day before, or continues into the day after, gets
// clipped to the grid's edges (0 or 1440) rather than computed via raw
// getHours()/getMinutes() — which would misread a next-day midnight
// timestamp as "0:00" (the very start of the day) instead of the end of
// this one, collapsing the event to a sliver right after its start time.
function minutesIntoDay(iso: string, dateStr: string) {
  const d = new Date(iso);
  const isoDate = userDateStr(d);
  if (isoDate < dateStr) return 0;
  if (isoDate > dateStr) return 24 * 60;
  return userMinutesIntoDay(d);
}

// Lays timed events out onto a 24-hour grid: assigns each a start/end in
// minutes-since-midnight, plus a side-by-side column so overlapping events
// sit next to each other instead of on top of each other (same idea as
// Google Calendar's own day view). All-day events are returned separately
// since they don't have a time slot to place on the grid.
export function layoutDayEvents(events: CalendarEvent[], dateStr: string) {
  const allDay = events.filter((e) => e.allDay);
  const timed = events
    .filter((e) => !e.allDay && e.start && e.end)
    .map((e) => {
      const startMin = minutesIntoDay(e.start as string, dateStr);
      // Enforce a minimum visual duration so very short events don't
      // collapse into an unreadable sliver.
      const endMin = Math.max(minutesIntoDay(e.end as string, dateStr), startMin + 15);
      return { ...e, startMin, endMin };
    })
    .sort((a, b) => a.startMin - b.startMin);

  const columnEnds: number[] = [];
  const placed = timed.map((ev) => {
    let col = columnEnds.findIndex((end) => end <= ev.startMin);
    if (col === -1) {
      col = columnEnds.length;
      columnEnds.push(ev.endMin);
    } else {
      columnEnds[col] = ev.endMin;
    }
    return { ...ev, col };
  });

  const timedPositioned: PositionedEvent[] = placed.map((ev) => {
    const overlapping = placed.filter((o) => o.startMin < ev.endMin && o.endMin > ev.startMin);
    const totalCols = Math.max(...overlapping.map((o) => o.col)) + 1;
    return { ...ev, totalCols };
  });

  return { timed: timedPositioned, allDay };
}

// Combines a date (YYYY-MM-DD) and a plain time-input value (HH:MM) into a
// full RFC3339 timestamp in the user's timezone. Google requires an explicit
// offset; a bare "2026-08-26T09:00:00" isn't valid on its own.
export function buildLocalISO(dateStr: string, timeStr: string) {
  const offset = userUtcOffset(new Date(`${dateStr}T12:00:00Z`));
  return `${dateStr}T${timeStr}:00${offset}`;
}

// Most events don't carry an explicit colorId — they just render in
// whichever color you assigned to the calendar itself in Google Calendar's
// own settings. calendarList (not calendars.get, which has no color info)
// is the resource that actually carries it, as a ready-to-use hex string.
async function fetchPrimaryCalendarColor(accessToken: string): Promise<string | null> {
  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList/primary",
    { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return typeof data.backgroundColor === "string" ? data.backgroundColor : null;
}

// Fetches events for the given date (YYYY-MM-DD) in the user's timezone,
// whatever timezone the server itself runs in.
export async function fetchTodaysEvents(
  accessToken: string,
  dateStr: string
): Promise<CalendarEvent[]> {
  const offset = userUtcOffset(new Date(`${dateStr}T12:00:00Z`));
  const params = new URLSearchParams({
    timeMin: `${dateStr}T00:00:00${offset}`,
    timeMax: `${dateStr}T23:59:59${offset}`,
    singleEvents: "true",
    orderBy: "startTime",
  });

  const [res, calendarColor] = await Promise.all([
    fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" }
    ),
    fetchPrimaryCalendarColor(accessToken),
  ]);
  if (!res.ok) throw new Error(`Google Calendar fetch failed: ${await res.text()}`);

  const fallbackColor = calendarColor ?? DEFAULT_EVENT_COLOR;
  const data = await res.json();
  const items: unknown[] = data.items ?? [];

  return items.map((raw) => {
    const item = raw as {
      id: string;
      summary?: string;
      start?: { dateTime?: string };
      end?: { dateTime?: string };
      colorId?: string;
    };
    return {
      id: item.id,
      title: item.summary ?? "(No title)",
      start: item.start?.dateTime ?? null,
      end: item.end?.dateTime ?? null,
      allDay: !item.start?.dateTime,
      color: (item.colorId && EVENT_COLORS[item.colorId]) || fallbackColor,
    };
  });
}

export interface CalendarLoadResult {
  calendarConnected: boolean;
  calendarEvents: CalendarEvent[];
  calendarError: boolean;
}

// The homepage re-renders this on nearly every click (toggling a task,
// dragging a habit, etc. all revalidate "/"), and hitting Google's
// Calendar API — including its own token refresh — is one of the slowest
// things the page does. A short in-memory cache means routine actions
// reuse the last fetch instead of hitting Google again; per-process only
// (resets on a dev server restart, not shared across serverless
// instances), which is fine for a single-user app.
const CALENDAR_CACHE_MS = 60_000;
const calendarCache = new Map<string, { data: CalendarLoadResult; fetchedAt: number }>();

export async function getCachedTodaysEvents(userId: string, dateStr: string): Promise<CalendarLoadResult> {
  const cacheKey = `${userId}:${dateStr}`;
  const cached = calendarCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CALENDAR_CACHE_MS) {
    return cached.data;
  }

  const result = await loadTodaysEvents(userId, dateStr);
  calendarCache.set(cacheKey, { data: result, fetchedAt: Date.now() });
  return result;
}

// Called by actions that need the next load to reflect a change
// immediately — creating/editing/deleting an event, or
// connecting/disconnecting the calendar.
export function invalidateCalendarCache(userId: string) {
  for (const key of calendarCache.keys()) {
    if (key.startsWith(`${userId}:`)) calendarCache.delete(key);
  }
}

async function loadTodaysEvents(userId: string, dateStr: string): Promise<CalendarLoadResult> {
  const connected = await isGoogleCalendarConnected(userId);
  if (!connected) {
    return { calendarConnected: false, calendarEvents: [], calendarError: false };
  }

  try {
    const accessToken = await getValidAccessToken(userId);
    if (!accessToken) {
      return { calendarConnected: true, calendarEvents: [], calendarError: true };
    }
    const calendarEvents = await fetchTodaysEvents(accessToken, dateStr);
    return { calendarConnected: true, calendarEvents, calendarError: false };
  } catch (err) {
    console.error("Google Calendar fetch failed:", err);
    return { calendarConnected: true, calendarEvents: [], calendarError: true };
  }
}

interface EventInput {
  title: string;
  startISO: string;
  endISO: string;
}

export async function createEvent(accessToken: string, event: EventInput) {
  const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      summary: event.title,
      start: { dateTime: event.startISO },
      end: { dateTime: event.endISO },
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Google Calendar create failed: ${await res.text()}`);
  return res.json();
}

export async function updateEvent(accessToken: string, eventId: string, event: EventInput) {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: event.title,
        start: { dateTime: event.startISO },
        end: { dateTime: event.endISO },
      }),
      cache: "no-store",
    }
  );
  if (!res.ok) throw new Error(`Google Calendar update failed: ${await res.text()}`);
  return res.json();
}

export async function deleteEvent(accessToken: string, eventId: string) {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    }
  );
  // Google returns 204 on success and 410 if it was already deleted —
  // both mean "the event isn't there anymore," which is the goal either way.
  if (!res.ok && res.status !== 410) {
    throw new Error(`Google Calendar delete failed: ${await res.text()}`);
  }
}
