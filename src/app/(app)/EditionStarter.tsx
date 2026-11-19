"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Shown on Home while today's paper isn't ready. Starts the writing when
// nothing has started it yet (or the last try was abandoned), checks back
// while it's being written, and offers a retry if it failed.
export default function EditionStarter({
  status,
  error,
}: {
  status: "start" | "writing" | "failed";
  error: string | null;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(status !== "failed");
  const [failure, setFailure] = useState(status === "failed" ? error : null);

  async function write() {
    setRunning(true);
    setFailure(null);
    try {
      const res = await fetch("/api/news/edition", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { status?: string | null; error?: string | null };
      if (!res.ok) {
        setFailure(`Couldn't write today's paper (the site answered ${res.status}).`);
      } else if (body.status === "failed") {
        setFailure(body.error ?? "Couldn't write today's paper.");
      } else if (!body.status) {
        // Nothing was saved: usually the news_editions table doesn't exist yet.
        setFailure("Couldn't save today's paper. Check that the news_editions table was created in Supabase.");
      }
      if (body.status !== "writing") setRunning(false);
    } catch {
      setFailure("Couldn't reach the site to write today's paper.");
      setRunning(false);
    }
    router.refresh();
  }

  useEffect(() => {
    if (status === "start") void write();
    if (status !== "writing") return;
    // Another tab or load is writing it: check back until it lands.
    const timer = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(timer);
    // Runs once per status the server reports.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  if (failure) {
    return (
      <p className="mb-3 text-xs text-bad">
        {failure}{" "}
        <button type="button" onClick={() => void write()} className="underline hover:text-accent">
          Try again
        </button>
      </p>
    );
  }
  if (!running) return null;
  return (
    <p className="mb-3 text-xs text-muted">
      Writing today&apos;s paper from your top stories. This takes about a minute; the headlines are below meanwhile.
    </p>
  );
}
