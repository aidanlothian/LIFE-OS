import type { Metadata, Viewport } from "next";
import "./globals.css";

const description =
  "A personal operating system: tasks, habits, calendar, projects, notes and budget in one place, with AI where it helps.";

// Link previews (iMessage, Slack, LinkedIn) need absolute image URLs. On
// Vercel this is the production domain; locally it falls back to localhost.
const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  // Each page sets its own title, shown in the browser tab as "Budget · Life OS".
  title: { default: "Life OS", template: "%s · Life OS" },
  description,
  openGraph: { title: "Life OS", description, siteName: "Life OS", type: "website" },
  twitter: { card: "summary_large_image", title: "Life OS", description },
  // "Add to Home Screen" on iPhone opens it like an app, without Safari's bars.
  appleWebApp: { capable: true, title: "Life OS", statusBarStyle: "default" },
};

// maximumScale 1 stops iPhone Safari zooming in whenever a small text box is
// tapped. Pinch-to-zoom still works: iOS ignores the limit for that.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#f2efe6",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-text antialiased">{children}</body>
    </html>
  );
}
