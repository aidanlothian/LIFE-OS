import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decodeEmailFromIdToken, exchangeGmailCodeForTokens } from "@/lib/gmail";
import { invalidateEmailBoardCache } from "@/lib/messageBoard";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const origin = request.nextUrl.origin;

  if (!code) {
    return NextResponse.redirect(
      `${origin}/?error=${encodeURIComponent("Gmail connection was cancelled.")}`
    );
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  try {
    const tokens = await exchangeGmailCodeForTokens(code);

    if (!tokens.refresh_token) {
      return NextResponse.redirect(
        `${origin}/?error=${encodeURIComponent(
          "Google didn't return a refresh token — try disconnecting and reconnecting."
        )}`
      );
    }

    const emailAddress = tokens.id_token ? decodeEmailFromIdToken(tokens.id_token) : null;
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    await supabase.from("email_accounts").upsert(
      {
        user_id: user.id,
        provider: "google",
        label: "Personal",
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
    console.error("Gmail connect failed:", err);
    return NextResponse.redirect(`${origin}/?error=${encodeURIComponent("Failed to connect Gmail.")}`);
  }

  return NextResponse.redirect(`${origin}/`);
}
