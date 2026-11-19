import { signIn } from "./actions";
import LogoMark from "@/components/LogoMark";

export const metadata = { title: "Sign in" };

// The sign-in page is the only page a visitor sees, so it says what Life OS
// is instead of being a bare form.
const SECTIONS = [
  ["Second Brain", "Each day's plan on one page: 3 priorities, to-dos, habits, calendar."],
  ["Daily Briefing", "A short morning paper, written by Claude from the headlines you care about."],
  ["Budget", "Bank CSV import, monthly budgets per category, AI sorting of merchants."],
  ["Projects & Deep Memory", "Drag-and-drop workspaces for every project and topic."],
];

export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center gap-12 px-6 py-12 md:flex-row md:items-center md:gap-16">
      <div className="md:flex-1">
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-panel shadow-sm">
          <LogoMark size={44} />
        </div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
          Personal operating system
        </p>
        <h1 className="mt-2 font-serif text-5xl font-bold leading-none">Life OS</h1>
        <p className="mt-4 max-w-md text-base text-muted">
          Tasks, habits, calendar, projects, notes and budget in one place, with
          AI where it actually helps.
        </p>
        <ul className="mt-8 hidden flex-col gap-4 sm:flex">
          {SECTIONS.map(([name, blurb]) => (
            <li key={name} className="flex gap-3">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              <div>
                <div className="text-sm font-semibold">{name}</div>
                <div className="text-sm text-muted">{blurb}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="w-full rounded-xl border border-border bg-panel p-6 shadow-sm md:max-w-sm">
        <h2 className="text-lg font-semibold">Sign in</h2>
        <p className="mb-5 mt-1 text-sm text-muted">Private, single-user workspace.</p>

        {searchParams.error && (
          <div className="mb-4 rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
            {searchParams.error}
          </div>
        )}

        <form action={signIn} className="flex flex-col gap-3">
          <input
            name="email"
            type="email"
            required
            placeholder="Email"
            autoComplete="email"
            className="rounded-md border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <input
            name="password"
            type="password"
            required
            placeholder="Password"
            autoComplete="current-password"
            className="rounded-md border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <button
            type="submit"
            className="mt-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-bg hover:opacity-90"
          >
            Sign in
          </button>
        </form>
        <a href="/privacy" className="mt-5 block text-xs text-muted hover:text-text">
          Privacy policy
        </a>
      </div>
    </div>
  );
}
