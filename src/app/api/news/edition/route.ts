import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/supabase/server";
import { getAppDay } from "@/lib/appDay";
import { ensureEdition, getEdition } from "@/lib/newsEdition";

// Fetching ~16 articles and having Claude write the paper takes a minute or
// so. A Route Handler (not a Server Action) so Home can start it in the
// background without blocking other clicks.
export const maxDuration = 300;

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const today = getAppDay();
  await ensureEdition(user.id, today);
  const edition = await getEdition(today);
  revalidatePath("/");
  revalidatePath("/briefing");
  return NextResponse.json({ status: edition?.status ?? null, error: edition?.error ?? null });
}
