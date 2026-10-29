"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "./actions";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/todo", label: "To-Do List" },
  { href: "/habits", label: "Habit Tracker" },
  { href: "/projects", label: "Project Center" },
  { href: "/memory", label: "Deep Memory" },
];

export default function Sidebar({ email }: { email: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close menu" : "Open menu"}
        className="fixed left-4 top-4 z-50 flex h-9 w-9 items-center justify-center rounded-md border border-border bg-panel shadow-[0_1px_3px_rgba(58,53,44,0.10)] hover:border-accent"
      >
        <span className="flex flex-col gap-[3px]">
          <span className="h-0.5 w-4 rounded bg-text" />
          <span className="h-0.5 w-4 rounded bg-text" />
          <span className="h-0.5 w-4 rounded bg-text" />
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-30 bg-text/20"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed left-0 top-0 z-40 flex h-screen w-52 shrink-0 flex-col justify-between border-r border-border bg-panel px-4 pb-6 pt-16 shadow-[1px_0_3px_rgba(58,53,44,0.08)] transition-transform duration-200 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex flex-col gap-6">
          <span className="text-lg font-semibold">Life OS</span>
          <nav className="flex flex-col gap-1">
            {NAV_LINKS.map((link) => {
              const active =
                link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className={`rounded-md px-2 py-1.5 text-sm ${
                    active
                      ? "bg-accent/15 text-accent"
                      : "text-muted hover:bg-border/50 hover:text-text"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex flex-col gap-2">
          <span className="truncate text-xs text-muted">{email}</span>
          <form action={signOut}>
            <button
              type="submit"
              className="text-left text-sm text-muted hover:text-text"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
