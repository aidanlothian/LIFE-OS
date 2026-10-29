// Shown the instant a sidebar link or project is clicked, while the next
// page's data loads. Without it the old page just sat there until the new
// one was ready, so every navigation felt like it hadn't registered.
export default function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-busy="true" aria-label="Loading">
      <div className="h-7 w-48 rounded bg-border/60" />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="h-40 rounded-lg border border-border bg-panel" />
        <div className="h-40 rounded-lg border border-border bg-panel" />
        <div className="h-40 rounded-lg border border-border bg-panel" />
      </div>
      <div className="h-64 rounded-lg border border-border bg-panel" />
    </div>
  );
}
