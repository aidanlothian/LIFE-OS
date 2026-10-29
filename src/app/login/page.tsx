import { signIn } from "./actions";

export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  return (
    <div className="mx-auto mt-24 max-w-sm px-4">
      <h1 className="mb-1 text-2xl font-semibold">Life OS</h1>
      <p className="mb-6 text-sm text-muted">Sign in to your control center.</p>

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
          className="rounded-md border border-border bg-panel px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <input
          name="password"
          type="password"
          required
          placeholder="Password"
          className="rounded-md border border-border bg-panel px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          className="mt-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-bg hover:opacity-90"
        >
          Sign in
        </button>
      </form>
    </div>
  );
}
