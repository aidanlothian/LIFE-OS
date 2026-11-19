"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { userDateStr } from "@/lib/timezone";
import {
  buildLocalISO,
  createEvent,
  deleteEvent,
  getValidAccessToken,
  invalidateCalendarCache,
  updateEvent,
} from "@/lib/googleCalendar";

async function requireAccessToken() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const token = await getValidAccessToken(user.id);
  if (!token) throw new Error("Google Calendar is not connected.");
  return { accessToken: token, userId: user.id };
}

export async function addCalendarEvent(formData: FormData) {
  const { accessToken, userId } = await requireAccessToken();

  const title = String(formData.get("title") || "").trim();
  const startTime = String(formData.get("start_time") || "");
  const endTime = String(formData.get("end_time") || "");
  if (!title || !startTime || !endTime) return;

  const today = userDateStr();
  await createEvent(accessToken, {
    title,
    startISO: buildLocalISO(today, startTime),
    endISO: buildLocalISO(today, endTime),
  });

  invalidateCalendarCache(userId);
  revalidatePath("/");
}

export async function editCalendarEvent(eventId: string, formData: FormData) {
  const { accessToken, userId } = await requireAccessToken();

  const title = String(formData.get("title") || "").trim();
  const startTime = String(formData.get("start_time") || "");
  const endTime = String(formData.get("end_time") || "");
  if (!title || !startTime || !endTime) return;

  const today = userDateStr();
  await updateEvent(accessToken, eventId, {
    title,
    startISO: buildLocalISO(today, startTime),
    endISO: buildLocalISO(today, endTime),
  });

  invalidateCalendarCache(userId);
  revalidatePath("/");
}

export async function removeCalendarEvent(eventId: string) {
  const { accessToken, userId } = await requireAccessToken();
  await deleteEvent(accessToken, eventId);
  invalidateCalendarCache(userId);
  revalidatePath("/");
}
