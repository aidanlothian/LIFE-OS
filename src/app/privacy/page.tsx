// Public privacy policy. Google requires a link to one before the OAuth app
// can be switched to "In production", so middleware lets it through without
// a login.
export const metadata = { title: "Privacy policy · Life OS" };

export default function PrivacyPage() {
  return (
    <div className="mx-auto mt-16 max-w-xl px-4 pb-16 text-sm leading-relaxed">
      <h1 className="mb-4 text-2xl font-semibold">Privacy policy</h1>
      <p className="mb-3">
        Life OS is a personal dashboard used only by its owner. It is not offered to the
        public, and no one else can sign up.
      </p>
      <p className="mb-3">
        When the owner connects a Google account, Life OS reads Gmail messages and Google Calendar events
        and creates, edits or deletes calendar events at the owner&apos;s request, so they can be shown and
        managed on the dashboard. The sign-in tokens for that connection are stored in the app&apos;s
        private database, protected so that only the owner&apos;s account can read them.
      </p>
      <p>
        This data is never sold, shared with anyone else, or used for advertising. Disconnecting Google in
        Life OS, or removing its access at myaccount.google.com/permissions, stops all access.
      </p>
    </div>
  );
}
