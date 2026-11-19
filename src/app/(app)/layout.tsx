import { getCurrentUser } from "@/lib/supabase/server";
import Sidebar from "./Sidebar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  return (
    <div className="min-h-screen">
      <Sidebar email={user?.email ?? ""} />
      <main className="px-4 pb-8 pt-20 sm:px-6">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
