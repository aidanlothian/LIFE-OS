import { createClient } from "@/lib/supabase/server";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
// gmail.readonly is enough to list/read messages; "openid email" gets us
// an id token we decode for the connected address, so the account can be
// labeled/deduped without an extra API call.
const SCOPE = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "openid",
  "email",
].join(" ");

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

// A separate redirect URI from Google Calendar's — Google requires every
// redirect target to be pre-registered on the OAuth client, and keeping
// Gmail's callback distinct means reconnecting/troubleshooting one flow
// never risks the other.
export function getGmailAuthUrl() {
  const params = new URLSearchParams({
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    redirect_uri: requireEnv("GOOGLE_GMAIL_REDIRECT_URI"),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
}

export async function exchangeGmailCodeForTokens(code: string): Promise<TokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
      redirect_uri: requireEnv("GOOGLE_GMAIL_REDIRECT_URI"),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Gmail token exchange failed: ${await res.text()}`);
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
  if (!res.ok) throw new Error(`Gmail token refresh failed: ${await res.text()}`);
  return res.json();
}

// The id_token is a JWT; we only need its payload (Google already verified
// the signature by virtue of this request going straight to Google's own
// token endpoint over HTTPS) — no verification library needed just to read
// the email claim back out.
export function decodeEmailFromIdToken(idToken: string): string | null {
  try {
    const payload = idToken.split(".")[1];
    const json = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
    return typeof json.email === "string" ? json.email : null;
  } catch {
    return null;
  }
}

// Returns a valid access token for one connected email account, refreshing
// and persisting if needed — same shape as googleCalendar.ts's
// getValidAccessToken, but keyed by account id since a user can have
// several connected accounts (Gmail, Outlook, more than one of either).
export async function getValidEmailAccessToken(accountId: string): Promise<string | null> {
  const supabase = createClient();
  const { data: row, error } = await supabase
    .from("email_accounts")
    .select("provider, access_token, refresh_token, expires_at")
    .eq("id", accountId)
    .maybeSingle();
  if (error) throw new Error(`Couldn't read Gmail account: ${error.message}`);

  if (!row || row.provider !== "google") return null;

  const expiresAt = new Date(row.expires_at as string).getTime();
  if (expiresAt - Date.now() >= 60_000) return row.access_token as string;

  const refreshed = await refreshAccessToken(row.refresh_token as string);
  const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();

  const { error: updateError } = await supabase
    .from("email_accounts")
    .update({
      access_token: refreshed.access_token,
      expires_at: newExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", accountId);
  if (updateError) console.error("Failed to save refreshed Gmail token:", updateError);

  return refreshed.access_token;
}

export interface FetchedEmail {
  messageId: string;
  subject: string;
  sender: string;
  snippet: string;
  receivedAt: string | null;
}

interface GmailHeader {
  name: string;
  value: string;
}

// Unread inbox mail, newest first — filtered down to what Gmail's own
// classifiers already think matters: is:important (its ML importance
// marker, learned from your reply/open history) and category:primary
// (excludes the Social/Promotions/Updates tabs). Free, no extra setup,
// though it inherits whatever Gmail's classifier gets wrong for a
// brand-new sender it hasn't learned yet.
// Gmail's list endpoint only returns message ids, so each message needs
// its own metadata fetch — done in parallel since it's at most a handful
// of messages.
export async function fetchUnreadGmail(accessToken: string, maxResults = 15): Promise<FetchedEmail[]> {
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({
      q: "is:unread is:important in:inbox category:primary",
      maxResults: String(maxResults),
    })}`,
    { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" }
  );
  if (!listRes.ok) throw new Error(`Gmail list failed: ${await listRes.text()}`);
  const listData = await listRes.json();
  const ids: string[] = (listData.messages ?? []).map((m: { id: string }) => m.id);

  const messages = await Promise.all(
    ids.map(async (id): Promise<FetchedEmail | null> => {
      const res = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?${new URLSearchParams({
          format: "metadata",
          metadataHeaders: "Subject",
        })}&metadataHeaders=From`,
        { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" }
      );
      if (!res.ok) return null;
      const data = await res.json();
      const headers: GmailHeader[] = data.payload?.headers ?? [];
      const subject = headers.find((h) => h.name === "Subject")?.value ?? "(No subject)";
      const sender = headers.find((h) => h.name === "From")?.value ?? "";
      return {
        messageId: id,
        subject,
        sender,
        snippet: data.snippet ?? "",
        receivedAt: data.internalDate ? new Date(Number(data.internalDate)).toISOString() : null,
      };
    })
  );

  return messages.filter((m): m is FetchedEmail => m !== null);
}
