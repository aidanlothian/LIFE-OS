"use client";

import { startTransition, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { quickAdd, type QuickAddResult } from "./quickAddActions";

// Type a plan in plain English; Claude turns it into calendar events and
// to-dos. What was added shows underneath until the next entry.
export default function QuickAddBar() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<QuickAddResult | null>(null);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = value.trim();
    if (!text || pending) return;
    setPending(true);
    setResult(null);
    startTransition(async () => {
      const res = await quickAdd(text);
      setResult(res);
      setPending(false);
      if (res.added.length > 0) setValue("");
      router.refresh();
    });
  }

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={pending}
          aria-label="Quick add"
          placeholder={pending ? "Adding…" : "Add anything: “dinner with Sam Thursday 7pm, remember to book a table”"}
          className="w-full rounded-lg border border-border bg-panel px-3 py-2 text-sm shadow-[0_1px_3px_rgba(58,53,44,0.10)] outline-none placeholder:text-muted focus:border-accent disabled:opacity-60"
        />
      </form>
      {pending && <p className="mt-1.5 px-1 text-xs text-muted">Adding “{value.trim()}”…</p>}
      {result && (result.added.length > 0 || result.error) && (
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 px-1 text-xs">
          {result.added.map((line) => (
            <span key={line} className="text-good">
              ✓ {line}
            </span>
          ))}
          {result.error && <span className="text-bad">{result.error}</span>}
        </div>
      )}
    </div>
  );
}
