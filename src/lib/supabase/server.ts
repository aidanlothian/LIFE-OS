import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";

type CookieToSet = { name: string; value: string; options: CookieOptions };

// Use inside Server Components, Server Actions, and Route Handlers.
export function createClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component during render — safe to ignore
            // because middleware handles session refresh on every request.
          }
        },
      },
    }
  );
}

// The signed-in user, fetched at most once per request. The layout, the
// page and helpers like newDay all need it; without this each one made its
// own round trip to Supabase Auth before the page could render.
export const getCurrentUser = cache(async () => {
  const {
    data: { user },
  } = await createClient().auth.getUser();
  return user;
});
