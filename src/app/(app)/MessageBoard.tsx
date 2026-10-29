"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { dismissEmail, disconnectEmailAccount } from "./messageBoardActions";
import type { EmailAccountRow, EmailBoardError, EmailBoardItem } from "@/lib/messageBoard";

function timeAgo(iso: string | null) {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function MessageBoard({
  emailAccounts,
  emailItems,
  emailErrors,
}: {
  emailAccounts: EmailAccountRow[];
  emailItems: EmailBoardItem[];
  emailErrors: EmailBoardError[];
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);

  function handleClearEmail(itemId: string, accountId: string, messageId: string) {
    setPendingId(itemId);
    startTransition(async () => {
      await dismissEmail(accountId, messageId);
      router.refresh();
      setPendingId(null);
    });
  }

  function handleDisconnect(accountId: string) {
    setPendingId(accountId);
    startTransition(async () => {
      await disconnectEmailAccount(accountId);
      router.refresh();
      setPendingId(null);
    });
  }

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Message Board</h2>

      <div className="max-h-96 overflow-y-auto rounded-lg border border-border bg-panel shadow-[0_1px_3px_rgba(58,53,44,0.10)] p-3">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {emailAccounts.map((a) => (
              <span
                key={a.id}
                className="flex items-center gap-1.5 rounded bg-border/60 px-2 py-1 text-muted"
              >
                {a.label}
                {a.email_address ? ` · ${a.email_address}` : ""}
                <button
                  type="button"
                  onClick={() => handleDisconnect(a.id)}
                  disabled={pendingId === a.id}
                  className="text-muted hover:text-bad"
                  aria-label={`Disconnect ${a.label}`}
                >
                  ✕
                </button>
              </span>
            ))}
            {!emailAccounts.some((a) => a.provider === "google") && (
              <a
                href="/api/auth/gmail/start"
                className="rounded-md border border-border px-2 py-1 text-muted hover:border-accent hover:text-accent"
              >
                + Connect Gmail
              </a>
            )}
            {/* "+ Connect Outlook" is hidden: many school and work Microsoft
                tenants block third-party mail apps. The Outlook code
                (lib/outlook.ts, /api/auth/outlook) still works for accounts
                that allow it. */}
          </div>

          {emailAccounts.length === 0 && (
            <p className="text-sm text-muted">
              Connect Gmail above to see unread mail here.
            </p>
          )}
          {emailErrors.map((e) => (
            <div
              key={e.accountId}
              className="flex items-center justify-between gap-2 rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad"
            >
              <span>
                {e.accountLabel} ({e.provider === "google" ? "Gmail" : "Outlook"}): {e.message}
              </span>
              {e.needsReconnect && (
                <a
                  href={e.provider === "google" ? "/api/auth/gmail/start" : "/api/auth/outlook/start"}
                  className="shrink-0 rounded-md bg-accent px-2 py-1 font-medium text-bg hover:opacity-90"
                >
                  Reconnect
                </a>
              )}
            </div>
          ))}
          {emailAccounts.length > 0 && emailItems.length === 0 && emailErrors.length === 0 && (
            <p className="text-sm text-muted">Inbox zero — nothing unread right now.</p>
          )}

          <ul className="flex flex-col gap-3">
            {emailItems.map((item) => (
              <li key={item.id} className="border-b border-border pb-3 last:border-0 last:pb-0">
                <div className="flex items-start justify-between gap-2">
                  <a
                    href={item.webLink}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-medium text-text hover:text-accent"
                  >
                    {item.subject}
                  </a>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[11px] text-muted">{timeAgo(item.receivedAt)}</span>
                    <button
                      type="button"
                      onClick={() => handleClearEmail(item.id, item.accountId, item.messageId)}
                      disabled={pendingId === item.id}
                      title="Seen it — hide from this board (doesn't mark it read in your inbox)"
                      className="text-[11px] text-muted hover:text-accent disabled:opacity-50"
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <p className="mt-0.5 text-xs text-muted">{item.sender}</p>
                <p className="mt-1 text-sm text-text">{item.snippet}</p>
                <span className="mt-1 inline-block rounded bg-border/60 px-1.5 py-0.5 text-[11px] text-muted">
                  {item.accountLabel}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
