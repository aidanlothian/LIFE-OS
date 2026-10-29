// The owner's timezone, set with NEXT_PUBLIC_TIME_ZONE (an IANA name such as
// "America/Chicago"). Server code must never read the machine's own clock
// zone: in local dev that happens to be the owner's zone, but a deployed
// server (Vercel) runs in UTC, which would shift "today", the calendar's
// "now" line and event times by hours. Everything clock-related goes
// through here.
export const USER_TIME_ZONE = process.env.NEXT_PUBLIC_TIME_ZONE || "UTC";

function zoneParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: USER_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

// Real (midnight-to-midnight) calendar date in the user's zone, YYYY-MM-DD.
export function userDateStr(date: Date = new Date()): string {
  return zoneParts(date).date;
}

// Minutes since midnight in the user's zone.
export function userMinutesIntoDay(date: Date = new Date()): number {
  return zoneParts(date).minutes;
}

// The user's UTC offset at the given instant (e.g. "-04:00" in summer,
// "-05:00" in winter for US Eastern), for building RFC3339 timestamps Google accepts.
export function userUtcOffset(date: Date = new Date()): string {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone: USER_TIME_ZONE,
    timeZoneName: "longOffset",
  })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName")?.value;
  // "GMT-04:00"; plain "GMT" means a zero offset.
  const offset = name?.replace("GMT", "") ?? "";
  return offset === "" ? "+00:00" : offset;
}
