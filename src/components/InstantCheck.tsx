"use client";

import { startTransition, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

// A checkbox that flips the moment it's clicked and saves in the
// background. Waiting for the server first (a round trip plus a full page
// re-render) made every check feel laggy. The shown state re-syncs from
// `checked` whenever the server's answer arrives, so a failed save shows
// the real state on the next refresh.
export default function InstantCheck({
  checked,
  onToggle,
  ariaLabel,
  boxClassName,
  labelClassName = "",
  children,
}: {
  checked: boolean;
  onToggle: (next: boolean) => Promise<void>;
  ariaLabel: string;
  boxClassName: string;
  labelClassName?: string;
  children?: ReactNode;
}) {
  const router = useRouter();
  const [shown, setShown] = useState(checked);
  useEffect(() => setShown(checked), [checked]);

  function handleClick() {
    const next = !shown;
    setShown(next);
    startTransition(async () => {
      await onToggle(next);
      router.refresh();
    });
  }

  const box = (
    <button
      type="button"
      onClick={handleClick}
      aria-label={ariaLabel}
      aria-pressed={shown}
      className={`${boxClassName} shrink-0 rounded border ${shown ? "border-good bg-good" : "border-muted"}`}
    />
  );
  if (children === undefined) return box;
  return (
    <>
      {box}
      <span className={`${labelClassName} ${shown ? "text-muted line-through" : ""}`}>{children}</span>
    </>
  );
}
