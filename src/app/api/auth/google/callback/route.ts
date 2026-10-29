import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { exchangeCodeForTokens, invalidateCalendarCache } from "@/lib/googleCalendar";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const origin = request.nextUrl.origin;

  if (!code) {
    return NextResponse.redirect(
      `${origin}/?error=${encodeURIComponent("Google Calendar connection was cancelled.")}`
    );
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  try {
    const tokens = await exchangeCodeForTokens(code);

    if (!tokens.refresh_token) {
      // Only issued on first-ever consent (prompt=consent should force
      // this, but guard anyway) — without one we can't refresh later.
      return NextResponse.redirect(
        `${origin}/?error=${encodeURIComponent(
          "Google didn't return a refresh token — try disconnecting and reconnecting."
        )}`
      );
    }

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    await supabase.from("google_calendar_tokens").upsert({
      user_id: user.id,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    });
    invalidateCalendarCache(user.id);
  } catch {
    return NextResponse.redirect(
      `${origin}/?error=${encodeURIComponent("Failed to connect Google Calendar.")}`
    );
  }

  return NextResponse.redirect(`${origin}/`);
}
