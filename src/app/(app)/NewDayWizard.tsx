"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { completeNewDay, rescheduleTask, toggleDone } from "./actions";
import type { Task } from "@/types";

// A multi-step morning wizard — right now just one step (overdue task
// maintenance), but built as a step array so adding a second/third step
// later is just appending here rather than restructuring the shell.
type StepId = "overdue";
const STEPS: StepId[] = ["overdue"];

export default function NewDayWizard({
  overdueTasks,
  today,
  autoOpen,
}: {
  overdueTasks: Task[];
  today: string;
  autoOpen: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(autoOpen);
  const [stepIndex, setStepIndex] = useState(0);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);

  const step = STEPS[stepIndex];
  const isLastStep = stepIndex === STEPS.length - 1;

  function runAction(id: string, fn: () => Promise<void>) {
    setPendingId(id);
    startTransition(async () => {
      await fn();
      router.refresh();
      setPendingId(null);
    });
  }

  function handleFinish() {
    setFinishing(true);
    startTransition(async () => {
      await completeNewDay();
      router.refresh();
      setFinishing(false);
      setOpen(false);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setStepIndex(0);
          setOpen(true);
        }}
        className="rounded-md border border-border px-2 py-1.5 text-xs text-muted hover:border-accent hover:text-accent"
      >
        New Day
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-text/20 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-md flex-col rounded-lg border border-border bg-panel shadow-[0_1px_3px_rgba(58,53,44,0.10)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-text">Start your day</h3>
                <p className="text-[11px] text-muted">
                  Step {stepIndex + 1} of {STEPS.length} · {today}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-muted hover:text-text"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3">
              {step === "overdue" && (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-muted">
                    Anything hanging from a previous day — check it off or push it forward.
                  </p>

                  {overdueTasks.length === 0 && (
                    <p className="rounded-md border border-good/40 bg-good/10 px-3 py-2 text-sm text-good">
                      Nothing overdue — you&apos;re all caught up.
                    </p>
                  )}

                  <ul className="flex flex-col gap-2">
                    {overdueTasks.map((t) => (
                      <li
                        key={t.id}
                        className="flex flex-col gap-1.5 rounded-md border border-border px-2.5 py-2"
                      >
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              runAction(`done-${t.id}`, () => toggleDone(t.id, true))
                            }
                            disabled={pendingId === `done-${t.id}`}
                            aria-label="Mark done"
                            className="h-4 w-4 shrink-0 rounded border border-muted disabled:opacity-50"
                          />
                          <span className="flex-1 text-sm">{t.title}</span>
                          <span className="text-[11px] text-bad">{t.due_date}</span>
                        </div>
                        <div className="flex items-center gap-2 pl-6 text-[11px]">
                          <button
                            type="button"
                            onClick={() =>
                              runAction(`today-${t.id}`, () => rescheduleTask(t.id, today))
                            }
                            disabled={pendingId === `today-${t.id}`}
                            className="rounded border border-border px-1.5 py-0.5 text-muted hover:border-accent hover:text-accent disabled:opacity-50"
                          >
                            Push to today
                          </button>
                          <label className="flex items-center gap-1 text-muted">
                            or pick a date
                            <input
                              type="date"
                              defaultValue={t.due_date ?? today}
                              onChange={(e) =>
                                e.target.value &&
                                runAction(`date-${t.id}`, () =>
                                  rescheduleTask(t.id, e.target.value)
                                )
                              }
                              className="rounded border border-border bg-bg px-1 py-0.5 text-[11px] outline-none focus:border-accent"
                            />
                          </label>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-border px-4 py-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-sm text-muted hover:text-text"
              >
                Not now
              </button>
              {isLastStep ? (
                <button
                  type="button"
                  onClick={handleFinish}
                  disabled={finishing}
                  className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-50"
                >
                  Finish
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setStepIndex((i) => i + 1)}
                  className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:opacity-90"
                >
                  Next
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
