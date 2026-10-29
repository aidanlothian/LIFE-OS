import { createClient } from "@/lib/supabase/server";
import { fetchUnreadGmail, getValidEmailAccessToken, type FetchedEmail } from "./gmail";
import { fetchUnreadOutlook, getValidOutlookAccessToken } from "./outlook";

export interface EmailAccountRow {
  id: string;
  provider: "google" | "microsoft";
  label: string;
  email_address: string | null;
}

export interface EmailBoardItem {
  id: string;
  accountId: string;
  messageId: string;
  accountLabel: string;
  provider: "google" | "microsoft";
  subject: string;
  sender: string;
  snippet: string;
  receivedAt: string | null;
  webLink: string;
}

function webLinkFor(provider: "google" | "microsoft", messageId: string) {
  return provider === "google"
    ? `https://mail.google.com/mail/u/0/#inbox/${messageId}`
    : `https://outlook.office.com/mail/inbox/id/${encodeURIComponent(messageId)}`;
}

export interface EmailBoardError {
  accountId: string;
  accountLabel: string;
  provider: "google" | "microsoft";
  message: string;
  // True when the saved sign-in no longer works (revoked, or expired —
  // Google expires refresh tokens after ~7 days while the OAuth app is in
  // "Testing" status) and the only fix is connecting the account again.
  needsReconnect: boolean;
}

type EmailBoardResult = {
  accounts: EmailAccountRow[];
  items: EmailBoardItem[];
  errors: EmailBoardError[];
};

// The homepage re-renders this on basically every click (toggling a task,
// dragging a habit, etc. all revalidate "/"), and Gmail/Outlook calls
// (including their OAuth token refresh) are the slowest thing on the page.
// A short in-memory cache means routine actions reuse the last fetch
// instead of hitting those APIs again; per-process only, so it resets on a
// dev server restart and isn't shared across serverless instances — fine
// for a single-user app, and email showing up up to a minute late is a
// reasonable trade for not blocking every click on it.
const EMAIL_BOARD_CACHE_MS = 60_000;
const emailBoardCache = new Map<string, { data: EmailBoardResult; fetchedAt: number }>();

// Fetches the *current* unread mail from every connected account — no AI
// summarization involved, so a message that's since been read elsewhere
// just naturally stops showing up here (within the cache window above).
export async function getEmailBoard(userId: string): Promise<EmailBoardResult> {
  const cached = emailBoardCache.get(userId);
  if (cached && Date.now() - cached.fetchedAt < EMAIL_BOARD_CACHE_MS) {
    return cached.data;
  }

  const result = await fetchEmailBoard(userId);
  // Failures aren't cached, so the next load retries instead of showing a
  // stale error for a minute.
  if (result.errors.length === 0) {
    emailBoardCache.set(userId, { data: result, fetchedAt: Date.now() });
  }
  return result;
}

// Called by actions that need the next load to reflect a change
// immediately rather than waiting out the cache window — dismissing an
// email, or connecting/disconnecting an account.
export function invalidateEmailBoardCache(userId: string) {
  emailBoardCache.delete(userId);
}

async function fetchEmailBoard(userId: string): Promise<EmailBoardResult> {
  const supabase = createClient();
  const { data: accountRows, error: accountsError } = await supabase
    .from("email_accounts")
    .select("id, provider, label, email_address")
    .eq("user_id", userId);
  if (accountsError) console.error("Failed to read email_accounts:", accountsError);
  const accounts = (accountRows ?? []) as EmailAccountRow[];

  const { data: dismissedRows, error: dismissedError } = await supabase
    .from("email_dismissed")
    .select("account_id, message_id")
    .eq("user_id", userId);
  if (dismissedError) console.error("Failed to read email_dismissed:", dismissedError);
  const dismissed = new Set((dismissedRows ?? []).map((d) => `${d.account_id}:${d.message_id}`));

  const items: EmailBoardItem[] = [];
  const errors: EmailBoardError[] = [];

  for (const account of accounts) {
    try {
      const accessToken =
        account.provider === "google"
          ? await getValidEmailAccessToken(account.id)
          : await getValidOutlookAccessToken(account.id);
      if (!accessToken) throw new Error("Saved sign-in not found");

      const fetched: FetchedEmail[] =
        account.provider === "google"
          ? await fetchUnreadGmail(accessToken)
          : await fetchUnreadOutlook(accessToken);

      for (const email of fetched) {
        if (dismissed.has(`${account.id}:${email.messageId}`)) continue;
        items.push({
          id: `${account.id}:${email.messageId}`,
          accountId: account.id,
          messageId: email.messageId,
          accountLabel: account.label,
          provider: account.provider,
          subject: email.subject,
          sender: email.sender,
          snippet: email.snippet,
          receivedAt: email.receivedAt,
          webLink: webLinkFor(account.provider, email.messageId),
        });
      }
    } catch (err) {
      console.error(`Message Board: failed to fetch mail for account ${account.id}:`, err);
      // Google/Microsoft error bodies are verbose JSON — surface just the
      // human-readable message rather than the whole payload.
      const raw = err instanceof Error ? err.message : String(err);
      const match = raw.match(/"(?:message|error_description)":\s*"([^"]+)"/);
      const needsReconnect = /invalid_grant|token refresh failed|Saved sign-in not found|invalid_credentials|UNAUTHENTICATED/i.test(raw);
      errors.push({
        accountId: account.id,
        accountLabel: account.label,
        provider: account.provider,
        message: needsReconnect
          ? "Sign-in expired — reconnect to see new mail."
          : match?.[1] ?? raw.slice(0, 200),
        needsReconnect,
      });
    }
  }

  items.sort((a, b) => (b.receivedAt ?? "").localeCompare(a.receivedAt ?? ""));
  return { accounts, items, errors };
}
