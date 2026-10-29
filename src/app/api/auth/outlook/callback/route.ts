import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { exchangeOutlookCodeForTokens, fetchOutlookEmailAddress } from "@/lib/outlook";
import { invalidateEmailBoardCache } from "@/lib/messageBoard";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const origin = request.nextUrl.origin;

  if (!code) {
    return NextResponse.redirect(
      `${origin}/?error=${encodeURIComponent("Outlook connection was cancelled.")}`
    );
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  try {
    const tokens = await exchangeOutlookCodeForTokens(code);

    if (!tokens.refresh_token) {
      return NextResponse.redirect(
        `${origin}/?error=${encodeURIComponent(
          "Microsoft didn't return a refresh token — try disconnecting and reconnecting."
        )}`
      );
    }

    const emailAddress = await fetchOutlookEmailAddress(tokens.access_token);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    await supabase.from("email_accounts").upsert(
      {
        user_id: user.id,
        provider: "microsoft",
        label: "Work",
        email_address: emailAddress,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider,email_address" }
    );
    invalidateEmailBoardCache(user.id);
  } catch (err) {
    console.error("Outlook connect failed:", err);
    return NextResponse.redirect(`${origin}/?error=${encodeURIComponent("Failed to connect Outlook.")}`);
  }

  return NextResponse.redirect(`${origin}/`);
}
