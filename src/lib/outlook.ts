import { createClient } from "@/lib/supabase/server";

// "common" accepts both personal Microsoft accounts and work/school
// (Azure AD) accounts — right for a school- or work-issued address without
// knowing in advance which kind it is.
const MS_AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const MS_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const SCOPE = ["offline_access", "Mail.Read", "User.Read"].join(" ");

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function getOutlookAuthUrl() {
  const params = new URLSearchParams({
    client_id: requireEnv("MICROSOFT_CLIENT_ID"),
    redirect_uri: requireEnv("MICROSOFT_REDIRECT_URI"),
    response_type: "code",
    scope: SCOPE,
    // Microsoft issues a refresh token whenever offline_access is granted —
    // no Google-style "prompt=consent every time" trick needed for that,
    // but forcing re-consent here still avoids a stale silent-login using
    // the wrong Microsoft account if more than one is signed into the browser.
    prompt: "select_account",
  });
  return `${MS_AUTH_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export async function exchangeOutlookCodeForTokens(code: string): Promise<TokenResponse> {
  const res = await fetch(MS_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: requireEnv("MICROSOFT_CLIENT_ID"),
      client_secret: requireEnv("MICROSOFT_CLIENT_SECRET"),
      redirect_uri: requireEnv("MICROSOFT_REDIRECT_URI"),
      grant_type: "authorization_code",
      scope: SCOPE,
    }),
  });
  if (!res.ok) throw new Error(`Outlook token exchange failed: ${await res.text()}`);
  return res.json();
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(MS_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: requireEnv("MICROSOFT_CLIENT_ID"),
      client_secret: requireEnv("MICROSOFT_CLIENT_SECRET"),
      grant_type: "refresh_token",
      scope: SCOPE,
    }),
  });
  if (!res.ok) throw new Error(`Outlook token refresh failed: ${await res.text()}`);
  return res.json();
}

export async function fetchOutlookEmailAddress(accessToken: string): Promise<string | null> {
  const res = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.mail ?? data.userPrincipalName ?? null;
}

export async function getValidOutlookAccessToken(accountId: string): Promise<string | null> {
  const supabase = createClient();
  const { data: row, error } = await supabase
    .from("email_accounts")
    .select("provider, access_token, refresh_token, expires_at")
    .eq("id", accountId)
    .maybeSingle();
  if (error) throw new Error(`Couldn't read Outlook account: ${error.message}`);

  if (!row || row.provider !== "microsoft") return null;

  const expiresAt = new Date(row.expires_at as string).getTime();
  if (expiresAt - Date.now() >= 60_000) return row.access_token as string;

  const refreshed = await refreshAccessToken(row.refresh_token as string);
  const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();

  const { error: updateError } = await supabase
    .from("email_accounts")
    .update({
      access_token: refreshed.access_token,
      // Microsoft rotates the refresh token on every use; the old one stops
      // working once a new one is issued, so it must be persisted too.
      refresh_token: refreshed.refresh_token ?? row.refresh_token,
      expires_at: newExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", accountId);
  // Unlike Gmail this one matters: the old refresh token is now dead, so a
  // failed save means the next refresh fails and Outlook needs reconnecting.
  if (updateError) console.error("Failed to save refreshed Outlook token:", updateError);

  return refreshed.access_token;
}

export interface FetchedEmail {
  messageId: string;
  subject: string;
  sender: string;
  snippet: string;
  receivedAt: string | null;
}

interface GraphMessage {
  id: string;
  subject?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  bodyPreview?: string;
  receivedDateTime?: string;
}

// Unread mail filtered to Outlook's own "Focused Inbox" classification —
// its equivalent to Gmail's is:important + category:primary combined:
// mail it's learned you actually engage with, versus bulk/newsletter mail
// it routes to "Other." Free, no extra setup.
export async function fetchUnreadOutlook(accessToken: string, maxResults = 15): Promise<FetchedEmail[]> {
  const params = new URLSearchParams({
    $filter: "isRead eq false and inferenceClassification eq 'focused'",
    $top: String(maxResults),
    $orderby: "receivedDateTime desc",
    $select: "subject,from,bodyPreview,receivedDateTime",
  });
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" }
  );
  if (!res.ok) throw new Error(`Outlook mail fetch failed: ${await res.text()}`);
  const data = await res.json();
  const messages: GraphMessage[] = data.value ?? [];

  return messages.map((m) => {
    const from = m.from?.emailAddress;
    const sender = from ? `${from.name ?? ""} <${from.address ?? ""}>`.trim() : "";
    return {
      messageId: m.id,
      subject: m.subject ?? "(No subject)",
      sender,
      snippet: m.bodyPreview ?? "",
      receivedAt: m.receivedDateTime ?? null,
    };
  });
}
